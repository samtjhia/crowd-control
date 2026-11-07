import type { Operation, ScenarioPlan } from '@crowd-control/contract'

export type SpawnOperation = Extract<Operation, { op: 'spawn' }>

/**
 * Every spawn in the plan with its JSON path: initial operations, timeline jobs and rule
 * actions, descending into nested schedules and rules. Order is plan order.
 */
export function* spawnsIn(plan: ScenarioPlan): Generator<{ spawn: SpawnOperation; path: string }> {
  function* walk(operations: Operation[], path: string): Generator<{ spawn: SpawnOperation; path: string }> {
    for (const [index, operation] of operations.entries()) {
      const here = `${path}.${index}`
      if (operation.op === 'spawn') yield { spawn: operation, path: here }
      else if (operation.op === 'schedule' || operation.op === 'define_rule') yield* walk(operation.operations, `${here}.operations`)
    }
  }
  yield* walk(plan.initialOperations, 'plan.initialOperations')
  yield* walk(plan.timeline, 'plan.timeline')
  yield* walk(plan.rules, 'plan.rules')
}
