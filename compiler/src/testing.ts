import { readFileSync } from 'node:fs'
import type { Capabilities, CompiledGoal, CompiledScene, CompileInput, CompileOutput, Limits, ModelPreset, ScenarioPlan } from '@crowd-control/contract'
import { buildPreparedMap, type VenueSpec } from './venues/build.ts'

/** Test helpers only; not exported from the package. */
export const fixture = <T>(name: string) =>
  JSON.parse(readFileSync(new URL(`../../contract/fixtures/${name}.json`, import.meta.url), 'utf8')) as T

export const capabilities: Capabilities = {
  operations: ['add', 'spawn', 'remove', 'set', 'assign_goal', 'clear_goal', 'schedule', 'define_rule', 'remove_rule', 'emit'],
  goals: ['reach', 'avoid', 'wait', 'wander', 'follow', 'queue', 'interact', 'sequence'],
  geometry: ['rectangle', 'circle', 'polygon', 'thick_line'],
  layouts: ['generate', 'upload', 'lookup'],
  entityMetrics: [],
  editableHistory: true,
}

export const limits: Limits = {
  maxAgents: 2000, maxGridCells: 1_000_000, maxOperationsPerBatch: 100, maxSelectorDepth: 4, maxSelectorWork: 1000,
  maxGoalDepth: 4, maxRuleCascades: 100, maxRuleCounters: 2000, maxPendingJobs: 1000, maxUploadBytes: 10_000_000,
  maxSourcePixels: 1_000_000, maxPages: 10,
}

/** The Technical PRD §8 worked example as compiler input. */
export function workedExample(): CompileInput {
  return {
    plan: fixture<ScenarioPlan>('scenario-plan'),
    assets: [],
    model: fixture<CompileOutput>('compile-output').resolvedModel,
    capabilities,
    limits,
  }
}

/** Replaces controller names with the goals they stand for, so tests compare structure, not names. */
export function inline(scene: Pick<CompiledScene, 'agents' | 'jobs' | 'rules' | 'controllers'>) {
  const goal = (name: string | undefined): CompiledGoal | undefined => (name === undefined ? undefined : scene.controllers[name])
  return {
    agents: scene.agents.map(({ controller, ...agent }) => ({ ...agent, goal: goal(controller) })),
    jobs: scene.jobs.map((job) => ({ ...job, operations: job.operations.map((op) => ('controller' in op ? (({ controller, ...rest }) => ({ ...rest, goal: goal(controller) }))(op) : op)) })),
    rules: scene.rules.map((rule) => ('controller' in rule ? (({ controller, ...rest }) => ({ ...rest, goal: goal(controller) }))(rule) : rule)),
  }
}

/** A metre-scaled preset for prepared-venue tests: 0.5 m bodies, 1 m starting spacing. */
export const metricModel: ModelPreset = {
  id: 'metric-test', version: 'metric-test-v1', units: 'm', dt: 0.1,
  defaultAgent: {
    physical: { radius: 0.25, blocksMovement: true, movable: true },
    navigation: { preferredSpeed: 1.3, maximumSpeed: 2, acceleration: 2, personalSpace: 0.5 },
    behavior: { reactionDelay: 0, routeCompliance: 1, avoidanceStrength: 1, groupCohesion: 0, goalPersistence: 1 },
    mobility: { speedMultiplier: 1 },
  },
  layout: { bodyDiameter: 0.5, spacingDiameters: 2, preferredAspect: 2, doorBodyWidths: 2 },
}

/**
 * A small test venue, 10 × 6 m at 0.25 m cells: a 6 × 5 m lobby, an L-shaped cafe and a
 * 1 m door between them. The cafe's lower leg is a slow (cost 2) stretch.
 */
export function testVenue(): VenueSpec {
  return {
    id: 'test-lobby', revision: 'r1', venue: 'Test Lobby', floor: 'Ground', cellSize: 0.25, width: 10, height: 6,
    areas: [
      { id: 'lobby', label: 'Lobby', tags: ['indoor'], appearance: { fill: '#DBEAFE' }, rects: [{ x: 0.5, y: 0.5, width: 6, height: 5 }] },
      { id: 'cafe', label: 'Cafe', rects: [{ x: 7, y: 0.5, width: 2.5, height: 2 }, { x: 7, y: 2.5, width: 1, height: 3 }] },
    ],
    portals: [{ id: 'cafe_door', label: 'Cafe door', tags: ['door'], rect: { x: 6.5, y: 1, width: 0.5, height: 1 }, connects: ['lobby', 'cafe'] }],
    costs: [{ rect: { x: 7, y: 2.5, width: 1, height: 3 }, cost: 2 }],
  }
}

/** A plan for the test venue: people wander the lobby until an alarm sends them to the cafe. */
export function lookupExample(count = 10): CompileInput {
  const map = buildPreparedMap(testVenue())
  if (!map.ok) throw new Error(map.error.message)
  return {
    plan: {
      schemaVersion: 1, simulationId: 'lookup-demo', seed: 7,
      layout: { mode: 'lookup', venue: 'Test Lobby', floor: 'Ground' },
      initialOperations: [
        { op: 'spawn', template: { kind: 'agent', tags: ['guest'] }, count, placement: { inside: { ids: ['lobby'] } } },
        { op: 'assign_goal', targets: { tags: ['guest'] }, goal: { kind: 'wander', inside: { ids: ['lobby'] } } },
      ],
      timeline: [{ op: 'schedule', id: 'alarm', at: 20, operations: [{ op: 'emit', event: { name: 'alarm' } }] }],
      rules: [{ op: 'define_rule', id: 'to-cafe', when: { kind: 'event', name: 'alarm' }, once: true, operations: [{ op: 'assign_goal', targets: { tags: ['guest'] }, goal: { kind: 'reach', target: { ids: ['cafe'] } } }] }],
    },
    assets: [map.value],
    model: metricModel,
    capabilities,
    limits,
  }
}
