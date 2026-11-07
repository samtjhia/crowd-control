import type { RenderInput } from '@crowd-control/contract'

type Graphics = {
  rect(x: number, y: number, width: number, height: number): Graphics
  circle(x: number, y: number, radius: number): Graphics
  poly(points: number[]): Graphics
  moveTo(x: number, y: number): Graphics
  lineTo(x: number, y: number): Graphics
  fill(color: string): Graphics
  stroke(style: { color: string; width: number }): Graphics
  position: { set(x: number, y: number): void }
  alpha: number
  visible: boolean
  destroy(): void
}
type Application = {
  init(options: { width: number; height: number; background: string; antialias: boolean }): Promise<void>
  canvas: HTMLCanvasElement
  stage: { addChild(graphic: Graphics): void; removeChildren(): Graphics[] }
  destroy(removeView: boolean, options: { children: boolean }): void
}
type Pixi = { Application: new () => Application; Graphics: new () => Graphics }

export async function createStaticRenderer(host: HTMLElement) {
  // shortcut: the smoke-test view pins a CDN bundle; bundle Pixi via npm for the product renderer.
  const url = 'https://pixijs.download/v8.22.0/pixi.min.mjs'
  const pixi: Pixi = await import(/* @vite-ignore */ url)
  if (typeof pixi.Application !== 'function' || typeof pixi.Graphics !== 'function') throw new Error('Invalid PixiJS bundle')
  const app = new pixi.Application()
  await app.init({ width: 800, height: 400, background: '#F1F5F9', antialias: true })
  app.canvas.setAttribute('role', 'img')
  app.canvas.setAttribute('aria-label', 'Initialized crowd scene from the Rust engine')
  host.appendChild(app.canvas)
  let currentScene: RenderInput['scene'] | undefined
  let currentScale = 0
  let currentPan = { x: NaN, y: NaN }
  const agents = new Map<string, Graphics>()
  return {
    render(input: RenderInput) {
      const { scene, frame, camera } = input
      const scale = camera.pixelsPerUnit
      if (currentScene !== scene || currentScale !== scale || currentPan.x !== camera.pan.x || currentPan.y !== camera.pan.y) {
        for (const graphic of app.stage.removeChildren()) graphic.destroy()
        agents.clear()
        const map = scene.map
        const drawCell = (x: number, y: number, color: string, slow = false) => {
          const graphic = new pixi.Graphics().rect((x * map.cellSize - camera.pan.x) * scale, (y * map.cellSize - camera.pan.y) * scale, map.cellSize * scale, map.cellSize * scale).fill(color)
          if (slow) graphic.stroke({ color: '#D97706', width: 2 })
          app.stage.addChild(graphic)
        }
        const paint = (x: number, y: number, blocked: boolean, id: string | null | undefined, terrain = 1) => {
          const room = map.rooms.find((r) => r.id === id)
          const portal = map.portals.find((p) => p.id === id)
          const entity = scene.entities.find((e) => e.id === id)
          drawCell(x, y, blocked ? '#334155' : room?.appearance?.fill ?? portal?.appearance?.fill ?? entity?.appearance?.fill ?? '#E2E8F0', !blocked && terrain < 1)
        }
        if ('grid' in map) {
          const grid = map.grid
          grid.blocked.forEach((blocked, i) => paint(i % grid.width, Math.floor(i / grid.width), blocked === 1, grid.portalIds[grid.portalIndex[i]!] ?? grid.zoneIds[grid.zoneIndex[i]!], grid.terrainSpeedMultiplier?.[i]))
        } else map.rows.forEach((row, y) => [...row].forEach((glyph, x) => paint(x, y, glyph === '#', map.legend[glyph])))
        for (const entity of scene.entities) {
          if (!entity.shape || entity.kind === 'zone' || entity.kind === 'portal') continue
          const shape = entity.shape, graphic = new pixi.Graphics()
          const x = (value: number) => (value - camera.pan.x) * scale
          const y = (value: number) => (value - camera.pan.y) * scale
          const fill = entity.appearance?.fill ?? '#64748B'
          switch (shape.kind) {
            case 'rectangle': graphic.rect(x(shape.x), y(shape.y), shape.width * scale, shape.height * scale).fill(fill); break
            case 'circle': graphic.circle(x(shape.center.x), y(shape.center.y), shape.radius * scale).fill(fill); break
            case 'polygon': graphic.poly(shape.points.flatMap((p) => [x(p.x), y(p.y)])).fill(fill); break
            case 'thick_line':
              graphic.moveTo(x(shape.points[0]!.x), y(shape.points[0]!.y))
              for (const p of shape.points.slice(1)) graphic.lineTo(x(p.x), y(p.y))
              graphic.stroke({ color: fill, width: shape.width * scale }); break
          }
          if (entity.appearance?.stroke) graphic.stroke({ color: entity.appearance.stroke, width: entity.appearance.strokeWidthPx ?? 1 })
          graphic.alpha = entity.appearance?.opacity ?? 1
          app.stage.addChild(graphic)
        }
        for (const agent of scene.agents) {
          const r = agent.radius * scale
          const graphic = new pixi.Graphics()
          if (agent.appearance.pose === 'fallen') graphic.rect(-r * 0.9, -r * 0.3, r * 1.8, r * 0.6)
          else switch (agent.appearance.symbol ?? 'circle') {
            case 'circle': graphic.circle(0, 0, r); break
            case 'square': graphic.rect(-r / Math.SQRT2, -r / Math.SQRT2, r * Math.SQRT2, r * Math.SQRT2); break
            case 'triangle': graphic.poly([0, -r, Math.sqrt(3) * r / 2, r / 2, -Math.sqrt(3) * r / 2, r / 2]); break
          }
          graphic.fill(agent.appearance.fill ?? '#2563EB')
          if (agent.appearance.stroke) graphic.stroke({ color: agent.appearance.stroke, width: agent.appearance.strokeWidthPx ?? 1 })
          graphic.alpha = agent.appearance.opacity ?? 1
          agents.set(agent.id, graphic)
          app.stage.addChild(graphic)
        }
        currentScene = scene
        currentScale = scale
        currentPan = { ...camera.pan }
      }
      for (const graphic of agents.values()) graphic.visible = false
      for (const agent of frame.agents) {
        const graphic = agents.get(agent.id)
        if (!graphic) throw new Error(`Missing scene metadata for ${agent.id}`)
        graphic.visible = agent.state !== 'departed'
        graphic.position.set((agent.x - camera.pan.x) * scale, (agent.y - camera.pan.y) * scale)
      }
    },
    destroy() { app.destroy(true, { children: true }) },
  }
}
