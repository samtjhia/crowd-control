import type { AgentTemplate, EntitySelector, Goal, Operation, ScenarioPlan } from '@crowd-control/contract'
import { isSimpleSelector, templateMatches } from './targets.ts'

/**
 * Several desks for one step: "check in at B, D or E". The engine serves each person at one
 * desk (interact and queue take one target), so a group sent to several desks is split evenly
 * between them before compiling: its spawn becomes one spawn per desk, each tagged
 * `via_<desk>`, and its goal one goal per desk. Everything else is left as written.
 */

type Entity = { id: string; kind: string; tags?: readonly string[]; label?: string }

/** The desks a selector names, when it names more than one object people can use. */
function desks(selector: unknown, entities: readonly Entity[]): string[] {
  if (typeof selector !== 'object' || selector === null || 'binding' in selector) return []
  const s = selector as EntitySelector
  if (!isSimpleSelector(s)) return []
  const found = entities.filter((e) => e.kind === 'object'
    && (s.ids === undefined || s.ids.includes(e.id))
    && (s.kind === undefined || s.kind === e.kind)
    && (s.tags === undefined || s.tags.every((tag) => e.tags?.includes(tag)))
    && (s.label === undefined || s.label === e.label))
  return found.length > 1 ? found.map((e) => e.id) : []
}

/** The first interact or queue step with several desks, anywhere in the goal; empty if none. */
export function deskChoice(goal: Goal, entities: readonly Entity[]): string[] {
  if (goal.kind === 'sequence') {
    for (const child of goal.goals) {
      const found = deskChoice(child, entities)
      if (found.length > 0) return found
    }
    return []
  }
  return goal.kind === 'interact' || goal.kind === 'queue' ? desks(goal.target, entities) : []
}

/** The goal with every step naming exactly those desks pointed at one of them. */
function atDesk(goal: Goal, choice: readonly string[], desk: string, entities: readonly Entity[]): Goal {
  if (goal.kind === 'sequence') return { ...goal, goals: goal.goals.map((child) => atDesk(child, choice, desk, entities)) }
  if (goal.kind !== 'interact' && goal.kind !== 'queue') return goal
  const named = desks(goal.target, entities)
  return named.length === choice.length && named.every((id, k) => id === choice[k]) ? { ...goal, target: { ids: [desk] } } : goal
}

const deskTag = (desk: string) => `via_${desk}`.slice(0, 64)

/** Splits `count` as evenly as possible into `parts` (earlier parts get the remainder). */
function shares(count: number, parts: number): number[] {
  return Array.from({ length: parts }, (_, k) => Math.floor(count / parts) + (k < count % parts ? 1 : 0))
}

function spreadOperations(operations: readonly Operation[], entities: readonly Entity[]): Operation[] {
  // Which spawns to split, and over which desks: from the goals given to them in this list.
  const splits = new Map<Operation, string[]>()
  const goals = new Map<Operation, string[]>()
  for (const op of operations) {
    if (op.op !== 'assign_goal' || !isSimpleSelector(op.targets)) continue
    const choice = deskChoice(op.goal, entities)
    if (choice.length === 0) continue
    const spawns = operations.filter((o): o is Extract<Operation, { op: 'spawn' }> => o.op === 'spawn' && templateMatches(o.template as AgentTemplate, op.targets as EntitySelector))
    if (spawns.length === 0 || spawns.some((spawn) => splits.has(spawn) && splits.get(spawn)!.join() !== choice.join())) continue
    for (const spawn of spawns) splits.set(spawn, choice)
    goals.set(op, choice)
  }
  if (goals.size === 0) return operations.map((op) => nested(op, entities))
  return operations.flatMap((op): Operation[] => {
    const split = splits.get(op)
    if (split && op.op === 'spawn') {
      const counts = shares(op.count, split.length)
      return split.flatMap((desk, k) => counts[k]! > 0
        ? [{ ...op, count: counts[k]!, template: { ...op.template, tags: [...(op.template.tags ?? []), deskTag(desk)] } }]
        : [])
    }
    const choice = goals.get(op)
    if (choice && op.op === 'assign_goal') {
      const targets = op.targets as EntitySelector
      return choice.map((desk) => ({ ...op, targets: { ...targets, tags: [...(targets.tags ?? []), deskTag(desk)] }, goal: atDesk(op.goal, choice, desk, entities) }))
    }
    return [nested(op, entities)]
  })
}

/** Timed operations inside a schedule are split the same way. */
function nested(op: Operation, entities: readonly Entity[]): Operation {
  return op.op === 'schedule' ? { ...op, operations: spreadOperations(op.operations, entities) } : op
}

/** The plan with every group sent to several desks split evenly between them. */
export function spreadOverDesks(plan: ScenarioPlan, entities: readonly Entity[]): ScenarioPlan {
  return {
    ...plan,
    initialOperations: spreadOperations(plan.initialOperations, entities),
    timeline: plan.timeline.map((schedule) => ({ ...schedule, operations: spreadOperations(schedule.operations, entities) })),
  }
}
