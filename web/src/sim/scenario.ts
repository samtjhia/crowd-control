import { compile } from '@crowd-control/compiler'
import type { Capabilities, CompileOutput, Limits, ModelPreset, Result } from '@crowd-control/contract'

/**
 * What the simulator can run today. The planner is told the same list, so it never asks for
 * something the compiler or worker would reject. Prepared venues (`lookup`) and uploads are
 * added as they arrive.
 */
export const CAPABILITIES: Capabilities = {
  operations: ['add', 'spawn', 'remove', 'set', 'assign_goal', 'clear_goal', 'schedule', 'define_rule', 'remove_rule', 'emit'],
  goals: ['reach', 'avoid', 'wait', 'wander', 'follow', 'queue', 'interact', 'sequence'],
  geometry: ['rectangle'],
  layouts: ['generate'],
  entityMetrics: [],
  editableHistory: false,
}

export const LIMITS: Limits = {
  maxAgents: 2000, maxGridCells: 1_000_000, maxOperationsPerBatch: 100, maxSelectorDepth: 4, maxSelectorWork: 1000,
  maxGoalDepth: 4, maxRuleCascades: 100, maxRuleCounters: 2000, maxPendingJobs: 1000, maxUploadBytes: 10_000_000,
  maxSourcePixels: 1_000_000, maxPages: 10,
}

/**
 * Compiles a scenario plan (normally the planner's reply) into the scene the worker loads.
 * The plan is untrusted: the compiler validates it, so a bad plan comes back as an error to
 * show the user, never as a broken simulation.
 */
export function startScenario(plan: unknown, model: ModelPreset): Result<CompileOutput> {
  return compile({ plan, assets: [], model, capabilities: CAPABILITIES, limits: LIMITS })
}

/** A one-line summary for the header, e.g. "Hall, foyer and outside · 10 people". */
export function describeScenario({ scene }: CompileOutput): string {
  const rooms = scene.map.rooms.map((room, index) => {
    const name = room.label ?? room.id
    return index === 0 ? name : name.toLowerCase()
  })
  const spaces = rooms.length > 1 ? `${rooms.slice(0, -1).join(', ')} and ${rooms.at(-1)}` : (rooms[0] ?? 'Empty map')
  const scheduled = scene.jobs.flatMap((job) => job.operations).reduce((sum, op) => sum + ('zone' in op ? op.count : 0), 0)
  const people = scene.agents.length + scheduled
  return `${spaces} · ${people} ${people === 1 ? 'person' : 'people'}`
}
