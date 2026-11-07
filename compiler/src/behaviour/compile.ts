import type {
  AgentBlueprint, CompactSpawn, CompiledGoal, CompiledJob, CompiledOperation, DefineRuleOperation,
  EventControllerRule, Operation, Result, ScenarioPlan, ScheduleOperation,
} from '@crowd-control/contract'
import { spawnsIn, type SpawnOperation } from '../operations.ts'
import { DEFAULT_PROFILE } from '../profiles/catalog.ts'
import { fail, ok } from '../result.ts'
import { insideRoomId } from '../spawn/lattice.ts'
import { ControllerTable } from './controllers.ts'
import { compileGoal, isSimpleSelector, selectAgents, templateMatches, type StaticWorld } from './targets.ts'

export type Behaviour = {
  agents: AgentBlueprint[]
  controllers: { [id: string]: CompiledGoal }
  jobs: CompiledJob[]
  rules: (DefineRuleOperation | EventControllerRule)[]
}

/** Plain JSON copy, so the scene never shares objects with the plan. */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** Appends `next` to `current` as one flat sequence, for `assign_goal` with mode `enqueue`. */
function enqueue(current: CompiledGoal, next: CompiledGoal): CompiledGoal {
  const flat = (goal: CompiledGoal) => (goal.kind === 'sequence' && goal.repeat === undefined ? goal.goals : [goal])
  return { kind: 'sequence', goals: [...flat(current), ...flat(next)] }
}

/**
 * Compiles what people do (Technical PRD §8 "Compiled initial definition"):
 *
 * - Starting `assign_goal`s become shared controllers attached to the starting agents they
 *   pick out at that point in the plan.
 * - Each timeline `schedule` becomes a job. A spawn in it becomes a compact spawn; a goal
 *   given only to that job's arrivals is folded into the spawn as its controller. Everything
 *   else stays a plain operation whose selectors the engine resolves when the job runs, so
 *   future matches are never frozen (Contracts §8).
 * - A rule that reacts to an event with a single `assign_goal` becomes an event controller
 *   rule; other rules pass through unchanged.
 */
export function compileBehaviour(plan: ScenarioPlan, world: StaticWorld): Result<Behaviour> {
  const table = new ControllerTable()
  const agents = world.agents.map((agent) => ({ ...agent, tags: [...agent.tags] }))
  const allSpawns = [...spawnsIn(plan)].map(({ spawn }) => spawn)
  const jobs: CompiledJob[] = []
  const rules: (DefineRuleOperation | EventControllerRule)[] = []

  const addJob = (schedule: ScheduleOperation, path: string): Result<void> => {
    const job = compileJob(schedule, path, world, table, allSpawns)
    if (!job.ok) return job
    jobs.push(job.value)
    return ok(undefined)
  }
  const addRule = (rule: DefineRuleOperation, path: string): Result<void> => {
    const compiled = compileRule(rule, path, world, table)
    if (!compiled.ok) return compiled
    rules.push(compiled.value)
    return ok(undefined)
  }

  let spawned = 0
  for (const [index, operation] of plan.initialOperations.entries()) {
    const path = `plan.initialOperations.${index}`
    switch (operation.op) {
      case 'spawn':
        spawned += operation.count
        break
      case 'assign_goal': {
        if (!isSimpleSelector(operation.targets)) {
          return fail('UNSUPPORTED_CAPABILITY', 'Starting goals can only pick people by ids, kind, tags and label for now', { path: `${path}.targets` })
        }
        const picked = selectAgents(agents.slice(0, spawned), operation.targets)
        if (picked.length === 0) return fail('NOT_FOUND', 'No one in the starting crowd matches this goal assignment', { path: `${path}.targets` })
        const goal = compileGoal(operation.goal, world, `${path}.goal`)
        if (!goal.ok) return goal
        for (const agent of picked) {
          const current = agent.controller === undefined ? undefined : table.get(agent.controller)
          agent.controller = table.add(operation.mode === 'enqueue' && current ? enqueue(current, goal.value) : goal.value)
        }
        break
      }
      case 'schedule': {
        const added = addJob(operation, path)
        if (!added.ok) return added
        break
      }
      case 'define_rule': {
        const added = addRule(operation, path)
        if (!added.ok) return added
        break
      }
      default:
        return fail('UNSUPPORTED_CAPABILITY', `"${operation.op}" is not supported in the starting setup yet`, { path: `${path}.op` })
    }
  }
  for (const [index, schedule] of plan.timeline.entries()) {
    const added = addJob(schedule, `plan.timeline.${index}`)
    if (!added.ok) return added
  }
  for (const [index, rule] of plan.rules.entries()) {
    const added = addRule(rule, `plan.rules.${index}`)
    if (!added.ok) return added
  }
  return ok({ agents, controllers: table.controllers, jobs, rules })
}

function compileJob(schedule: ScheduleOperation, path: string, world: StaticWorld, table: ControllerTable, allSpawns: SpawnOperation[]): Result<CompiledJob> {
  const operations: CompiledOperation[] = []
  const compact = new Map<SpawnOperation, CompactSpawn>()
  for (const [index, operation] of schedule.operations.entries()) {
    const here = `${path}.operations.${index}`
    if (operation.op === 'spawn') {
      const spawn = compactSpawn(operation, here, world)
      if (!spawn.ok) return spawn
      compact.set(operation, spawn.value)
      operations.push(spawn.value)
      continue
    }
    if (operation.op === 'assign_goal') {
      const folded = foldGoal(operation, here, world, table, allSpawns, compact)
      if (!folded.ok) return folded
      if (folded.value) continue
    }
    if (operation.op === 'emit' && Object.keys(operation.event).length === 1) {
      operations.push({ op: 'emit', event: operation.event.name })
      continue
    }
    operations.push(copy(operation))
  }
  const at = schedule.at ?? schedule.after
  return ok({ id: schedule.id, at: at!, operations })
}

/** A scheduled spawn into one named room, in the compact form the engine expands on load. */
function compactSpawn(spawn: SpawnOperation, path: string, world: StaticWorld): Result<CompactSpawn> {
  const zone = insideRoomId(spawn.placement)
  if (zone === undefined) return fail('UNSUPPORTED_CAPABILITY', 'Arrivals can only be placed inside a single named room for now', { path: `${path}.placement` })
  if (!world.rooms.some((room) => room.id === zone)) return fail('NOT_FOUND', `No room called "${zone}" to spawn into`, { path: `${path}.placement`, affectedIds: [zone] })
  const { template } = spawn
  return ok({
    op: 'spawn',
    count: spawn.count,
    zone,
    profile: template.profile ?? DEFAULT_PROFILE,
    tags: [...(template.tags ?? [])],
    ...(template.label !== undefined && { label: template.label }),
    ...(template.components !== undefined && { components: copy(template.components) }),
    ...(template.appearance !== undefined && { appearance: { ...template.appearance } }),
  })
}

/**
 * Folds a scheduled `assign_goal` into its job's spawns when only those arrivals could ever
 * match it, so they enter already holding the goal (the late arrivals in the worked example).
 * Returns false, leaving the operation for the engine, when anyone else might match.
 */
function foldGoal(
  operation: Extract<Operation, { op: 'assign_goal' }>, path: string, world: StaticWorld,
  table: ControllerTable, allSpawns: SpawnOperation[], compact: Map<SpawnOperation, CompactSpawn>,
): Result<boolean> {
  const { targets } = operation
  if (!isSimpleSelector(targets) || targets.ids !== undefined) return ok(false)
  const matching = allSpawns.filter((spawn) => templateMatches(spawn.template, targets))
  if (matching.length === 0 || !matching.every((spawn) => compact.has(spawn))) return ok(false)
  const goal = compileGoal(operation.goal, world, `${path}.goal`)
  if (!goal.ok) return goal
  for (const spawn of matching) {
    const target = compact.get(spawn)!
    const current = target.controller === undefined ? undefined : table.get(target.controller)
    target.controller = table.add(operation.mode === 'enqueue' && current ? enqueue(current, goal.value) : goal.value)
  }
  return ok(true)
}

/** `when event → assign_goal` becomes an event controller rule; anything else passes through. */
function compileRule(rule: DefineRuleOperation, path: string, world: StaticWorld, table: ControllerTable): Result<DefineRuleOperation | EventControllerRule> {
  const [only] = rule.operations
  if (rule.when.kind !== 'event' || rule.operations.length !== 1 || only?.op !== 'assign_goal' || 'binding' in only.targets) return ok(copy(rule))
  const goal = compileGoal(only.goal, world, `${path}.operations.0.goal`)
  if (!goal.ok) return goal
  return ok({
    id: rule.id,
    event: rule.when.name,
    match: copy(only.targets),
    controller: table.add(goal.value),
    mode: only.mode ?? 'replace',
    ...(rule.once !== undefined && { once: rule.once }),
    ...(rule.cooldown !== undefined && { cooldown: rule.cooldown }),
  })
}
