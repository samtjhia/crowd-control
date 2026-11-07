import type { CompiledGoal } from '@crowd-control/contract'

/** A readable name for a compiled goal: `wander-hall`, `reach-hall-then-wander-hall`, `reach-outside`. */
export function controllerName(goal: CompiledGoal): string {
  switch (goal.kind) {
    case 'reach':
    case 'avoid': {
      const target = 'targetZone' in goal ? goal.targetZone : 'targetEntityId' in goal ? goal.targetEntityId : goal.targetIds.join('-or-')
      return `${goal.kind}-${target}`
    }
    case 'wait':
      return goal.insideZone === undefined ? 'wait' : `wait-${goal.insideZone}`
    case 'wander':
      return `wander-${goal.insideZone}`
    case 'follow':
    case 'queue':
    case 'interact':
      return `${goal.kind}-${goal.targetEntityId}`
    case 'sequence':
      return goal.goals.map(controllerName).join('-then-') + (goal.repeat === undefined ? '' : `-x${goal.repeat}`)
  }
}

/**
 * Shared controller definitions (Technical PRD §4): one entry per distinct goal, reused by
 * every agent, job and rule that needs it. Identical goals share a name; different goals that
 * would read the same (two `reach-outside` with different urgency, say) get `-2`, `-3`, …
 */
export class ControllerTable {
  readonly controllers: { [id: string]: CompiledGoal } = {}
  private readonly byShape = new Map<string, string>()

  add(goal: CompiledGoal): string {
    const shape = JSON.stringify(goal)
    const existing = this.byShape.get(shape)
    if (existing !== undefined) return existing
    const base = controllerName(goal).slice(0, 240)
    let name = base
    for (let n = 2; Object.hasOwn(this.controllers, name); n++) name = `${base}-${n}`
    this.controllers[name] = goal
    this.byShape.set(shape, name)
    return name
  }

  get(name: string): CompiledGoal | undefined {
    return this.controllers[name]
  }
}
