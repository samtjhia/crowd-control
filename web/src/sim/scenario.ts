import { compile, preparedVenues, spawnCapacities, type CompileOptions } from '@crowd-control/compiler'
import { DISC_IMPULSE_VERSION, ModelPresetSchema } from '@crowd-control/contract'
import { placesOf, type Place } from './places.ts'
import { loadSavedVenues, presetFor, savedScenarioId, starterPlan, type SavedVenue } from './savedVenues.ts'
import type { Capabilities, CompileOutput, InventoryItem, LayoutSource, Limits, ModelPreset, Operation, PreparedMap, Result, ScenarioPlan } from '@crowd-control/contract'

/**
 * What the simulator can run today. The planner is told the same list, so it never asks for
 * something the compiler or worker would reject. Uploads are floor plans saved by the editor.
 */
export const CAPABILITIES: Capabilities = {
  operations: ['add', 'spawn', 'remove', 'set', 'assign_goal', 'clear_goal', 'schedule', 'define_rule', 'remove_rule', 'emit'],
  goals: ['reach', 'avoid', 'wait', 'wander', 'follow', 'queue', 'interact', 'sequence'],
  geometry: ['rectangle'],
  layouts: ['generate', 'lookup', 'upload'],
  entityMetrics: [],
  editableHistory: false,
}

export const LIMITS: Limits = {
  maxAgents: 2000, maxGridCells: 1_000_000, maxOperationsPerBatch: 100, maxSelectorDepth: 4, maxSelectorWork: 1000,
  maxGoalDepth: 4, maxRuleCascades: 100, maxRuleCounters: 2000, maxPendingJobs: 1000, maxUploadBytes: 10_000_000,
  maxSourcePixels: 1_000_000, maxPages: 10,
}

/**
 * Walking adults in metres for the prepared venues: 0.5 m bodies at 1.3 m/s, starting 1 m
 * apart. Generated plans keep the worked example's model-unit preset instead.
 */
export const PEDESTRIAN_PRESET: ModelPreset = {
  id: 'pedestrian', version: 'pedestrian-v1', units: 'm', dt: 0.1,
  defaultAgent: {
    physical: { radius: 0.25, blocksMovement: true, movable: true },
    navigation: { preferredSpeed: 1.3, maximumSpeed: 2, acceleration: 1.5, personalSpace: 0.5 },
    behavior: { reactionDelay: 0, routeCompliance: 1, avoidanceStrength: 1, groupCohesion: 0, goalPersistence: 1 },
    mobility: { speedMultiplier: 1 },
  },
  layout: { bodyDiameter: 0.5, spacingDiameters: 2, preferredAspect: 2, doorBodyWidths: 2 },
}

let venues: PreparedMap[] | null = null

/** The prepared venue maps, built once on first use. A broken venue is a bug in the catalog. */
export function venueAssets(): PreparedMap[] {
  if (!venues) {
    const built = preparedVenues()
    if (!built.ok) throw new Error(built.error.message)
    venues = built.value
  }
  return venues
}

/** A venue the assistant can set a new scenario in: its layout source and its rooms and doors. */
export type VenueOption = {
  id: string; name: string; layout: LayoutSource; inventory: InventoryItem[]
  /** People each room holds at the starting spacing, so the planner writes crowds that fit. */
  capacities: Record<string, number>
  /** The tables, counters and check-in desks people can use, with what each does. */
  places: Place[]
  /** The map itself, so marked points can be described before a scenario runs there. */
  map: PreparedMap
}

/**
 * Rooms, doors and objects (tables, counters) of a prepared map, as the planner's inventory:
 * real IDs, labels and tags, and which components each has (`interaction` means people can use it).
 */
export function mapInventory(map: PreparedMap): InventoryItem[] {
  return map.entities.flatMap((entity): InventoryItem[] => entity.kind === 'zone' || entity.kind === 'portal' || entity.kind === 'object'
    ? [{ id: entity.id, kind: entity.kind, ...(entity.label !== undefined && { label: entity.label }), tags: [...(entity.tags ?? [])], componentNames: Object.keys(entity.components ?? {}) }]
    : [])
}

/**
 * Every venue a new scenario can use: the prepared venues, then floor plans saved in this browser.
 * `bodies` is the body-width preset for plans saved without a scale.
 */
export function venueOptions(bodies?: ModelPreset): VenueOption[] {
  const prepared = venueAssets().flatMap((map): VenueOption[] => map.source.mode === 'lookup'
    ? [{ id: map.id, name: map.source.venue, layout: { mode: 'lookup', venue: map.source.venue, floor: map.source.floor }, inventory: mapInventory(map), capacities: spawnCapacities(map, PEDESTRIAN_PRESET), places: placesOf(map.entities), map }]
    : [])
  const saved = loadSavedVenues().map((venue): VenueOption => ({
    id: venue.map.id, name: venue.name,
    layout: { mode: 'upload', assetId: venue.map.id, page: venue.map.source.mode === 'upload' ? venue.map.source.page : 1 },
    inventory: mapInventory(venue.map),
    capacities: venue.map.grid.units === 'm' ? spawnCapacities(venue.map, PEDESTRIAN_PRESET) : bodies ? spawnCapacities(venue.map, bodies) : {},
    places: placesOf(venue.map.entities),
    map: venue.map,
  }))
  return [...prepared, ...saved]
}

/** The prepared venues plus every floor plan saved in this browser, read fresh each time. */
export function allAssets(): PreparedMap[] {
  return [...venueAssets(), ...loadSavedVenues().map((venue) => venue.map)]
}

/**
 * Compiles a scenario plan (normally the planner's reply) into the scene the worker loads.
 * The plan is untrusted: the compiler validates it, so a bad plan comes back as an error to
 * show the user, never as a broken simulation. `varyLayout` lets the plan's seed reshape a
 * generated building (Technical PRD §10).
 */
export function startScenario(plan: unknown, model: ModelPreset, options: CompileOptions = {}, assets: PreparedMap[] = allAssets()): Result<CompileOutput> {
  const capabilities: Capabilities = { ...CAPABILITIES, entityMetrics: model.contact?.solverVersion === DISC_IMPULSE_VERSION && ModelPresetSchema.safeParse(model).success ? ['contactLoadRatio'] : [] }
  return compile({ plan, assets, model, capabilities, limits: LIMITS }, options)
}

/** A one-line summary for the header, e.g. "Hall, foyer and outside · 10 people". */
export function describeScenario({ scene }: CompileOutput): string {
  const scheduled = scene.jobs.flatMap((job) => job.operations).reduce((sum, op) => sum + ('zone' in op ? op.count : 0), 0)
  const people = scene.agents.length + scheduled
  const crowd = `${people} ${people === 1 ? 'person' : 'people'}`
  if (scene.map.source?.mode === 'lookup') return `${scene.map.source.venue}, ${scene.map.source.floor} · ${crowd}`
  if (scene.map.source?.mode === 'upload') return `Your floor plan, ${scene.map.rooms.length} rooms · ${crowd}`
  const rooms = scene.map.rooms.map((room, index) => {
    const name = room.label ?? room.id
    return index === 0 ? name : name.toLowerCase()
  })
  const spaces = rooms.length > 1 ? `${rooms.slice(0, -1).join(', ')} and ${rooms.at(-1)}` : (rooms[0] ?? 'Empty map')
  return `${spaces} · ${crowd}`
}

/**
 * A saved venue's starter plan with a crowd that really fits: the estimate from the room's area
 * is halved until the compiler can place everyone (odd room shapes hold fewer than their area suggests).
 */
export function fittedStarterPlan(venue: SavedVenue, model: ModelPreset): ScenarioPlan {
  let plan = starterPlan(venue)
  for (let tries = 0; tries < 8; tries++) {
    const result = startScenario(plan, model, {}, [venue.map])
    if (result.ok || result.error.code !== 'NO_WALKABLE_SPACE') return plan
    const spawn = plan.initialOperations[0]
    const count = spawn?.op === 'spawn' ? spawn.count : 1
    if (count <= 1) return plan
    plan = starterPlan(venue, Math.max(1, Math.floor(count / 2)))
  }
  return plan
}

/** A scenario: its name, plan and model; `savedAt` for the person's own, kept in their account. */
export type Scenario = { id: string; title: string; plan: ScenarioPlan; model: ModelPreset; savedAt?: string }

// Small builders so each demo plan reads like its description.
const inside = (id: string) => ({ ids: [id] })
const spawn = (count: number, zone: string, tags: string[], fill: string, symbol: 'circle' | 'square' | 'triangle' = 'circle'): Operation =>
  ({ op: 'spawn', template: { kind: 'agent', tags, appearance: { fill, symbol } }, count, placement: { inside: inside(zone) } })
const assign = (tag: string, goal: Extract<Operation, { op: 'assign_goal' }>['goal']): Operation => ({ op: 'assign_goal', targets: { kind: 'agent', tags: [tag] }, goal })
const alarmAt = (at: number) => [{ op: 'schedule' as const, id: 'alarm', at, operations: [{ op: 'emit' as const, event: { name: 'alarm' } }] }]
const evacuate = (tag: string, target: { ids: string[] }) => [{
  op: 'define_rule' as const, id: 'evacuate', when: { kind: 'event' as const, name: 'alarm' }, once: true,
  operations: [{ op: 'assign_goal' as const, targets: { kind: 'agent' as const, tags: [tag] }, goal: { kind: 'reach' as const, target, selection: 'lowest-cost' as const } }],
}]
const lookup = (venue: string, floor: string) => ({ mode: 'lookup' as const, venue, floor })
const header = (simulationId: string) => ({ schemaVersion: 1 as const, simulationId, seed: 42 })

/**
 * Demo plans for the scenario picker: the PRD worked example and one per prepared venue.
 * They stand in for planner replies until the chat panel is connected.
 */
export function scenarios(workedPlan: ScenarioPlan, workedModel: ModelPreset): Scenario[] {
  return [
    { id: 'worked-example', title: 'Worked example', plan: workedPlan, model: workedModel },
    {
      id: 'hillside-alley', title: 'Two-way alley', model: PEDESTRIAN_PRESET,
      plan: {
        ...header('hillside-alley-demo'), layout: lookup('Hillside Alley', 'Street level'),
        initialOperations: [
          spawn(80, 'station_plaza', ['crowd', 'uphill'], '#2563EB'),
          spawn(80, 'bar_street', ['crowd', 'downhill'], '#EA580C', 'square'),
          assign('uphill', { kind: 'sequence', goals: [{ kind: 'reach', target: inside('bar_street') }, { kind: 'wander', inside: inside('bar_street') }] }),
          assign('downhill', { kind: 'sequence', goals: [{ kind: 'reach', target: inside('station_plaza') }, { kind: 'wander', inside: inside('station_plaza') }] }),
        ],
        timeline: [], rules: [],
      },
    },
    {
      id: 'school-wing', title: 'School fire drill', model: PEDESTRIAN_PRESET,
      plan: {
        ...header('school-wing-demo'), layout: lookup('Riverside School', 'East wing'),
        initialOperations: [
          ...[101, 102, 103, 104, 105, 106, 107, 108].map((room) => spawn(24, `room_${room}`, ['student'], '#2563EB')),
          assign('student', { kind: 'wait', duration: 600 }),
        ],
        timeline: alarmAt(15), rules: evacuate('student', { ids: ['west_yard', 'east_yard'] }),
      },
    },
    {
      id: 'concert-floor', title: 'Concert evacuation', model: PEDESTRIAN_PRESET,
      plan: {
        ...header('concert-floor-demo'), layout: lookup('Harbour Concert Hall', 'Main floor'),
        initialOperations: [
          spawn(400, 'floor', ['audience'], '#7C3AED'),
          spawn(30, 'bar', ['audience', 'at-bar'], '#DB2777', 'square'),
          assign('audience', { kind: 'wander', inside: inside('floor') }),
          // The bar crowd takes turns at the counter (four served at once), then mills about.
          assign('at-bar', { kind: 'sequence', repeat: 5, goals: [{ kind: 'interact', target: inside('bar_counter') }, { kind: 'wander', inside: inside('bar'), duration: 20 }] }),
        ],
        timeline: alarmAt(45), rules: evacuate('audience', { ids: ['street'] }),
      },
    },
    {
      id: 'hackathon-hall', title: 'Hackathon check-in', model: PEDESTRIAN_PRESET,
      plan: {
        ...header('hackathon-hall-demo'), layout: lookup('Hackathon Hall', 'Main hall'),
        initialOperations: [
          spawn(45, 'hall', ['hacker', 'seated'], '#059669'),
          spawn(15, 'hall', ['hacker', 'hungry'], '#0D9488', 'square'),
          spawn(40, 'street', ['arrival'], '#2563EB', 'triangle'),
          // Most hackers sit at the nearest table and work.
          assign('seated', { kind: 'sequence', goals: [{ kind: 'reach', target: { tags: ['table'] }, selection: 'nearest' }, { kind: 'wait', duration: 300 }] }),
          // Some take turns at the snack table (three served at once), then roam.
          assign('hungry', { kind: 'sequence', repeat: 3, goals: [{ kind: 'interact', target: inside('snacks') }, { kind: 'wander', inside: inside('hall'), duration: 40 }] }),
          // Arrivals enter through the check-in desks (4 s each), find the nearest table and settle in, then roam.
          assign('arrival', {
            kind: 'sequence', goals: [
              { kind: 'reach', target: inside('hall') },
              { kind: 'reach', target: { tags: ['table'] }, selection: 'nearest' },
              { kind: 'wait', duration: 60 },
              { kind: 'wander', inside: inside('hall') },
            ],
          }),
        ],
        timeline: [], rules: [],
      },
    },
    // Floor plans saved in this browser by the editor, each with a starter crowd.
    ...loadSavedVenues().map((venue) => {
      const model = presetFor(venue, PEDESTRIAN_PRESET, workedModel)
      return { id: savedScenarioId(venue), title: `${venue.name} (uploaded)`, plan: fittedStarterPlan(venue, model), model }
    }),
  ]
}

/** Explicit movement-only variant; contact remains opt-in through a registered preset. */
export function movementPreset(preset: ModelPreset): ModelPreset {
  const model = { ...preset, id: `${preset.id}-movement`, version: `${preset.version}-movement` }
  delete model.contact
  return model
}
