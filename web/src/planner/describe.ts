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
    if (portalOpen !== undefined) return `${portalOpen ? 'Open' : 'Close'} portal ${targets}`
    const speed = operation.values.components?.navigation?.preferredSpeed
    if (speed !== undefined) return `Set preferred speed to ${speed} for ${targets}`
    const multiplier = operation.values.components?.mobility?.speedMultiplier
    if (multiplier !== undefined) return `Set mobility speed multiplier to ${multiplier} for ${targets}`
    return `Update ${targets}`
  }
  return `Apply ${operation.op} operation`
}
