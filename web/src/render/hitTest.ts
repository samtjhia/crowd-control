import type { Frame, RenderScene, Vec2 } from '@crowd-control/contract'

/** Something on the map the user can point at. */
export type Pick = { kind: 'agent' | 'portal' | 'zone'; id: string }
export type PickKind = Pick['kind']

type Rect = { x: number; y: number; width: number; height: number }

const within = (p: Vec2, r: Rect, pad: number) => p.x >= r.x - pad && p.x <= r.x + r.width + pad && p.y >= r.y - pad && p.y <= r.y + r.height + pad

/** Door rectangles: portal records, plus portal entities that carry a rectangle. */
export function portalRects(scene: RenderScene): (Rect & { id: string })[] {
  const rects: (Rect & { id: string })[] = scene.map.portals.map(({ id, x, y, width, height }) => ({ id, x, y, width, height }))
  for (const entity of scene.entities) {
    if (entity.kind !== 'portal' || entity.shape?.kind !== 'rectangle' || rects.some((r) => r.id === entity.id)) continue
    const { x, y, width, height } = entity.shape
    rects.push({ id: entity.id, x, y, width, height })
  }
  return rects
}

/** The zone at a world point: grid membership on grid maps, otherwise the room rectangle. */
export function zoneAt(scene: RenderScene, p: Vec2): string | null {
  const { map } = scene
  if ('grid' in map && map.grid) {
    const { grid } = map
    const column = Math.floor(p.x / grid.cellSize), row = Math.floor(p.y / grid.cellSize)
    if (column < 0 || row < 0 || column >= grid.width || row >= grid.height) return null
    const i = row * grid.width + column
    return grid.blocked[i] === 1 ? null : grid.zoneIds[grid.zoneIndex[i]!] ?? null
  }
  return map.rooms.find((room) => within(p, room, 0))?.id ?? null
}

/**
 * What is under a world point, most specific first: the nearest person whose body (plus
 * `slop` world units) covers it, then a door, then the room. Departed people can't be picked.
 * `slop` lets small targets be hit at any zoom; callers pass a few screen pixels in world units.
 */
export function pickAt(scene: RenderScene, frame: Frame | null, positions: Map<string, Vec2>, p: Vec2, slop: number, kinds: readonly PickKind[]): Pick | null {
  if (kinds.includes('agent') && frame) {
    const radii = new Map(scene.agents.map((agent) => [agent.id, agent.radius]))
    let best: { id: string; distance: number } | null = null
    for (const agent of frame.agents) {
      if (agent.state === 'departed') continue
      const at = positions.get(agent.id) ?? agent
      const distance = Math.hypot(at.x - p.x, at.y - p.y)
      if (distance <= (radii.get(agent.id) ?? 0.5) + slop && (!best || distance < best.distance)) best = { id: agent.id, distance }
    }
    if (best) return { kind: 'agent', id: best.id }
  }
  if (kinds.includes('portal')) {
    const door = portalRects(scene).find((rect) => within(p, rect, slop))
    if (door) return { kind: 'portal', id: door.id }
  }
  if (kinds.includes('zone')) {
    const zone = zoneAt(scene, p)
    if (zone) return { kind: 'zone', id: zone }
  }
  return null
}

/**
 * A zone's floor as rectangles in world units: one strip per row run of its cells on grid
 * maps (so L-shapes and tables show correctly), or the room rectangle on generated maps.
 */
export function zoneStrips(scene: RenderScene, zoneId: string): Rect[] {
  const { map } = scene
  if (!('grid' in map && map.grid)) {
    const room = map.rooms.find((r) => r.id === zoneId)
    return room ? [{ x: room.x, y: room.y, width: room.width, height: room.height }] : []
  }
  const { grid } = map
  const zone = grid.zoneIds.indexOf(zoneId)
  const strips: Rect[] = []
  for (let row = 0; row < grid.height; row++) {
    let start = -1
    for (let column = 0; column <= grid.width; column++) {
      const i = row * grid.width + column
      const inside = column < grid.width && grid.blocked[i] === 0 && grid.zoneIndex[i] === zone
      if (inside && start < 0) start = column
      if (!inside && start >= 0) {
        strips.push({ x: start * grid.cellSize, y: row * grid.cellSize, width: (column - start) * grid.cellSize, height: grid.cellSize })
        start = -1
      }
    }
  }
  return strips
}
