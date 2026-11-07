import { PreparedMapSchema, parseContract, type Calibration, type EntityBlueprint, type GridData, type PreparedMap, type SourcePage } from '@crowd-control/contract'
import type { Door } from './doors.ts'
import type { Room } from './rooms.ts'
import { OBJECT, WALL } from './walls.ts'

/**
 * Check & save (Technical PRD §7 step 7): "Rasterize conservatively, preserve measured
 * openings, verify body clearance and routes, then save a reviewed revision." The tracing, in
 * image pixels, becomes the same GridData the prepared venues use: 0.25 m cells on scaled plans,
 * half-body cells on plans without a scale.
 */

/** Cell size in world units: 0.25 m, as the prepared venues; or half a body on unscaled plans. */
export const METRE_CELL = 0.25
export const MODEL_CELL = 0.5

export type TracedPlan = {
  source: SourcePage
  width: number
  height: number
  /** FLOOR, WALL or OBJECT per pixel (walls step, corrections applied). */
  kinds: Uint8Array
  furnitureBlocks: boolean
  /** Room number per pixel, 0 for none (rooms step). */
  labels: Uint16Array
  rooms: Room[]
  doors: Door[]
  calibration: Calibration | null
  name: string
  floor: string
  revision: string
}

export type Problem = { severity: 'error' | 'warning'; message: string; at?: { x: number; y: number } }

export type CheckResult = {
  /** The map ready to save, or null when there are errors. */
  map: PreparedMap | null
  problems: Problem[]
  /** For the preview: grid size, the world units per source pixel, and the grid itself. */
  grid: GridData
  worldPerPixel: number
}

/** "Main hall" → "main_hall"; never empty. */
export function slug(text: string, fallback: string): string {
  const s = text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
  return s || fallback
}

/** Unique IDs in order: repeats get _2, _3 … */
function unique(ids: string[]): string[] {
  const seen = new Map<string, number>()
  return ids.map((id) => {
    const n = (seen.get(id) ?? 0) + 1
    seen.set(id, n)
    return n === 1 ? id : `${id}_${n}`
  })
}

/**
 * World units per source pixel. Scaled plans use the calibration. Unscaled plans use body
 * widths, estimated from the doors: a typical door is taken as two bodies wide (the model's
 * door width), so the median door sets the size of a body.
 */
export function worldPerPixel(plan: Pick<TracedPlan, 'calibration' | 'doors' | 'width' | 'height'>): number {
  if (plan.calibration) return plan.calibration.metresPerPixel
  const widths = plan.doors.filter((door) => door.length > 0).map((door) => door.length).sort((a, b) => a - b)
  const bodyPixels = widths.length > 0 ? widths[Math.floor(widths.length / 2)]! / 2 : Math.min(plan.width, plan.height) / 60
  return 1 / Math.max(1, bodyPixels)
}

export function checkAndBuild(plan: TracedPlan): CheckResult {
  const problems: Problem[] = []
  const scaled = plan.calibration !== null
  const units = scaled ? 'm' : 'model'
  const cellSize = scaled ? METRE_CELL : MODEL_CELL
  const perPixel = worldPerPixel(plan)
  const cellPixels = cellSize / perPixel
  const columns = Math.max(1, Math.ceil((plan.width * perPixel) / cellSize - 1e-9))
  const rows = Math.max(1, Math.ceil((plan.height * perPixel) / cellSize - 1e-9))
  const size = columns * rows
  const zoneIds = unique(plan.rooms.map((room) => slug(room.label, 'room')))
  const zoneOf = new Map(plan.rooms.map((room, k) => [room.id, k + 1]))

  // 1. Classify each cell from the pixels it covers.
  const wall = new Float32Array(size), object = new Float32Array(size), total = new Float32Array(size)
  const votes = new Map<number, Map<number, number>>()
  for (let y = 0; y < plan.height; y++) {
    const cy = Math.min(rows - 1, Math.floor(y / cellPixels))
    for (let x = 0; x < plan.width; x++) {
      const c = cy * columns + Math.min(columns - 1, Math.floor(x / cellPixels))
      const i = y * plan.width + x
      total[c]!++
      const kind = plan.kinds[i]!
      if (kind === WALL) wall[c]!++
      else if (kind === OBJECT) object[c]!++
      const zone = plan.labels[i] ? zoneOf.get(plan.labels[i]!) : undefined
      if (zone && kind !== WALL) {
        let cell = votes.get(c)
        if (!cell) votes.set(c, (cell = new Map()))
        cell.set(zone, (cell.get(zone) ?? 0) + 1)
      }
    }
  }
  const blocked = new Array<0 | 1>(size).fill(1)
  const zoneIndex = new Array<number>(size).fill(0)
  for (let c = 0; c < size; c++) {
    const cell = votes.get(c)
    if (!cell || total[c] === 0) continue
    let best = 0, bestVotes = 0, floor = 0
    for (const [zone, n] of cell) { floor += n; if (n > bestVotes) { best = zone; bestVotes = n } }
    // Conservative: a thin wall line must never vanish; a mostly-floor cell is a room cell.
    const isWall = wall[c]! / total[c]! >= 0.1
    const isFloor = floor / total[c]! >= 0.5
    const isFurniture = plan.furnitureBlocks && object[c]! / total[c]! > 0.5
    zoneIndex[c] = best
    blocked[c] = isWall || !isFloor || isFurniture ? 1 : 0
  }

  // 2. Doors keep their measured opening: their cells are open whatever the wall rule said,
  // and each is widened across its thickness (up to 3 cells) until it touches both rooms.
  const portalIds = unique(plan.doors.map((door, k) => (door.exit ? `exit_${k + 1}` : `door_${k + 1}`)))
  const portalIndex = new Array<number>(size).fill(0)
  const portalCells: number[][] = []
  plan.doors.forEach((door, k) => {
    const a = zoneOf.get(door.from), b = zoneOf.get(door.to)
    const tall = door.rect.height >= door.rect.width
    let left = Math.floor(door.rect.x / cellPixels), right = Math.max(left, Math.ceil((door.rect.x + door.rect.width) / cellPixels) - 1)
    let top = Math.floor(door.rect.y / cellPixels), bottom = Math.max(top, Math.ceil((door.rect.y + door.rect.height) / cellPixels) - 1)
    const clampBox = () => { left = Math.max(0, left); top = Math.max(0, top); right = Math.min(columns - 1, right); bottom = Math.min(rows - 1, bottom) }
    clampBox()
    const touches = (zone: number | undefined) => {
      if (!zone) return false
      for (let y = top - 1; y <= bottom + 1; y++) for (let x = left - 1; x <= right + 1; x++) {
        if (x < 0 || y < 0 || x >= columns || y >= rows) continue
        const c = y * columns + x
        const inBox = x >= left && x <= right && y >= top && y <= bottom
        if (!inBox && blocked[c] === 0 && zoneIndex[c] === zone) return true
      }
      return false
    }
    for (let grow = 0; grow < 3 && !(touches(a) && touches(b)); grow++) {
      if (tall) { left--; right++ } else { top--; bottom++ }
      clampBox()
    }
    const cells: number[] = []
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const c = y * columns + x
      blocked[c] = 0
      zoneIndex[c] = 0
      portalIndex[c] = k + 1
      cells.push(c)
    }
    portalCells.push(cells)
    const name = `${plan.rooms.find((r) => r.id === door.from)?.label ?? 'Room'} – ${plan.rooms.find((r) => r.id === door.to)?.label ?? 'Room'}`
    const centre = { x: door.rect.x + door.rect.width / 2, y: door.rect.y + door.rect.height / 2 }
    if (!touches(a) || !touches(b)) problems.push({ severity: 'error', message: `The door ${name} doesn’t reach both rooms on the simulation grid. Remove it or redraw it across the wall.`, at: centre })
    const across = tall ? bottom - top + 1 : right - left + 1
    if (across < 2) problems.push({ severity: 'warning', message: `The door ${name} is narrower than a person on the simulation grid (under ${scaled ? '0.5 m' : 'one body'}). People may not fit through.`, at: centre })
  })

  // 3. Every room needs cells, and every room must be reachable (closed doors count as passable here).
  const centroid = (room: Room) => {
    let sx = 0, sy = 0, n = 0
    for (let i = 0; i < plan.labels.length; i++) if (plan.labels[i] === room.id) { sx += i % plan.width; sy += Math.floor(i / plan.width); n++ }
    return n ? { x: sx / n, y: sy / n } : undefined
  }
  const zoneCells = new Array<number>(zoneIds.length + 1).fill(0)
  for (let c = 0; c < size; c++) if (!blocked[c] && zoneIndex[c]) zoneCells[zoneIndex[c]!]!++
  plan.rooms.forEach((room, k) => {
    if (zoneCells[k + 1] === 0) problems.push({ severity: 'error', message: `${room.label} is too small for the simulation grid. Remove it or merge it into a neighbour.`, at: centroid(room) })
  })
  if (plan.rooms.length === 0) problems.push({ severity: 'error', message: 'There are no rooms. Go back to Rooms and find or fill some.' })
  const start = zoneIndex.findIndex((z, c) => z > 0 && !blocked[c])
  if (start >= 0) {
    const reached = new Uint8Array(size)
    const stack = [start]
    reached[start] = 1
    while (stack.length > 0) {
      const c = stack.pop()!
      const x = c % columns
      for (const n of [x > 0 ? c - 1 : -1, x < columns - 1 ? c + 1 : -1, c - columns, c + columns]) {
        if (n < 0 || n >= size || reached[n] || blocked[n]) continue
        reached[n] = 1
        stack.push(n)
      }
    }
    const reachable = new Set<number>()
    for (let c = 0; c < size; c++) if (reached[c] && zoneIndex[c]) reachable.add(zoneIndex[c]!)
    plan.rooms.forEach((room, k) => {
      if (zoneCells[k + 1]! > 0 && !reachable.has(k + 1)) problems.push({ severity: 'error', message: `Nobody can reach ${room.label} from ${plan.rooms[zoneIndex[start]! - 1]?.label ?? 'the first room'}. Add a door in the Doors step.`, at: centroid(room) })
    })
  }
  if (!scaled) problems.push({ severity: 'warning', message: 'This plan has no scale, so it runs in body widths: crowding shows as relative, with no people per m². Set the scale in step 2 for real measurements.' })
  if (!plan.doors.some((door) => door.exit)) problems.push({ severity: 'warning', message: 'No door is marked as an exit, so nobody can leave the building in an evacuation. Mark one in Doors, or tag a room as outside.' })

  // 4. The map, in world units.
  const grid: GridData = {
    width: columns, height: rows, cellSize, units, blocked,
    traversalCost: new Array<number>(size).fill(1), zoneIndex, portalIndex,
    zoneIds: [null, ...zoneIds], portalIds: [null, ...portalIds],
  }
  const bounds = (cells: (c: number) => boolean) => {
    let l = columns, r = -1, t = rows, b = -1
    for (let c = 0; c < size; c++) if (cells(c)) { const x = c % columns, y = Math.floor(c / columns); l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y) }
    return r < 0 ? null : { kind: 'rectangle' as const, x: l * cellSize, y: t * cellSize, width: (r - l + 1) * cellSize, height: (b - t + 1) * cellSize }
  }
  const entities: EntityBlueprint[] = [
    ...plan.rooms.map((room, k): EntityBlueprint => {
      const shape = bounds((c) => zoneIndex[c] === k + 1)
      return { id: zoneIds[k]!, kind: 'zone', label: room.label, ...(room.tags.length > 0 && { tags: [...room.tags] }), appearance: { fill: room.color, labelVisible: true }, ...(shape && { shape }) }
    }),
    ...plan.doors.map((door, k): EntityBlueprint => {
      const shape = bounds((c) => portalIndex[c] === k + 1)
      const from = zoneIds[(zoneOf.get(door.from) ?? 1) - 1]!, to = zoneIds[(zoneOf.get(door.to) ?? 1) - 1]!
      const fromLabel = plan.rooms.find((r) => r.id === door.from)?.label ?? from, toLabel = plan.rooms.find((r) => r.id === door.to)?.label ?? to
      return {
        id: portalIds[k]!, kind: 'portal', label: door.exit ? `Exit to ${toLabel}` : `${fromLabel} – ${toLabel} door`,
        ...(door.exit && { tags: ['exit'] }), appearance: { fill: door.exit ? '#86EFAC' : '#B9D6AE' },
        components: { portal: { connects: [from, to], open: door.open, ...(door.oneWay && { oneWay: true }) } },
        ...(shape && { shape }),
      }
    }),
  ]
  const hasErrors = problems.some((p) => p.severity === 'error')
  let map: PreparedMap | null = null
  if (!hasErrors) {
    const candidate = {
      id: plan.source.assetId, revision: plan.revision,
      source: {
        mode: 'upload' as const, assetId: plan.source.assetId, revision: plan.revision, page: plan.source.page,
        calibration: plan.calibration, sourceToWorld: [perPixel, 0, 0, perPixel, 0, 0] as [number, number, number, number, number, number],
      },
      grid, entities, reviewed: true as const,
    }
    const checked = parseContract(PreparedMapSchema, candidate)
    if (checked.ok) map = checked.value
    else problems.push({ severity: 'error', message: `The map could not be saved: ${checked.error.message}` })
  }
  return { map, problems, grid, worldPerPixel: perPixel }
}
