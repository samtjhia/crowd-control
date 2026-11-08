import { PreparedMapSchema, type ModelPreset, type Operation, type PreparedMap, type ScenarioPlan } from '@crowd-control/contract'

/**
 * Floor plans saved by the editor. This browser keeps a copy (so pages can read them at once,
 * and saving works offline); site/venueSync.ts keeps it in step with the signed-in account.
 * Storage can be unavailable or full, so every access is guarded and the app works without it.
 */

export type SavedVenue = { name: string; floor: string; savedAt: string; map: PreparedMap }

const KEY = 'crowd-control:saved-venues'

/** The browser's localStorage when there is one (not in tests or locked-down browsers). */
type KeyValue = { getItem(key: string): string | null; setItem(key: string, value: string): void }
function store(): KeyValue {
  const storage = (globalThis as unknown as { localStorage?: KeyValue }).localStorage
  if (!storage) throw new Error('No storage')
  return storage
}

/** Saved venues, newest first; anything unreadable is skipped. */
export function loadSavedVenues(): SavedVenue[] {
  try {
    const raw = store().getItem(KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as SavedVenue[]
    return list.filter((venue) => typeof venue?.name === 'string' && PreparedMapSchema.safeParse(venue.map).success)
  } catch {
    return []
  }
}

/** Saves (or replaces, by asset ID) a venue. Returns an error message if the browser refuses. */
export function saveVenue(venue: SavedVenue): string | null {
  try {
    const others = loadSavedVenues().filter((v) => v.map.id !== venue.map.id)
    store().setItem(KEY, JSON.stringify([venue, ...others]))
    return null
  } catch {
    return 'This browser wouldn’t store the venue (storage may be full or turned off). Try removing an older saved venue.'
  }
}

/** Replaces this browser's copy with `venues` (after syncing with the account). */
export function replaceSavedVenues(venues: SavedVenue[]): boolean {
  try {
    store().setItem(KEY, JSON.stringify(venues))
    return true
  } catch {
    return false
  }
}

export function removeSavedVenue(id: string) {
  try {
    store().setItem(KEY, JSON.stringify(loadSavedVenues().filter((v) => v.map.id !== id)))
  } catch {
    // Nothing to remove if storage is unavailable.
  }
}

export const savedScenarioId = (venue: SavedVenue) => `upload-${venue.map.id}`

/**
 * A starter plan for a saved venue: people wandering its biggest indoor room, then an alarm at
 * 30 s sends everyone outside (if any room is tagged outside). The crowd is sized to fill about
 * half the room at the starting spacing; pass `count` to override it.
 */
export function starterPlan(venue: SavedVenue, count?: number): ScenarioPlan {
  const { grid, entities, source } = venue.map
  const outside = new Set(entities.filter((e) => e.kind === 'zone' && e.tags?.includes('outside')).map((e) => e.id))
  const cellCount = new Map<string, number>()
  for (let c = 0; c < grid.zoneIndex.length; c++) {
    const id = grid.zoneIds[grid.zoneIndex[c]!]
    if (id && !grid.blocked[c]) cellCount.set(id, (cellCount.get(id) ?? 0) + 1)
  }
  const indoor = [...cellCount].filter(([id]) => !outside.has(id)).sort((a, b) => b[1] - a[1])
  const [room, cells] = indoor[0] ?? [...cellCount].sort((a, b) => b[1] - a[1])[0] ?? ['', 0]
  // Starting spacing is two body widths: 1 m on metre plans, 2 units on body-width plans.
  const pitch = grid.units === 'm' ? 1 : 2
  const people = count ?? Math.max(1, Math.min(150, Math.floor(((cells * grid.cellSize * grid.cellSize) / (pitch * pitch)) * 0.5)))
  const page = source.mode === 'upload' ? source.page : 1
  const initialOperations: Operation[] = [
    { op: 'spawn', template: { kind: 'agent', tags: ['crowd'], appearance: { fill: '#2563EB' } }, count: people, placement: { inside: { ids: [room] } } },
    { op: 'assign_goal', targets: { kind: 'agent', tags: ['crowd'] }, goal: { kind: 'wander', inside: { ids: [room] } } },
  ]
  return {
    schemaVersion: 1, simulationId: `${venue.map.id}-demo`.slice(0, 200), seed: 42,
    layout: { mode: 'upload', assetId: venue.map.id, page },
    initialOperations,
    timeline: outside.size > 0 ? [{ op: 'schedule', id: 'alarm', at: 30, operations: [{ op: 'emit', event: { name: 'alarm' } }] }] : [],
    rules: outside.size > 0 ? [{
      op: 'define_rule', id: 'evacuate', when: { kind: 'event', name: 'alarm' }, once: true,
      operations: [{ op: 'assign_goal', targets: { kind: 'agent', tags: ['crowd'] }, goal: { kind: 'reach', target: { ids: [...outside] }, selection: 'lowest-cost' } }],
    }] : [],
  }
}

/** Metre plans run with the pedestrian preset; body-width plans with the worked example's. */
export function presetFor(venue: SavedVenue, metres: ModelPreset, bodies: ModelPreset): ModelPreset {
  return venue.map.grid.units === 'm' ? metres : bodies
}
