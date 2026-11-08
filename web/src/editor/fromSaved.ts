import type { PreparedMap } from '@crowd-control/contract'
import type { SavedVenue } from '../sim/savedVenues.ts'
import type { Door } from './doors.ts'
import type { LoadedPlan, PlanSeed } from './loadPlan.ts'
import { ROOM_COLORS, type Room } from './rooms.ts'
import { FLOOR, WALL } from './walls.ts'

/**
 * Reopening a saved floor plan in the editor. A saved plan keeps only its simulation grid, not
 * the image it was traced from, so the grid is drawn back as a plan (walls dark, floor white)
 * that the walls step drafts again, and the rooms, doors and scale start as they were saved.
 * Saving keeps the plan's ID, so the edit replaces the saved plan everywhere it's used.
 */

/** Image pixels per grid cell: enough detail to edit walls with a brush, within the pixel limit. */
export function pixelsPerCell(map: PreparedMap, maxPixels = 4_000_000): number {
  const cells = map.grid.width * map.grid.height
  return Math.max(2, Math.min(6, Math.floor(Math.sqrt(maxPixels / cells))))
}

/** Grid cells long, for the scale line drawn along the bottom of the plan. */
const SCALE_CELLS = 40

/** The rooms, doors, scale and labels of a saved plan, in the pixels of its redrawn image. */
export function seedFromSaved(venue: SavedVenue, k = pixelsPerCell(venue.map)): PlanSeed & { width: number; height: number } {
  const { map } = venue
  const grid = map.grid
  const width = grid.width * k, height = grid.height * k
  const entities = new Map(map.entities.map((entity) => [entity.id, entity]))
  // Zone k of the grid is room k; its name, tags and colour come from the saved zone.
  const rooms: Room[] = grid.zoneIds.flatMap((id, index): Room[] => {
    if (index === 0 || !id) return []
    const zone = entities.get(id)
    return [{ id: index, label: zone?.label ?? id, tags: [...(zone?.tags ?? [])], color: zone?.appearance?.fill ?? ROOM_COLORS[(index - 1) % ROOM_COLORS.length]! }]
  })
  const roomOf = new Map(grid.zoneIds.map((id, index) => [id, index]))
  const outside = new Set(rooms.filter((room) => room.tags.includes('outside')).map((room) => room.id))

  const doors: Door[] = []
  for (const entity of map.entities) {
    const portal = entity.components?.portal
    if (entity.kind !== 'portal' || !portal || entity.shape?.kind !== 'rectangle') continue
    let from = roomOf.get(portal.connects[0]) ?? 0, to = roomOf.get(portal.connects[1]) ?? 0
    if (!from || !to) continue
    const exit = outside.has(from) !== outside.has(to)
    // An exit lists the inside room first, as the editor does when it finds one.
    if (exit && outside.has(from)) [from, to] = [to, from]
    const rect = { x: (entity.shape.x / grid.cellSize) * k, y: (entity.shape.y / grid.cellSize) * k, width: (entity.shape.width / grid.cellSize) * k, height: (entity.shape.height / grid.cellSize) * k }
    doors.push({ id: doors.length + 1, from, to, rect, length: Math.max(rect.width, rect.height), detected: false, exit, oneWay: portal.oneWay ?? false, open: portal.open ?? true })
  }

  // Room labels per pixel; a door's cells join its first room so the two rooms meet across it.
  const portalRoom = new Map<number, number>()
  grid.portalIds.forEach((id, index) => {
    const door = id ? entities.get(id)?.components?.portal : undefined
    if (door) portalRoom.set(index, roomOf.get(door.connects[0]) ?? 0)
  })
  const labels = new Uint16Array(width * height)
  const kinds = new Uint8Array(width * height).fill(FLOOR)
  for (let cy = 0; cy < grid.height; cy++) {
    for (let cx = 0; cx < grid.width; cx++) {
      const c = cy * grid.width + cx
      if (grid.blocked[c] && !grid.portalIndex[c]) for (let y = cy * k; y < (cy + 1) * k; y++) kinds.fill(WALL, y * width + cx * k, y * width + (cx + 1) * k)
      const room = grid.portalIndex[c] ? (portalRoom.get(grid.portalIndex[c]!) ?? 0) : grid.blocked[c] ? 0 : grid.zoneIndex[c]!
      if (!room) continue
      for (let y = cy * k; y < (cy + 1) * k; y++) labels.fill(room, y * width + cx * k, y * width + (cx + 1) * k)
    }
  }

  // The saved scale as a measured line along the bottom of the plan (plans in metres only).
  const cells = Math.min(SCALE_CELLS, grid.width - 4)
  const scale = grid.units === 'm' && cells > 0
    ? { a: { x: 2 * k, y: height - 2 * k }, b: { x: (2 + cells) * k, y: height - 2 * k }, metres: cells * grid.cellSize }
    : null

  return { width, height, kinds, labels, rooms, doors, scale, floor: venue.floor, editing: map.id }
}

/** A saved plan as a plan the editor can open (browser only). */
export async function planFromSaved(venue: SavedVenue): Promise<LoadedPlan> {
  const { map } = venue
  const k = pixelsPerCell(map)
  const seed = seedFromSaved(venue, k)
  const canvas = document.createElement('canvas')
  canvas.width = seed.width
  canvas.height = seed.height
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, seed.width, seed.height)
  context.fillStyle = '#111111'
  const grid = map.grid
  for (let c = 0; c < grid.blocked.length; c++) {
    if (grid.blocked[c] && !grid.portalIndex[c]) context.fillRect((c % grid.width) * k, Math.floor(c / grid.width) * k, k, k)
  }
  const pixels = context.getImageData(0, 0, seed.width, seed.height)
  const bitmap = await createImageBitmap(canvas)
  const page = map.source.mode === 'upload' ? map.source.page : 1
  const { width, height, ...plan } = seed
  return {
    source: { assetId: map.id, revision: 'draft', page, mimeType: 'image/png', pixelWidth: width, pixelHeight: height, contentHash: map.id },
    pixels,
    fileName: venue.name,
    original: { width, height, bitmap },
    crop: null,
    seed: plan,
  }
}
