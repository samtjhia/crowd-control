import type { CompiledMap, Shape, Vec2 } from '@crowd-control/contract'

export type Box = { x: number; y: number; width: number; height: number }
export type ZoneGeometry = { id: string; boxes: Box[]; area: number; center: Vec2 }

/** Axis-aligned bounds of any contract shape. The mock treats every shape as its bounds. */
export function shapeBounds(shape: Shape): Box {
  switch (shape.kind) {
    case 'rectangle':
      return { x: shape.x, y: shape.y, width: shape.width, height: shape.height }
    case 'circle':
      return { x: shape.center.x - shape.radius, y: shape.center.y - shape.radius, width: shape.radius * 2, height: shape.radius * 2 }
    case 'polygon':
    case 'thick_line': {
      const pad = shape.kind === 'thick_line' ? shape.width / 2 : 0
      const xs = shape.points.map((p) => p.x)
      const ys = shape.points.map((p) => p.y)
      const x = Math.min(...xs) - pad
      const y = Math.min(...ys) - pad
      return { x, y, width: Math.max(...xs) + pad - x, height: Math.max(...ys) + pad - y }
    }
  }
}

function centroid(boxes: Box[]): { area: number; center: Vec2 } {
  let area = 0, cx = 0, cy = 0
  for (const b of boxes) {
    const a = b.width * b.height
    area += a
    cx += (b.x + b.width / 2) * a
    cy += (b.y + b.height / 2) * a
  }
  return area > 0 ? { area, center: { x: cx / area, y: cy / area } } : { area: 0, center: { x: 0, y: 0 } }
}

/** Zone regions from rooms, zone entities and grid membership, keyed by zone ID. */
export function buildZones(map: CompiledMap): Map<string, ZoneGeometry> {
  const boxes = new Map<string, Box[]>()
  const add = (id: string, box: Box) => {
    const list = boxes.get(id)
    if (list) list.push(box)
    else boxes.set(id, [box])
  }
  for (const room of map.rooms) add(room.id, { x: room.x, y: room.y, width: room.width, height: room.height })
  for (const entity of map.entities ?? []) {
    if (entity.kind === 'zone' && entity.shape) add(entity.id, shapeBounds(entity.shape))
  }
  if ('grid' in map && map.grid) {
    const { grid } = map
    for (let i = 0; i < grid.zoneIndex.length; i++) {
      const zoneId = grid.zoneIds[grid.zoneIndex[i]!]
      if (!zoneId || grid.blocked[i] === 1) continue
      add(zoneId, { x: (i % grid.width) * grid.cellSize, y: Math.floor(i / grid.width) * grid.cellSize, width: grid.cellSize, height: grid.cellSize })
    }
  }
  const zones = new Map<string, ZoneGeometry>()
  for (const [id, list] of boxes) zones.set(id, { id, boxes: list, ...centroid(list) })
  return zones
}

/** Centres of every non-agent entity (rooms, portals, map entities, grid portals). */
export function buildCenters(map: CompiledMap, zones: Map<string, ZoneGeometry>): Map<string, Vec2> {
  const centers = new Map<string, Vec2>()
  for (const [id, zone] of zones) centers.set(id, zone.center)
  for (const portal of map.portals) centers.set(portal.id, { x: portal.x + portal.width / 2, y: portal.y + portal.height / 2 })
  for (const entity of map.entities ?? []) {
    if (entity.shape && !centers.has(entity.id)) {
      const b = shapeBounds(entity.shape)
      centers.set(entity.id, { x: b.x + b.width / 2, y: b.y + b.height / 2 })
    }
  }
  if ('grid' in map && map.grid) {
    const { grid } = map
    const cells = new Map<string, Box[]>()
    for (let i = 0; i < grid.portalIndex.length; i++) {
      const portalId = grid.portalIds[grid.portalIndex[i]!]
      if (!portalId || centers.has(portalId)) continue
      const box = { x: (i % grid.width) * grid.cellSize, y: Math.floor(i / grid.width) * grid.cellSize, width: grid.cellSize, height: grid.cellSize }
      const list = cells.get(portalId)
      if (list) list.push(box)
      else cells.set(portalId, [box])
    }
    for (const [id, list] of cells) centers.set(id, centroid(list).center)
  }
  return centers
}

export function inZone(zone: ZoneGeometry, p: Vec2): boolean {
  return zone.boxes.some((b) => p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height)
}

/** Technical PRD §10 LCG: returns the next uint32 state. */
export function nextRandom(state: number): number {
  return (Math.imul(1664525, state) + 1013904223) >>> 0
}

/** Stable per-agent stream seed (FNV-1a of the ID mixed with the master seed). */
export function streamSeed(seed: number, key: string): number {
  let h = (0x811c9dc5 ^ seed) >>> 0
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0
  return h
}

/** Draws a point inside the zone, keeping `margin` from box edges where possible. */
export function randomPointInZone(zone: ZoneGeometry, state: number, margin: number): { point: Vec2; state: number } {
  let s = nextRandom(state)
  let pick = (s / 4294967296) * zone.area
  let box = zone.boxes[zone.boxes.length - 1]!
  for (const b of zone.boxes) {
    pick -= b.width * b.height
    if (pick < 0) { box = b; break }
  }
  const mx = Math.min(margin, box.width / 2)
  const my = Math.min(margin, box.height / 2)
  s = nextRandom(s)
  const x = box.x + mx + (s / 4294967296) * (box.width - 2 * mx)
  s = nextRandom(s)
  const y = box.y + my + (s / 4294967296) * (box.height - 2 * my)
  return { point: { x, y }, state: s }
}
