import { Application, BitmapText, Container, Graphics, Sprite, Text } from 'pixi.js'
import type { AgentState, Camera, RenderAgentMetadata, RenderScene, Shape, Vec2 } from '@crowd-control/contract'
import type { SimulationClient } from '../worker/simulationClient.ts'
import { HAIR_TONES, SKIN_TONES, groupColor, markerShape, resolveAgentStyle, stableIndex, stateAnnotation, type AgentDrawMode } from './agentStyle.ts'
import { FigureAtlas, type FigurePose } from './figureAtlas.ts'
import { fitCamera, panBy, worldToScreen, zoomAt } from './camera.ts'
import { displayPositions } from './interpolate.ts'
import { COLORS, layoutMap, type MapLayout } from './mapLayout.ts'

export type RendererOptions = {
  /** Largest automatic fit scale, so a tiny map is not blown up absurdly. */
  maxPixelsPerUnit?: number
  /** Breathing room between the map and the panel edge, in CSS pixels. */
  paddingPx?: number
  /** Canvas background; omit for a transparent canvas over the page's workspace. */
  background?: string
  /** Font family for map labels; must already be loaded by the page. */
  fontFamily?: string
  /** 0–1: how strongly a zone's own fill tints the floor (1 = paint it as given). */
  zoneTint?: number
  /** Illustrated people (default) or abstract markers; switch later with setAgentDrawMode. */
  agentDrawMode?: AgentDrawMode
}

/** Screen space covered by floating UI; fitting centres the map in what is left. */
export type Insets = { top: number; right: number; bottom: number; left: number }

type AgentView = {
  body: Graphics
  figure: Sprite | null
  badge: BitmapText | null
  label: BitmapText | null
  state: AgentState | null
  metadata: RenderAgentMetadata | null
  pixelsPerUnit: number
  mode: AgentDrawMode | null
  radiusPx: number
  /** Distance from the position up to the top of the drawn person, for badges. */
  topPx: number
  badgeText: string | null
  colors: { body: string; skin: string; hair: string }
  pose: FigurePose | null
  fallen: boolean
  rotates: boolean
  last: Vec2 | null
  heading: number
  phase: number
}

const WALK_STEP_SECONDS = 0.18
/** Zoom range relative to the fitted view, and how much of the map always stays visible. */
const MIN_ZOOM = 0.5
const MAX_ZOOM = 12
const KEEP_VISIBLE_PX = 80
/** Matches the panels' slide so the map glides with them. */
const INSET_TWEEN_MS = 360
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

const DEFAULT_FONT = 'system-ui, sans-serif'

/**
 * PixiJS bird's-eye renderer (Technical PRD §12). Reads the SimulationClient view on every
 * animation frame; it never mutates simulation state and never keeps its own positions.
 * Layer order, back to front: floor/zones → heatmap → walls/objects/portals → map labels →
 * agents → status annotations → agent labels.
 *
 * The map layers live in one container that is transformed while the camera moves (pan,
 * zoom, glide) and redrawn crisply once the camera settles, so moving never rebuilds it.
 */
export class CrowdRenderer {
  readonly app: Application
  private readonly client: SimulationClient
  private readonly options: RendererOptions
  private readonly layers = {
    floor: new Container(),
    heatmap: new Container(), // Density overlay arrives in the next phase.
    structures: new Container(),
    mapLabels: new Container(),
    agents: new Container(),
    annotations: new Container(),
    labels: new Container(),
  }
  private readonly mapRoot = new Container()
  private readonly agentViews = new Map<string, AgentView>()
  private readonly metadata = new Map<string, RenderAgentMetadata>()
  private readonly detachInput: () => void
  private readonly cameraListeners = new Set<(camera: Camera) => void>()
  private readonly hostObserver: ResizeObserver
  private camera: Camera = { pan: { x: 0, y: 0 }, pixelsPerUnit: 20 }
  private homeCamera: Camera = this.camera
  private scene: RenderScene | null = null
  private layout: MapLayout | null = null
  /** Scene and camera the map graphics were last drawn for. */
  private mapDrawnFor: { scene: RenderScene; camera: Camera } | null = null
  private lastCamera: Camera | null = null
  private cameraChangedAt = 0
  private fittedTo = { width: 0, height: 0 }
  private drawMode: AgentDrawMode
  private readonly atlas: FigureAtlas
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 }
  private tween: { from: Camera; start: number } | null = null
  private atlasGeneration = 0
  private readonly font: string

  static async create(host: HTMLElement, client: SimulationClient, options: RendererOptions = {}): Promise<CrowdRenderer> {
    const app = new Application()
    await app.init({
      resizeTo: host, antialias: true, preference: 'webgl',
      ...(options.background ? { background: options.background } : { backgroundAlpha: 0 }),
      resolution: window.devicePixelRatio || 1, autoDensity: true,
    })
    return new CrowdRenderer(app, host, client, options)
  }

  private constructor(app: Application, host: HTMLElement, client: SimulationClient, options: RendererOptions) {
    this.app = app
    this.client = client
    this.options = options
    this.font = options.fontFamily ?? DEFAULT_FONT
    this.drawMode = options.agentDrawMode ?? 'people'
    this.atlas = new FigureAtlas(app.renderer)
    // People overlap like a crowd seen from slightly above: lower on screen draws on top.
    this.layers.agents.sortableChildren = true
    app.canvas.setAttribute('role', 'img')
    app.canvas.setAttribute('aria-label', 'Bird’s-eye view of the simulated crowd')
    host.appendChild(app.canvas)
    // Pixi's resizeTo only listens to window resizes; panels also change the host's size.
    this.hostObserver = new ResizeObserver(() => app.queueResize())
    this.hostObserver.observe(host)
    const { floor, heatmap, structures, mapLabels, agents, annotations, labels } = this.layers
    this.mapRoot.addChild(floor, heatmap, structures, mapLabels)
    app.stage.addChild(this.mapRoot, agents, annotations, labels)
    this.detachInput = this.attachPointerInput(app.canvas)
    app.ticker.add(() => this.draw())
  }

  /** Multiplies the zoom around the canvas centre (keyboard +/−). */
  zoom(factor: number) {
    this.zoomAround({ x: this.app.screen.width / 2, y: this.app.screen.height / 2 }, factor)
  }

  pan(deltaPx: Vec2) {
    this.tween = null
    this.camera = this.constrain(panBy(this.camera, deltaPx))
  }

  /** Zooms around a screen point, between half the fitted size and twelve times it. */
  private zoomAround(anchor: Vec2, factor: number) {
    this.tween = null
    const home = this.homeCamera.pixelsPerUnit
    const target = Math.min(home * MAX_ZOOM, Math.max(home * MIN_ZOOM, this.camera.pixelsPerUnit * factor))
    this.camera = this.constrain(zoomAt(this.camera, anchor, target / this.camera.pixelsPerUnit))
  }

  /** Keeps at least part of the map on screen, so panning or zooming can never lose it. */
  private constrain(camera: Camera): Camera {
    if (!this.layout) return camera
    const ppu = camera.pixelsPerUnit
    const keep = KEEP_VISIBLE_PX / ppu
    const view = { width: this.app.screen.width / ppu, height: this.app.screen.height / ppu }
    const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)
    return {
      pixelsPerUnit: ppu,
      pan: {
        x: clamp(camera.pan.x, keep - view.width, this.layout.worldWidth - keep),
        y: clamp(camera.pan.y, keep - view.height, this.layout.worldHeight - keep),
      },
    }
  }

  resetCamera() {
    this.tween = null
    this.camera = this.homeCamera
  }

  /** Switches between illustrated people and abstract markers; positions are unaffected. */
  setAgentDrawMode(mode: AgentDrawMode) {
    if (mode === this.drawMode) return
    this.drawMode = mode
    for (const view of this.agentViews.values()) view.mode = null
  }

  /** Tells the renderer which screen edges are covered by panels; refits if not zoomed/panned. */
  setInsets(insets: Insets) {
    const same = Object.entries(insets).every(([key, value]) => this.insets[key as keyof Insets] === value)
    if (same) return
    this.insets = { ...insets }
    this.refit(false, true)
  }

  /** Current camera, for DOM overlays positioned in world coordinates. */
  getCamera(): Camera {
    return this.camera
  }

  /** Notified after the map is redrawn for a new camera or scene (fit, zoom, pan, resize). */
  onCameraChange(listener: (camera: Camera) => void): () => void {
    this.cameraListeners.add(listener)
    return () => {
      this.cameraListeners.delete(listener)
    }
  }

  destroy() {
    this.hostObserver.disconnect()
    this.cameraListeners.clear()
    this.atlas.clear()
    this.detachInput()
    this.app.destroy(true, { children: true })
    this.agentViews.clear()
  }

  // ---------------------------------------------------------------- frame loop

  private draw() {
    const view = this.client.getView()
    if (view.scene !== this.scene) this.acceptScene(view.scene)
    if (!this.scene || !this.layout) return
    if (this.app.screen.width !== this.fittedTo.width || this.app.screen.height !== this.fittedTo.height) this.refit(false)
    if (this.tween) this.stepTween()
    const now = performance.now()
    if (!this.mapDrawnFor || this.mapDrawnFor.scene !== this.scene) this.redrawMap()
    if (this.camera !== this.lastCamera) {
      this.lastCamera = this.camera
      this.cameraChangedAt = now
      this.placeMap()
      for (const listener of this.cameraListeners) listener(this.camera)
    } else if (!this.tween && this.mapDrawnFor!.camera !== this.camera && now - this.cameraChangedAt > 120) {
      // The camera has settled: redraw at the new scale so lines and labels are crisp again.
      this.redrawMap()
    }
    if (view.current) this.drawAgents(view.previous, view.current)
  }

  private acceptScene(scene: RenderScene | null) {
    const previous = this.layout
    this.scene = scene
    this.layout = scene ? layoutMap(scene.map) : null
    this.metadata.clear()
    for (const agent of scene?.agents ?? []) this.metadata.set(agent.id, agent)
    if (this.layout && (!previous || previous.worldWidth !== this.layout.worldWidth || previous.worldHeight !== this.layout.worldHeight)) {
      this.refit(true)
    }
    if (!scene) this.clearAgents()
  }

  /** Glides the camera to the home fit; lands exactly on homeCamera so "unmoved" still holds. */
  private stepTween() {
    const tween = this.tween!
    const t = Math.min(1, (performance.now() - tween.start) / INSET_TWEEN_MS)
    if (t >= 1) {
      this.camera = this.homeCamera
      this.tween = null
      return
    }
    const k = easeOut(t)
    const to = this.homeCamera
    this.camera = {
      pixelsPerUnit: tween.from.pixelsPerUnit + (to.pixelsPerUnit - tween.from.pixelsPerUnit) * k,
      pan: { x: tween.from.pan.x + (to.pan.x - tween.from.pan.x) * k, y: tween.from.pan.y + (to.pan.y - tween.from.pan.y) * k },
    }
  }

  /** Fits the map to the panel. Keeps a camera the user has zoomed or panned unless `force`. */
  private refit(force: boolean, animate = false) {
    if (!this.layout) return
    const pad = this.options.paddingPx ?? 24
    const screen = { width: this.app.screen.width, height: this.app.screen.height }
    this.fittedTo = screen
    const left = this.insets.left + pad, top = this.insets.top + pad
    const fitted = fitCamera(
      { width: this.layout.worldWidth, height: this.layout.worldHeight },
      {
        width: Math.max(1, screen.width - left - this.insets.right - pad),
        height: Math.max(1, screen.height - top - this.insets.bottom - pad),
      },
      this.options.maxPixelsPerUnit ?? 64,
    )
    const home = { ...fitted, pan: { x: fitted.pan.x - left / fitted.pixelsPerUnit, y: fitted.pan.y - top / fitted.pixelsPerUnit } }
    const follow = force || this.camera === this.homeCamera || this.tween !== null
    this.homeCamera = home
    if (!follow) return
    if (animate && !force) this.tween = { from: this.camera, start: performance.now() }
    else this.camera = home
  }

  // ---------------------------------------------------------------- map

  private redrawMap() {
    this.drawMap(this.layout!, this.scene!)
    this.mapDrawnFor = { scene: this.scene!, camera: this.camera }
    this.placeMap()
  }

  /** Transforms the drawn map from the camera it was drawn for to the current camera. */
  private placeMap() {
    const drawn = this.mapDrawnFor?.camera
    if (!drawn) return
    const k = this.camera.pixelsPerUnit / drawn.pixelsPerUnit
    this.mapRoot.scale.set(k)
    this.mapRoot.position.set(
      (drawn.pan.x - this.camera.pan.x) * this.camera.pixelsPerUnit,
      (drawn.pan.y - this.camera.pan.y) * this.camera.pixelsPerUnit,
    )
  }

  private drawMap(layout: MapLayout, scene: RenderScene) {
    const { floor, structures, mapLabels: labels } = this.layers
    for (const layer of [floor, structures, labels]) for (const child of layer.removeChildren()) child.destroy()
    const ppu = this.camera.pixelsPerUnit
    const toScreen = (x: number, y: number) => worldToScreen(this.camera, { x, y })
    const floorGraphics = new Graphics()
    const structureGraphics = new Graphics()

    const portalOpen = (id: string) => scene.entities.find((e) => e.id === id)?.components?.portal?.open ?? true
    for (const run of layout.runs) {
      const p = toScreen(run.start * layout.cellSize, run.row * layout.cellSize)
      const width = (run.end - run.start) * layout.cellSize * ppu
      const height = layout.cellSize * ppu
      const target = run.kind === 'floor' ? floorGraphics : structureGraphics
      const fill = run.kind === 'portal' && run.portalId && !portalOpen(run.portalId) ? COLORS.portalClosed : run.fill
      const tint = this.options.zoneTint ?? 1
      if (run.kind === 'floor' && fill !== COLORS.floor && tint < 1) {
        // Scenario zone colours become soft tints over the floor so the map stays calm.
        target.rect(p.x, p.y, width, height).fill({ color: COLORS.floor, alpha: run.opacity })
        target.rect(p.x, p.y, width, height).fill({ color: fill, alpha: run.opacity * tint })
      } else {
        target.rect(p.x, p.y, width, height).fill({ color: fill, alpha: run.opacity })
      }
    }

    for (const entity of layout.entities) {
      const target = entity.kind === 'zone' ? floorGraphics : structureGraphics
      this.traceShape(target, entity.shape)
      if (entity.shape.kind !== 'thick_line' && entity.fill) target.fill({ color: entity.fill, alpha: entity.opacity })
      if (entity.shape.kind === 'thick_line') target.stroke({ width: entity.shape.width * ppu, color: entity.fill ?? COLORS.obstacle, alpha: entity.opacity })
      else if (entity.stroke && entity.strokeWidthPx > 0) target.stroke({ width: entity.strokeWidthPx, color: entity.stroke, alpha: entity.opacity })
    }

    for (const portal of layout.portals) {
      const p = toScreen(portal.x, portal.y)
      const tint = this.options.zoneTint ?? 1
      const doorFill = portal.open ? portal.fill : COLORS.portalClosed
      if (portal.open && portal.fill !== COLORS.portalOpen && tint < 1) {
        // A scenario's own door colour is softened like zone colours, over the theme's door colour.
        structureGraphics.rect(p.x, p.y, portal.width * ppu, portal.height * ppu).fill({ color: COLORS.portalOpen, alpha: portal.opacity })
        structureGraphics.rect(p.x, p.y, portal.width * ppu, portal.height * ppu).fill({ color: doorFill, alpha: portal.opacity * tint })
      } else {
        structureGraphics.rect(p.x, p.y, portal.width * ppu, portal.height * ppu).fill({ color: doorFill, alpha: portal.opacity })
      }
      if (!portal.open) {
        // Closed state is shown by a marker as well as colour.
        // Sized to the doorway so it never spills onto the walls; too small to read, the colour carries it.
        const markSize = Math.min(18, Math.min(portal.width, portal.height) * ppu * 0.9)
        if (markSize >= 7) {
          const mark = new Text({ text: '×', style: { fontFamily: this.font, fontSize: markSize, fill: '#FFFFFF' } })
          mark.anchor.set(0.5)
          mark.position.set(p.x + (portal.width * ppu) / 2, p.y + (portal.height * ppu) / 2)
          labels.addChild(mark)
        }
      }
    }

    // Labels scale with the map and stay inside their room; a label that no longer fits is hidden.
    const labelSize = Math.min(11, ppu * 0.45)
    if (labelSize >= 6) {
      const inset = Math.min(7, ppu * 0.3)
      for (const label of layout.labels) {
        const p = toScreen(label.x, label.y)
        const text = new Text({
          text: label.text.toUpperCase(),
          style: { fontFamily: this.font, fontSize: labelSize, fontWeight: '600', letterSpacing: labelSize * 0.08, fill: COLORS.label },
        })
        if (text.width > label.width * ppu - inset * 2 || text.height > label.height * ppu - inset * 2) {
          text.destroy()
          continue
        }
        text.position.set(p.x + inset, p.y + inset * 0.85)
        labels.addChild(text)
      }
    }
    floor.addChild(floorGraphics)
    structures.addChild(structureGraphics)
  }

  private traceShape(graphics: Graphics, shape: Shape) {
    const ppu = this.camera.pixelsPerUnit
    const points = (list: Vec2[]) => list.flatMap((point) => {
      const s = worldToScreen(this.camera, point)
      return [s.x, s.y]
    })
    switch (shape.kind) {
      case 'rectangle': {
        const p = worldToScreen(this.camera, shape)
        graphics.rect(p.x, p.y, shape.width * ppu, shape.height * ppu)
        return
      }
      case 'circle': {
        const p = worldToScreen(this.camera, shape.center)
        graphics.circle(p.x, p.y, shape.radius * ppu)
        return
      }
      case 'polygon':
        graphics.poly(points(shape.points))
        return
      case 'thick_line': {
        const flat = points(shape.points)
        graphics.moveTo(flat[0]!, flat[1]!)
        for (let i = 2; i < flat.length; i += 2) graphics.lineTo(flat[i]!, flat[i + 1]!)
        return
      }
    }
  }

  // ---------------------------------------------------------------- agents

  private drawAgents(previous: Parameters<typeof displayPositions>[0], current: Parameters<typeof displayPositions>[1]) {
    const now = performance.now()
    // The figure cache was emptied: re-point every sprite this frame, then free the old textures.
    const generation = this.atlas.generation
    if (generation !== this.atlasGeneration) for (const view of this.agentViews.values()) view.mode = null
    const positions = displayPositions(previous, current, now)
    const ppu = this.camera.pixelsPerUnit
    const seen = new Set<string>()
    for (const agent of current.frame.agents) {
      seen.add(agent.id)
      const metadata = this.metadata.get(agent.id) ?? null
      let view = this.agentViews.get(agent.id)
      if (!view) {
        view = {
          body: new Graphics(), figure: null, badge: null, label: null, state: null, metadata: null, pixelsPerUnit: 0, mode: null,
          radiusPx: 0, topPx: 0, badgeText: null, colors: { body: '', skin: '', hair: '' }, pose: null, fallen: false, rotates: false,
          last: null, heading: 0, phase: stableIndex(agent.id, 2),
        }
        this.layers.agents.addChild(view.body)
        this.agentViews.set(agent.id, view)
      }
      if (view.state !== agent.state || view.metadata !== metadata || view.pixelsPerUnit !== ppu || view.mode !== this.drawMode) {
        this.restyleAgent(view, agent.id, agent.state, metadata, ppu)
      }
      const screen = worldToScreen(this.camera, positions.get(agent.id)!)
      const moved = view.last ? Math.hypot(screen.x - view.last.x, screen.y - view.last.y) : 0
      if (view.last && moved > 0.05) view.heading = Math.atan2(screen.y - view.last.y, screen.x - view.last.x)
      const walking = agent.state === 'moving' && moved > 0.05
      view.last = screen

      if (view.figure && view.figure.visible) {
        const pose: FigurePose = view.fallen ? 'fallen'
          : walking ? ((Math.floor(now / 1000 / WALK_STEP_SECONDS) + view.phase) % 2 === 0 ? 'stepA' : 'stepB')
          : 'stand'
        if (pose !== view.pose) this.applyFigure(view, pose)
        view.figure.position.set(screen.x, screen.y)
        view.figure.zIndex = screen.y
      }
      view.body.position.set(screen.x, screen.y)
      view.body.zIndex = screen.y - 0.5
      if (view.rotates) view.body.rotation = view.heading
      view.badge?.position.set(screen.x + view.radiusPx * 0.6, screen.y - view.topPx - 14)
      view.label?.position.set(screen.x + view.radiusPx + 3, screen.y - 6)
    }
    for (const [id, view] of this.agentViews) {
      if (seen.has(id)) continue
      this.destroyAgentView(view)
      this.agentViews.delete(id)
    }
    if (generation !== this.atlasGeneration && this.atlas.generation === generation) {
      this.atlas.destroyRetired()
      this.atlasGeneration = generation
    }
  }

  private restyleAgent(view: AgentView, id: string, state: AgentState, metadata: RenderAgentMetadata | null, ppu: number) {
    const style = resolveAgentStyle(metadata?.appearance ?? {}, state)
    const annotation = stateAnnotation(state, style.pose)
    const radiusPx = (metadata?.radius ?? 0.5) * ppu
    const color = groupColor(metadata?.appearance?.fill)
    view.fallen = state === 'immobile' || style.pose === 'fallen'
    view.colors = {
      body: color,
      skin: SKIN_TONES[stableIndex(id, SKIN_TONES.length)]!,
      hair: HAIR_TONES[stableIndex(`${id}-hair`, HAIR_TONES.length)]!,
    }
    view.radiusPx = radiusPx
    const body = view.body.clear()
    body.rotation = 0

    if (this.drawMode === 'people') {
      if (!view.figure) {
        view.figure = new Sprite()
        this.layers.agents.addChild(view.figure)
      }
      view.figure.visible = true
      view.figure.alpha = style.opacity
      view.rotates = false
      this.applyFigure(view, view.fallen ? 'fallen' : 'stand')
      // Blocked or failed: a rose ring on the ground under the figure.
      if (annotation.ring) body.ellipse(0, radiusPx * 0.6, radiusPx * 1.2, radiusPx * 0.5).stroke({ width: 2, color: '#B75F74' })
    } else {
      if (view.figure) view.figure.visible = false
      const marker = markerShape(style, radiusPx * 0.9)
      const outline = { width: Math.max(1.25, radiusPx * 0.14), color: '#FCFCF9', alpha: style.opacity, join: 'round' as const }
      // Soft contact shadow under every marker.
      body.ellipse(0, radiusPx * 0.32, radiusPx * 0.72, radiusPx * 0.5).fill({ color: '#233D29', alpha: 0.12 * style.opacity })
      switch (marker.kind) {
        case 'circle':
          body.circle(0, 0, marker.radius).fill({ color, alpha: style.opacity }).stroke(outline)
          // Heading tick: the marker rotates to face its direction of travel.
          body.poly([marker.radius * 0.95, 0, marker.radius * 0.35, -marker.radius * 0.38, marker.radius * 0.35, marker.radius * 0.38])
            .fill({ color: '#FCFCF9', alpha: 0.9 * style.opacity })
          break
        case 'square':
          body.roundRect(-marker.side / 2, -marker.side / 2, marker.side, marker.side, marker.side * 0.24)
            .fill({ color, alpha: style.opacity }).stroke(outline)
          break
        case 'triangle':
          body.poly(marker.points).fill({ color, alpha: style.opacity }).stroke(outline)
          break
        case 'ellipse':
          // Fallen: a flattened capsule with an amber edge.
          body.roundRect(-radiusPx, -radiusPx * 0.38, radiusPx * 2, radiusPx * 0.76, radiusPx * 0.38)
            .fill({ color, alpha: style.opacity }).stroke({ width: 2, color: '#C08A3E' })
          break
      }
      if (annotation.ring) body.circle(0, 0, radiusPx + 2).stroke({ width: 2, color: '#B75F74' })
      view.rotates = marker.kind === 'circle'
      view.topPx = radiusPx
    }

    if (annotation.badge !== view.badgeText) {
      if (view.badge) { view.badge.destroy(); view.badge = null }
      if (annotation.badge) {
        view.badge = new BitmapText({ text: annotation.badge, style: { fontFamily: this.font, fontSize: 10, fontWeight: '600', fill: COLORS.label } })
        this.layers.annotations.addChild(view.badge)
      }
      view.badgeText = annotation.badge
    }
    const labelText = style.labelVisible ? (metadata?.label ?? id) : null
    if ((view.label?.text ?? null) !== labelText) {
      view.label?.destroy()
      view.label = null
      if (labelText) {
        view.label = new BitmapText({ text: labelText, style: { fontFamily: this.font, fontSize: 10, fontWeight: '600', fill: COLORS.label } })
        this.layers.labels.addChild(view.label)
      }
    }
    // Tags shrink with the people they belong to, and disappear once people are tiny.
    const tagScale = Math.max(0.6, Math.min(1, radiusPx / 10))
    for (const tag of [view.badge, view.label]) {
      if (!tag) continue
      tag.scale.set(tagScale)
      tag.visible = radiusPx >= 4
    }
    view.state = state
    view.metadata = metadata
    view.pixelsPerUnit = ppu
    view.mode = this.drawMode
  }

  /** Points a person's sprite at the pre-drawn figure for this pose and size. */
  private applyFigure(view: AgentView, pose: FigurePose) {
    if (!view.figure) return
    const art = this.atlas.get(view.colors.body, view.colors.skin, view.colors.hair, pose, view.radiusPx * 2.6)
    view.figure.texture = art.texture
    view.figure.anchor.set(art.anchorX, art.anchorY)
    view.pose = pose
    view.topPx = art.height * art.anchorY
  }

  private destroyAgentView(view: AgentView) {
    view.body.destroy()
    view.figure?.destroy()
    view.badge?.destroy()
    view.label?.destroy()
  }

  private clearAgents() {
    for (const view of this.agentViews.values()) this.destroyAgentView(view)
    this.agentViews.clear()
  }

  // ---------------------------------------------------------------- input

  private attachPointerInput(canvas: HTMLCanvasElement): () => void {
    let dragging: { x: number; y: number; id: number } | null = null
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const bounds = canvas.getBoundingClientRect()
      this.zoomAround({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }, event.deltaY < 0 ? 1.1 : 1 / 1.1)
    }
    const onDown = (event: PointerEvent) => {
      dragging = { x: event.clientX, y: event.clientY, id: event.pointerId }
      canvas.setPointerCapture(event.pointerId)
    }
    const onMove = (event: PointerEvent) => {
      if (!dragging || dragging.id !== event.pointerId) return
      this.pan({ x: event.clientX - dragging.x, y: event.clientY - dragging.y })
      dragging = { ...dragging, x: event.clientX, y: event.clientY }
    }
    const onUp = (event: PointerEvent) => {
      if (dragging?.id === event.pointerId) dragging = null
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    return () => {
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
    }
  }
}
