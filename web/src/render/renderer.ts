import { Application, BitmapText, Container, Graphics, Text } from 'pixi.js'
import type { AgentState, Camera, RenderAgentMetadata, RenderScene, Shape, Vec2 } from '@crowd-control/contract'
import type { SimulationClient } from '../worker/simulationClient.ts'
import { markerShape, resolveAgentStyle, stateAnnotation } from './agentStyle.ts'
import { fitCamera, panBy, worldToScreen, zoomAt } from './camera.ts'
import { displayPositions } from './interpolate.ts'
import { COLORS, layoutMap, type MapLayout } from './mapLayout.ts'

export type RendererOptions = {
  /** Upper bound for the initial canvas height in CSS pixels. */
  maxHeight?: number
}

type AgentView = {
  body: Graphics
  badge: BitmapText | null
  label: BitmapText | null
  state: AgentState | null
  metadata: RenderAgentMetadata | null
  pixelsPerUnit: number
  radiusPx: number
  badgeText: string | null
}

const BADGE_STYLE = { fontFamily: 'Arial', fontSize: 11, fill: COLORS.label } as const

/**
 * PixiJS bird's-eye renderer (Technical PRD §12). Reads the SimulationClient view on every
 * animation frame; it never mutates simulation state and never keeps its own positions.
 * Layer order, back to front: floor/zones → heatmap → walls/objects/portals → agents →
 * status annotations → labels.
 */
export class CrowdRenderer {
  readonly app: Application
  private readonly client: SimulationClient
  private readonly host: HTMLElement
  private readonly options: RendererOptions
  private readonly layers = {
    floor: new Container(),
    heatmap: new Container(), // Density overlay arrives in the next phase.
    structures: new Container(),
    agents: new Container(),
    annotations: new Container(),
    labels: new Container(),
  }
  private readonly agentViews = new Map<string, AgentView>()
  private readonly metadata = new Map<string, RenderAgentMetadata>()
  private readonly detachInput: () => void
  private camera: Camera = { pan: { x: 0, y: 0 }, pixelsPerUnit: 20 }
  private homeCamera: Camera = this.camera
  private scene: RenderScene | null = null
  private layout: MapLayout | null = null
  private mapDrawnFor: { scene: RenderScene; camera: Camera } | null = null

  static async create(host: HTMLElement, client: SimulationClient, options: RendererOptions = {}): Promise<CrowdRenderer> {
    const app = new Application()
    await app.init({ width: 480, height: 120, background: '#FFFFFF', antialias: true, preference: 'webgl', resolution: window.devicePixelRatio || 1, autoDensity: true })
    return new CrowdRenderer(app, host, client, options)
  }

  private constructor(app: Application, host: HTMLElement, client: SimulationClient, options: RendererOptions) {
    this.app = app
    this.host = host
    this.client = client
    this.options = options
    app.canvas.setAttribute('role', 'img')
    app.canvas.setAttribute('aria-label', 'Bird’s-eye view of the simulated crowd')
    host.appendChild(app.canvas)
    app.stage.addChild(...Object.values(this.layers))
    this.detachInput = this.attachPointerInput(app.canvas)
    app.ticker.add(() => this.draw())
  }

  /** Multiplies the zoom around the canvas centre (keyboard +/−). */
  zoom(factor: number) {
    this.camera = zoomAt(this.camera, { x: this.app.screen.width / 2, y: this.app.screen.height / 2 }, factor)
  }

  pan(deltaPx: Vec2) {
    this.camera = panBy(this.camera, deltaPx)
  }

  resetCamera() {
    this.camera = this.homeCamera
  }

  destroy() {
    this.detachInput()
    this.app.destroy(true, { children: true })
    this.agentViews.clear()
  }

  // ---------------------------------------------------------------- frame loop

  private draw() {
    const view = this.client.getView()
    if (view.scene !== this.scene) this.acceptScene(view.scene)
    if (!this.scene || !this.layout) return
    if (!this.mapDrawnFor || this.mapDrawnFor.scene !== this.scene || this.mapDrawnFor.camera !== this.camera) {
      this.drawMap(this.layout, this.scene)
      this.mapDrawnFor = { scene: this.scene, camera: this.camera }
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
      const world = { width: this.layout.worldWidth, height: this.layout.worldHeight }
      this.homeCamera = fitCamera(world, { width: this.host.clientWidth || world.width * 20, height: this.options.maxHeight ?? 560 })
      this.camera = this.homeCamera
      this.app.renderer.resize(Math.round(world.width * this.camera.pixelsPerUnit), Math.round(world.height * this.camera.pixelsPerUnit))
    }
    if (!scene) this.clearAgents()
  }

  // ---------------------------------------------------------------- map

  private drawMap(layout: MapLayout, scene: RenderScene) {
    const { floor, structures, labels } = this.layers
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
      target.rect(p.x, p.y, width, height).fill({ color: fill, alpha: run.opacity })
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
      structureGraphics.rect(p.x, p.y, portal.width * ppu, portal.height * ppu).fill({ color: portal.open ? portal.fill : COLORS.portalClosed, alpha: portal.opacity })
      if (!portal.open) {
        // Closed state is shown by a marker as well as colour.
        const mark = new Text({ text: '×', style: { fontFamily: 'Arial', fontSize: Math.max(12, portal.width * ppu), fill: '#FFFFFF' } })
        mark.anchor.set(0.5)
        mark.position.set(p.x + (portal.width * ppu) / 2, p.y + (portal.height * ppu) / 2)
        labels.addChild(mark)
      }
    }

    for (const label of layout.labels) {
      const p = toScreen(label.x, label.y)
      const text = new Text({ text: label.text, style: { fontFamily: 'Arial', fontSize: 12, fill: COLORS.label } })
      text.position.set(p.x + 4, p.y + 2)
      labels.addChild(text)
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
    const positions = displayPositions(previous, current, performance.now())
    const ppu = this.camera.pixelsPerUnit
    const seen = new Set<string>()
    for (const agent of current.frame.agents) {
      seen.add(agent.id)
      const metadata = this.metadata.get(agent.id) ?? null
      let view = this.agentViews.get(agent.id)
      if (!view) {
        view = { body: new Graphics(), badge: null, label: null, state: null, metadata: null, pixelsPerUnit: 0, radiusPx: 0, badgeText: null }
        this.layers.agents.addChild(view.body)
        this.agentViews.set(agent.id, view)
      }
      if (view.state !== agent.state || view.metadata !== metadata || view.pixelsPerUnit !== ppu) {
        this.restyleAgent(view, agent.id, agent.state, metadata, ppu)
      }
      const screen = worldToScreen(this.camera, positions.get(agent.id)!)
      view.body.position.set(screen.x, screen.y)
      view.badge?.position.set(screen.x + view.radiusPx + 2, screen.y - view.radiusPx - 12)
      view.label?.position.set(screen.x + view.radiusPx + 2, screen.y - 5)
    }
    for (const [id, view] of this.agentViews) {
      if (seen.has(id)) continue
      this.destroyAgentView(view)
      this.agentViews.delete(id)
    }
  }

  private restyleAgent(view: AgentView, id: string, state: AgentState, metadata: RenderAgentMetadata | null, ppu: number) {
    const style = resolveAgentStyle(metadata?.appearance ?? {}, state)
    const annotation = stateAnnotation(state, style.pose)
    const radiusPx = (metadata?.radius ?? 0.5) * ppu
    const marker = markerShape(style, radiusPx)
    const body = view.body.clear()
    switch (marker.kind) {
      case 'circle': body.circle(0, 0, marker.radius); break
      case 'square': body.rect(-marker.side / 2, -marker.side / 2, marker.side, marker.side); break
      case 'triangle': body.poly(marker.points); break
      case 'ellipse': body.ellipse(0, 0, marker.radiusX, marker.radiusY); break
    }
    body.fill({ color: style.fill, alpha: style.opacity })
    if (style.stroke) body.stroke({ width: style.strokeWidthPx, color: style.stroke, alpha: style.opacity })
    if (annotation.ring) body.circle(0, 0, radiusPx + 2).stroke({ width: 2, color: annotation.ring })

    if (annotation.badge !== view.badgeText) {
      if (view.badge) { view.badge.destroy(); view.badge = null }
      if (annotation.badge) {
        view.badge = new BitmapText({ text: annotation.badge, style: BADGE_STYLE })
        this.layers.annotations.addChild(view.badge)
      }
      view.badgeText = annotation.badge
    }
    const labelText = style.labelVisible ? (metadata?.label ?? id) : null
    if ((view.label?.text ?? null) !== labelText) {
      view.label?.destroy()
      view.label = null
      if (labelText) {
        view.label = new BitmapText({ text: labelText, style: { ...BADGE_STYLE, fill: style.stroke ?? COLORS.label } })
        this.layers.labels.addChild(view.label)
      }
    }
    view.state = state
    view.metadata = metadata
    view.pixelsPerUnit = ppu
    view.radiusPx = radiusPx
  }

  private destroyAgentView(view: AgentView) {
    view.body.destroy()
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
      this.camera = zoomAt(this.camera, { x: event.clientX - bounds.left, y: event.clientY - bounds.top }, event.deltaY < 0 ? 1.1 : 1 / 1.1)
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
