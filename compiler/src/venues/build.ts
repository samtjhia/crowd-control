import { parseContract, PreparedMapSchema, type EntityBlueprint, type GridData, type MapAppearance, type PreparedMap, type Result } from '@crowd-control/contract'
import { fail } from '../result.ts'

/** An axis-aligned rectangle in metres, origin top-left, y down. */
export type MetreRect = { x: number; y: number; width: number; height: number }

/** A walkable named area. Several rectangles make L-shapes, corridors with alcoves, and so on. */
export type VenueArea = {
  id: string
  label?: string
  tags?: string[]
  appearance?: MapAppearance
  rects: MetreRect[]
  /** Movement cost on this area's cells; 1 is ordinary floor. */
  cost?: number
}

/**
 * A measured opening between two areas. It may sit in a wall between them, or overlap their
 * shared edge where nothing physical separates them (one end of an open alley from the other).
 */
export type VenuePortal = {
  id: string
  label?: string
  tags?: string[]
  appearance?: MapAppearance
  rect: MetreRect
  connects: [string, string]
  open?: boolean
  oneWay?: boolean
}

/** A patch of higher (or lower) movement cost, such as the uphill stretch of a sloped alley. */
export type VenueCost = { rect: MetreRect; cost: number }

/**
 * A prepared venue as authored in TypeScript: measured rectangles in metres. Everything not
 * covered by an area or portal is wall. Every edge must sit on the cell grid, so a measured
 * door is never silently widened or narrowed (Technical PRD §7); use a finer cell instead.
 */
export type VenueSpec = {
  id: string
  revision: string
  venue: string
  floor: string
  /** Metres per cell; 0.25 for the prepared venues. */
  cellSize: number
  width: number
  height: number
  areas: VenueArea[]
  portals: VenuePortal[]
  costs?: VenueCost[]
}

const EPSILON = 1e-6

function whole(value: number): number | undefined {
  const rounded = Math.round(value)
  return Math.abs(value - rounded) <= EPSILON ? rounded : undefined
}

type CellRect = { left: number; top: number; right: number; bottom: number }

/**
 * Turns a venue spec into a reviewed `PreparedMap` with a metre-scaled `GridData` grid
 * (`index = y × width + x`). Zones and portals are also listed as entities, with their bounding
 * rectangles and portal connections, so the compiler can recover labels, tags and appearance.
 * The result is checked: areas don't overlap, each portal touches both areas it connects,
 * every area is reachable, and the whole map passes `PreparedMapSchema`.
 */
export function buildPreparedMap(spec: VenueSpec): Result<PreparedMap> {
  const { cellSize } = spec
  const columns = whole(spec.width / cellSize)
  const rows = whole(spec.height / cellSize)
  if (!(cellSize > 0) || columns === undefined || rows === undefined || columns < 1 || rows < 1) {
    return fail('LAYOUT_CONSTRAINTS_UNSATISFIABLE', `A ${spec.width} × ${spec.height} m venue is not a whole number of ${cellSize} m cells`, { path: 'venue' })
  }
  const toCells = (rect: MetreRect, path: string): Result<CellRect> => {
    const [left, top, right, bottom] = [rect.x / cellSize, rect.y / cellSize, (rect.x + rect.width) / cellSize, (rect.y + rect.height) / cellSize].map(whole)
    if (left === undefined || top === undefined || right === undefined || bottom === undefined) {
      return fail('LAYOUT_CONSTRAINTS_UNSATISFIABLE', `Edges must sit on the ${cellSize} m grid; use a finer cell size rather than resizing measured geometry`, { path })
    }
    if (left < 0 || top < 0 || right > columns || bottom > rows || right <= left || bottom <= top) {
      return fail('LAYOUT_CONSTRAINTS_UNSATISFIABLE', 'Rectangle is empty or outside the venue', { path })
    }
    return { ok: true, value: { left, top, right, bottom } }
  }

  const ids = [...spec.areas.map((area) => area.id), ...spec.portals.map((portal) => portal.id)]
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index)
  if (duplicate !== undefined) return fail('INVALID_SCHEMA', `Duplicate venue ID "${duplicate}"`, { path: 'venue', affectedIds: [duplicate] })

  const size = columns * rows
  const blocked = new Array<0 | 1>(size).fill(1)
  const traversalCost = new Array<number>(size).fill(1)
  const zoneIndex = new Array<number>(size).fill(0)
  const portalIndex = new Array<number>(size).fill(0)
  const zoneIds: (string | null)[] = [null, ...spec.areas.map((area) => area.id)]
  const portalIds: (string | null)[] = [null, ...spec.portals.map((portal) => portal.id)]
  const each = (cells: CellRect, visit: (i: number) => void) => {
    for (let y = cells.top; y < cells.bottom; y++) for (let x = cells.left; x < cells.right; x++) visit(y * columns + x)
  }

  for (const [a, area] of spec.areas.entries()) {
    if (area.rects.length === 0) return fail('LAYOUT_CONSTRAINTS_UNSATISFIABLE', `Area "${area.id}" has no floor`, { path: `venue.areas.${a}.rects` })
    for (const [r, rect] of area.rects.entries()) {
      const cells = toCells(rect, `venue.areas.${a}.rects.${r}`)
      if (!cells.ok) return cells
      let clash: string | undefined
      each(cells.value, (i) => {
        if (zoneIndex[i] !== 0 && zoneIndex[i] !== a + 1) clash = zoneIds[zoneIndex[i]!]!
        blocked[i] = 0
        zoneIndex[i] = a + 1
        traversalCost[i] = area.cost ?? 1
      })
      if (clash !== undefined) return fail('LAYOUT_CONSTRAINTS_UNSATISFIABLE', `Area "${area.id}" overlaps "${clash}"`, { path: `venue.areas.${a}.rects.${r}`, affectedIds: [area.id, clash] })
    }
  }

  for (const [p, portal] of spec.portals.entries()) {
    const path = `venue.portals.${p}`
    const unknown = portal.connects.filter((id) => !spec.areas.some((area) => area.id === id))
    if (unknown.length > 0) return fail('NOT_FOUND', `Portal "${portal.id}" connects unknown area ${unknown.join(', ')}`, { path: `${path}.connects`, affectedIds: unknown })
    const cells = toCells(portal.rect, `${path}.rect`)
    if (!cells.ok) return cells
    each(cells.value, (i) => {
      blocked[i] = 0
      portalIndex[i] = p + 1
    })
    // Each connected area must contain or border at least one of the opening's cells.
    for (const id of portal.connects) {
      const zone = zoneIds.indexOf(id)
      let touches = false
      each(cells.value, (i) => {
        const x = i % columns
        const near = [i, x > 0 ? i - 1 : -1, x < columns - 1 ? i + 1 : -1, i - columns, i + columns]
        if (near.some((j) => j >= 0 && j < size && zoneIndex[j] === zone)) touches = true
      })
      if (!touches) return fail('LAYOUT_CONSTRAINTS_UNSATISFIABLE', `Portal "${portal.id}" does not reach "${id}"`, { path: `${path}.rect`, affectedIds: [portal.id, id] })
    }
  }

  for (const [c, patch] of (spec.costs ?? []).entries()) {
    if (!(patch.cost > 0) || !Number.isFinite(patch.cost)) return fail('INVALID_SCHEMA', 'Movement cost must be positive', { path: `venue.costs.${c}.cost` })
    const cells = toCells(patch.rect, `venue.costs.${c}.rect`)
    if (!cells.ok) return cells
    each(cells.value, (i) => {
      if (blocked[i] === 0) traversalCost[i] = patch.cost
    })
  }

  const cut = unreachableZones(blocked, zoneIndex, columns, rows, zoneIds)
  if (cut.length > 0) return fail('LAYOUT_CONSTRAINTS_UNSATISFIABLE', `Not every area connects: ${cut.join(', ')} cannot be reached`, { path: 'venue', affectedIds: cut })

  const grid: GridData = { width: columns, height: rows, cellSize, units: 'm', blocked, traversalCost, zoneIndex, portalIndex, zoneIds, portalIds }
  const metadata = (item: { label?: string; tags?: string[]; appearance?: MapAppearance }) => ({
    ...(item.label !== undefined && { label: item.label }),
    ...(item.tags !== undefined && { tags: [...item.tags] }),
    ...(item.appearance !== undefined && { appearance: { ...item.appearance } }),
  })
  const entities: EntityBlueprint[] = [
    ...spec.areas.map((area, a): EntityBlueprint => ({ id: area.id, kind: 'zone', ...metadata(area), shape: { kind: 'rectangle', ...cellBounds(zoneIndex, a + 1, columns, cellSize) } })),
    ...spec.portals.map((portal, p): EntityBlueprint => ({
      id: portal.id, kind: 'portal', ...metadata(portal),
      components: { portal: { connects: [portal.connects[0], portal.connects[1]], open: portal.open ?? true, ...(portal.oneWay !== undefined && { oneWay: portal.oneWay }) } },
      shape: { kind: 'rectangle', ...cellBounds(portalIndex, p + 1, columns, cellSize) },
    })),
  ]
  const prepared = {
    id: spec.id,
    revision: spec.revision,
    source: { mode: 'lookup' as const, assetId: spec.id, revision: spec.revision, venue: spec.venue, floor: spec.floor },
    grid,
    entities,
    reviewed: true as const,
  }
  return parseContract(PreparedMapSchema, prepared)
}

/** Bounding rectangle, in world units, of the cells whose index equals `value`. */
export function cellBounds(indices: ArrayLike<number>, value: number, columns: number, cellSize: number): MetreRect {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] !== value) continue
    const x = i % columns, y = Math.floor(i / columns)
    left = Math.min(left, x); right = Math.max(right, x + 1)
    top = Math.min(top, y); bottom = Math.max(bottom, y + 1)
  }
  if (left === Infinity) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: left * cellSize, y: top * cellSize, width: (right - left) * cellSize, height: (bottom - top) * cellSize }
}

/** Zones with no walkable path from the first zone (four-way moves, every portal open). */
export function unreachableZones(blocked: ArrayLike<number>, zoneIndex: ArrayLike<number>, columns: number, rows: number, zoneIds: (string | null)[]): string[] {
  const start = Array.prototype.findIndex.call(zoneIndex, (z: number) => z === 1)
  const reached = new Set<number>()
  if (start >= 0) {
    const seen = new Uint8Array(columns * rows)
    const stack = [start]
    seen[start] = 1
    while (stack.length > 0) {
      const i = stack.pop()!
      reached.add(zoneIndex[i]!)
      const x = i % columns
      for (const j of [x > 0 ? i - 1 : -1, x < columns - 1 ? i + 1 : -1, i - columns, i + columns]) {
        if (j < 0 || j >= columns * rows || seen[j] || blocked[j]) continue
        seen[j] = 1
        stack.push(j)
      }
    }
  }
  return zoneIds.flatMap((id, index) => (id !== null && !reached.has(index) ? [id] : []))
}
