import type { Result } from '@crowd-control/contract'
import { fail, ok } from '../result.ts'

/** An axis-aligned area to paint onto the grid, in world units. */
export type GridRect = { id: string; x: number; y: number; width: number; height: number }

/** The glyph-row map encoding the engine reads today: one character per cell, `#` is wall. */
export type GlyphGrid = { rows: string[]; legend: { [glyph: string]: string } }

const WALL = '#'
const FALLBACK = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/**
 * Picks a distinct single-character glyph per ID. It prefers the initials of the ID's words,
 * last word first, so `hall` → H and `hall_door` → D, as in the Technical PRD's worked example;
 * then any letter of the ID; then any free letter or digit. Glyphs are display/debug labels
 * that the legend maps back to IDs; they never carry meaning of their own.
 */
export function assignGlyphs(ids: string[]): Result<Map<string, string>> {
  const used = new Set([WALL])
  const glyphs = new Map<string, string>()
  for (const id of ids) {
    const words = id.split(/[^A-Za-z0-9]+/).filter(Boolean)
    const initials = words.map((word) => word[0]!.toUpperCase()).reverse()
    const letters = [...id.toUpperCase()].filter((c) => /[A-Z0-9]/.test(c))
    const glyph = [...initials, ...letters, ...FALLBACK].find((c) => !used.has(c))
    if (!glyph) return fail('RESOURCE_LIMIT', `Too many rooms and doors for a glyph map (at most ${FALLBACK.length})`, { affectedIds: [id] })
    used.add(glyph)
    glyphs.set(id, glyph)
  }
  return ok(glyphs)
}

/**
 * Paints areas onto a wall-filled grid (Technical PRD §8 "Rasterization and spawning").
 * Later areas paint over earlier ones, so pass rooms first and doors after: a door cell
 * belongs to the door. Cell bounds round to the nearest grid line.
 */
export function rasterize(areas: GridRect[], worldWidth: number, worldHeight: number, cellSize: number): Result<GlyphGrid> {
  const glyphs = assignGlyphs(areas.map((area) => area.id))
  if (!glyphs.ok) return glyphs
  const columns = Math.round(worldWidth / cellSize)
  const rowCount = Math.round(worldHeight / cellSize)
  const grid = Array.from({ length: rowCount }, () => Array<string>(columns).fill(WALL))
  for (const area of areas) {
    const glyph = glyphs.value.get(area.id)!
    const left = Math.max(0, Math.round(area.x / cellSize))
    const right = Math.min(columns, Math.round((area.x + area.width) / cellSize))
    const top = Math.max(0, Math.round(area.y / cellSize))
    const bottom = Math.min(rowCount, Math.round((area.y + area.height) / cellSize))
    for (let y = top; y < bottom; y++) grid[y]!.fill(glyph, left, right)
  }
  const legend: { [glyph: string]: string } = {}
  for (const [id, glyph] of glyphs.value) legend[glyph] = id
  return ok({ rows: grid.map((row) => row.join('')), legend })
}

/** Cell count per ID, e.g. to check that a 10×4 room really covers 40 cells. */
export function cellCounts({ rows, legend }: GlyphGrid): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const glyph of row) {
      const id = legend[glyph]
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }
  return counts
}

/**
 * IDs that cannot be reached from the first area through walkable cells (four-way moves,
 * so routes never squeeze diagonally between walls). Empty means everything connects.
 */
export function unreachable({ rows, legend }: GlyphGrid, firstId: string): string[] {
  const height = rows.length
  const width = rows[0]?.length ?? 0
  const walkable = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && rows[y]![x] !== WALL
  const start = rows.flatMap((row, y) => [...row].map((glyph, x) => ({ x, y, glyph }))).find((cell) => legend[cell.glyph] === firstId)
  const reached = new Set<string>()
  if (start) {
    const seen = new Uint8Array(width * height)
    const queue = [start]
    seen[start.y * width + start.x] = 1
    while (queue.length > 0) {
      const { x, y } = queue.pop()!
      const id = legend[rows[y]![x]!]
      if (id) reached.add(id)
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (!walkable(nx, ny) || seen[ny * width + nx]) continue
        seen[ny * width + nx] = 1
        queue.push({ x: nx, y: ny, glyph: rows[ny]![nx]! })
      }
    }
  }
  return Object.values(legend).filter((id) => !reached.has(id))
}
