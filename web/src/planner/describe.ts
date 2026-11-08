import type { InventoryItem, Operation, ScenarioPlan } from '@crowd-control/contract'

/**
 * Plain-language summaries of planner output, shared by the planner page and the simulator's
 * Assistant panel so a plan or change reads the same everywhere. Moved from PlannerApp.tsx.
 */

export function describePlan(plan: ScenarioPlan) {
  const layout = plan.layout
  const startingZones = plan.initialOperations.flatMap((operation) => {
    if (operation.op !== 'spawn' || !operation.placement || !('inside' in operation.placement)) return []
    return operation.placement.inside.ids ?? []
  })
  let locations: string[]
  if (layout.mode === 'generate') {
    locations = startingZones.map(
      (id) => layout.spaces.find((space) => space.id === id)?.label ?? id,
    )
  } else if (layout.mode === 'lookup') {
    locations = [`${layout.venue} (${layout.floor})`]
  } else {
    locations = ['uploaded floor plan']
  }
  const population = plan.initialOperations.reduce(
    (total, operation) => total + (operation.op === 'spawn' ? operation.count : 0),
    0,
  )
  return { locations, population }
}

export function displayName(value: string): string {
  return value.replace(/_+/g, ' ')
}

export function describeOperations(operations: Operation[], inventory: InventoryItem[]): string[] {
  return operations.flatMap((operation) => {
    if (operation.op !== 'schedule') return [describeOperation(operation, inventory)]
    const when = 'after' in operation ? `in ${operation.after} seconds` : `at ${operation.at} seconds`
    return operation.operations.flatMap((nested) => {
      if (nested.op === 'schedule') return describeOperations([nested], inventory)
      return [`Schedule ${when}: ${describeOperation(nested, inventory)}`]
    })
  })
}

export function describeOperation(operation: Operation, inventory: InventoryItem[]): string {
  if (operation.op === 'schedule') {
    const when = 'after' in operation ? `in ${operation.after} seconds` : `at ${operation.at} seconds`
    return `Schedule ${when}: ${operation.operations.map((nested) => describeOperation(nested, inventory)).join('. ')}`
  }
  if (operation.op === 'spawn') {
    const ids = 'inside' in operation.placement ? operation.placement.inside.ids : undefined
    const locations = ids?.map((id) => {
      const item = inventory.find((entry) => entry.id === id)
      return displayName(item?.label ?? id)
    }).join(', ')
    return `Add ${operation.count} ${operation.count === 1 ? 'person' : 'people'}${locations ? ` in ${locations}` : ''}`
  }
  if (operation.op === 'set') {
    const ids = 'ids' in operation.targets ? operation.targets.ids : undefined
    const targets = ids?.map((id) => {
      const item = inventory.find((entry) => entry.id === id)
      return displayName(item?.label ?? id)
    }).join(', ') ?? 'selected entities'
    const portalOpen = operation.values.components?.portal?.open
    if (portalOpen !== undefined) return `${portalOpen ? 'Open' : 'Close'} ${targets}`
    const speed = operation.values.components?.navigation?.preferredSpeed
    if (speed !== undefined) return `Set preferred speed to ${speed} for ${targets}`
    const multiplier = operation.values.components?.mobility?.speedMultiplier
    if (multiplier !== undefined) return `Set mobility speed multiplier to ${multiplier} for ${targets}`
    return `Update ${targets}`
  }
  if (operation.op === 'assign_goal') {
    const who = describeWho(operation.targets, inventory)
    const after = operation.mode === 'enqueue' ? ' after what they are doing' : ''
    if (operation.goal.kind === 'reach') return `Send ${who} to ${describeWhere(operation.goal.target, inventory)}${after}`
    return `Have ${who} ${describeGoal(operation.goal, inventory)}${after}`
  }
  if (operation.op === 'clear_goal') return `Stop ${describeWho(operation.targets, inventory)} from what they are doing`
  if (operation.op === 'remove') return `Remove ${describeWho(operation.targets, inventory)}`
  if (operation.op === 'add') {
    const what = operation.entity.tags?.includes('hazard') ? 'a danger' : displayName(operation.entity.label ?? operation.entity.id)
    const placement = operation.placement
    const region = placement && 'inside' in placement ? placement.inside : placement && 'near' in placement ? placement.near : undefined
    const where = region?.ids ? ` ${placement && 'near' in placement ? 'near' : 'in'} ${region.ids.map((id) => nameIn(id, inventory)).join(' or ')}` : ''
    // Placed by shape (at a marked point): say where, to the nearest whole unit.
    const shape = operation.entity.shape
    const at = !where && shape?.kind === 'rectangle' ? ` at (${Math.round(shape.x + shape.width / 2)}, ${Math.round(shape.y + shape.height / 2)})` : ''
    return `Place ${what}${where}${at}`
  }
  if (operation.op === 'emit') return operation.event.name === 'alarm' ? 'Sound the alarm' : `Signal “${displayName(operation.event.name)}”`
  if (operation.op === 'remove_rule') return `Stop the rule “${displayName(operation.id)}”`
  if (operation.op === 'define_rule') {
    const when = operation.when.kind !== 'event'
      ? `a ${operation.when.kind} condition is met`
      : operation.when.name === 'alarm' ? 'the alarm sounds' : `“${displayName(operation.when.name)}” happens`
    const then = operation.operations.map((nested) => describeOperation(nested, inventory))
    return `When ${when}${operation.once === false ? ' (each time)' : ''}: ${then.join('; ')}`
  }
  return `Apply ${(operation as Operation).op} operation`
}

type Goal = Extract<Operation, { op: 'assign_goal' }>['goal']
type Selector = Extract<Operation, { op: 'assign_goal' }>['targets']

function nameIn(id: string, inventory: InventoryItem[]): string {
  return displayName(inventory.find((entry) => entry.id === id)?.label ?? id)
}

/** Who a change applies to: named people, a tag ("people tagged attendee"), or everyone. */
export function describeWho(selector: Selector, inventory: InventoryItem[]): string {
  if ('binding' in selector) return 'that person'
  if (selector.ids) {
    // A long list of people (a danger's whole neighbourhood) reads as a count.
    if (selector.ids.length > 3) return selector.ids.every((id) => !inventory.some((item) => item.id === id)) ? `${selector.ids.length} people` : `${selector.ids.length} things`
    return selector.ids.map((id) => nameIn(id, inventory)).join(', ')
  }
  const group = selector.tags
    ? `people tagged ${selector.tags.map(displayName).join(' and ')}`
    : !selector.kind || selector.kind === 'agent' ? 'everyone' : `every ${selector.kind}`
  const where = selector.inside?.ids ? ` in ${selector.inside.ids.map((id) => nameIn(id, inventory)).join(', ')}` : ''
  return group + where
}

/** Where a goal points: named rooms or doors, or a description of the selection. */
function describeWhere(selector: Selector, inventory: InventoryItem[]): string {
  if ('binding' in selector) return 'that person'
  if (selector.ids) return selector.ids.map((id) => nameIn(id, inventory)).join(' or ')
  return selector.tags ? `the nearest ${selector.tags.map(displayName).join(' ')}` : 'the target'
}

/** A goal as something to do: "go to Outside", "wander in Hall", "wait 20 s, then go to Exit". */
export function describeGoal(goal: Goal, inventory: InventoryItem[]): string {
  switch (goal.kind) {
    case 'reach': return `go to ${describeWhere(goal.target, inventory)}`
    case 'avoid': return `keep away from ${describeWhere(goal.target, inventory)}`
    case 'wait': return `wait ${goal.duration} s${goal.inside ? ` in ${describeWhere(goal.inside, inventory)}` : ''}`
    case 'wander': return `wander in ${describeWhere(goal.inside, inventory)}`
    case 'follow': return `follow ${describeWhere(goal.target, inventory)}`
    case 'queue': return `queue for ${describeWhere(goal.target, inventory)}`
    case 'interact': return `use ${describeWhere(goal.target, inventory)}`
    case 'sequence': {
      const steps = goal.goals.map((step) => describeGoal(step, inventory)).join(', then ')
      return goal.repeat && goal.repeat > 1 ? `${steps} (${goal.repeat} times)` : steps
    }
  }
}
