import { compile, preparedVenues, type CompileOptions } from '@crowd-control/compiler'
import type { Capabilities, CompileOutput, Limits, ModelPreset, Operation, PreparedMap, Result, ScenarioPlan } from '@crowd-control/contract'

/**
 * What the simulator can run today. The planner is told the same list, so it never asks for
 * something the compiler or worker would reject. Uploads are added with the upload editor.
 */
export const CAPABILITIES: Capabilities = {
  operations: ['add', 'spawn', 'remove', 'set', 'assign_goal', 'clear_goal', 'schedule', 'define_rule', 'remove_rule', 'emit'],
  goals: ['reach', 'avoid', 'wait', 'wander', 'follow', 'queue', 'interact', 'sequence'],
  geometry: ['rectangle'],
  layouts: ['generate', 'lookup'],
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

/**
 * Compiles a scenario plan (normally the planner's reply) into the scene the worker loads.
 * The plan is untrusted: the compiler validates it, so a bad plan comes back as an error to
 * show the user, never as a broken simulation. `varyLayout` lets the plan's seed reshape a
 * generated building (Technical PRD §10).
 */
export function startScenario(plan: unknown, model: ModelPreset, options: CompileOptions = {}, assets: PreparedMap[] = venueAssets()): Result<CompileOutput> {
  return compile({ plan, assets, model, capabilities: CAPABILITIES, limits: LIMITS }, options)
}

/** A one-line summary for the header, e.g. "Hall, foyer and outside · 10 people". */
export function describeScenario({ scene }: CompileOutput): string {
  const scheduled = scene.jobs.flatMap((job) => job.operations).reduce((sum, op) => sum + ('zone' in op ? op.count : 0), 0)
  const people = scene.agents.length + scheduled
  const crowd = `${people} ${people === 1 ? 'person' : 'people'}`
  if (scene.map.source?.mode === 'lookup') return `${scene.map.source.venue}, ${scene.map.source.floor} · ${crowd}`
  const rooms = scene.map.rooms.map((room, index) => {
    const name = room.label ?? room.id
    return index === 0 ? name : name.toLowerCase()
  })
  const spaces = rooms.length > 1 ? `${rooms.slice(0, -1).join(', ')} and ${rooms.at(-1)}` : (rooms[0] ?? 'Empty map')
  return `${spaces} · ${crowd}`
}

export type Scenario = { id: string; title: string; plan: ScenarioPlan; model: ModelPreset }

// Small builders so each demo plan reads like its description.
const inside = (id: string) => ({ ids: [id] })
const spawn = (count: number, zone: string, tags: string[], fill: string, symbol: 'circle' | 'square' | 'triangle' = 'circle'): Operation =>
  ({ op: 'spawn', template: { kind: 'agent', tags, appearance: { fill, symbol } }, count, placement: { inside: inside(zone) } })
const assign = (tag: string, goal: Extract<Operation, { op: 'assign_goal' }>['goal']): Operation => ({ op: 'assign_goal', targets: { tags: [tag] }, goal })
const alarmAt = (at: number) => [{ op: 'schedule' as const, id: 'alarm', at, operations: [{ op: 'emit' as const, event: { name: 'alarm' } }] }]
const evacuate = (tag: string, target: { tags: string[] }) => [{
  op: 'define_rule' as const, id: 'evacuate', when: { kind: 'event' as const, name: 'alarm' }, once: true,
  operations: [{ op: 'assign_goal' as const, targets: { tags: [tag] }, goal: { kind: 'reach' as const, target, selection: 'lowest-cost' as const } }],
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
        timeline: alarmAt(15), rules: evacuate('student', { tags: ['assembly'] }),
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
          assign('at-bar', { kind: 'wander', inside: inside('bar') }),
        ],
        timeline: alarmAt(45), rules: evacuate('audience', { tags: ['outside'] }),
      },
    },
    {
      id: 'hackathon-hall', title: 'Hackathon check-in', model: PEDESTRIAN_PRESET,
      plan: {
        ...header('hackathon-hall-demo'), layout: lookup('Hackathon Hall', 'Main hall'),
        initialOperations: [
          spawn(60, 'hall', ['hacker'], '#059669'),
          spawn(40, 'street', ['arrival'], '#2563EB', 'triangle'),
          assign('hacker', { kind: 'wander', inside: inside('hall') }),
          assign('arrival', { kind: 'sequence', goals: [{ kind: 'reach', target: inside('hall') }, { kind: 'wander', inside: inside('hall') }] }),
        ],
        timeline: [], rules: [],
      },
    },
  ]
}

/** Explicit movement-only variant: contact physics remains unavailable in the Rust engine. */
export function movementPreset(preset: ModelPreset): ModelPreset {
  const model = { ...preset, id: `${preset.id}-movement`, version: `${preset.version}-movement` }
  delete model.contact
  return model
}
