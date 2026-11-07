import type { ModelPreset, Operation, PortalRecord, Result, RoomRecord, ScenarioPlan, SpacePlan, ConnectionPlan } from '@crowd-control/contract'
import { fail, ok } from '../result.ts'

/** A sized rectangular-chain layout, in world units (Technical PRD §8 "Exact dimension calculation"). */
export type ChainLayout = {
  /** Everyone the plan will spawn up front or on its timeline; sizes the rooms. */
  designPopulation: number
  /** One cell is one body diameter. */
  cellSize: number
  /** Spawn spacing: `spacingDiameters` body diameters. */
  pitch: number
  /** Spawn lattice columns and rows that the shared room depth is sized for. */
  columns: number
  spawnRows: number
  /** World extent, wall strips included; columns = worldWidth / cellSize. */
  worldWidth: number
  worldHeight: number
  rooms: RoomRecord[]
  portals: PortalRecord[]
}

/**
 * Counts everyone the plan spawns in its initial operations and timeline (including
 * schedules nested inside timeline jobs). Rule-triggered spawns are not counted: rules can
 * fire any number of times, so they cannot size a building (§8).
 */
export function designPopulation(plan: ScenarioPlan): number {
  const count = (operations: Operation[]): number => operations.reduce((sum, op) => {
    if (op.op === 'spawn') return sum + op.count
    if (op.op === 'schedule') return sum + count(op.operations)
    return sum
  }, 0)
  return count(plan.initialOperations) + count(plan.timeline)
}

/**
 * The §8 rectangular-chain generator: spaces sit left to right at one shared depth, sized
 * by their relative area weights, separated by one-cell walls, with a door centred in each
 * shared wall. These are generation-policy values from the model preset, not measurements
 * of a real building. It is a concrete chain generator, not a general layout solver.
 */
export function chainLayout(spaces: SpacePlan[], connections: ConnectionPlan[], population: number, model: ModelPreset): Result<ChainLayout> {
  const { bodyDiameter, spacingDiameters, preferredAspect, doorBodyWidths } = model.layout
  // Pitch, room edges and openings must land on the grid (§8): whole numbers of cells.
  if (!Number.isInteger(spacingDiameters) || !Number.isInteger(doorBodyWidths)) {
    return fail('LAYOUT_CONSTRAINTS_UNSATISFIABLE', 'Spawn spacing and door width must be whole numbers of body widths to align with the grid', { path: 'model.layout' })
  }
  if (population <= 0) {
    return fail('LAYOUT_CONSTRAINTS_UNSATISFIABLE', 'A generated layout needs at least one person in the plan to size its rooms', { path: 'plan.initialOperations' })
  }

  const cell = bodyDiameter
  const pitch = spacingDiameters * cell
  const columns = Math.ceil(Math.sqrt(population * preferredAspect))
  const spawnRows = Math.ceil(population / columns)
  const depth = spawnRows * pitch
  const baseWidth = Math.ceil((columns * pitch) / spaces[0]!.areaWeight / cell) * cell

  const rooms: RoomRecord[] = []
  let x = cell
  for (const space of spaces) {
    rooms.push({
      id: space.id, x, y: cell, width: space.areaWeight * baseWidth, height: depth,
      ...(space.label === undefined ? {} : { label: space.label }),
      ...(space.tags === undefined ? {} : { tags: [...space.tags] }),
      ...(space.appearance === undefined ? {} : { appearance: { ...space.appearance } }),
    })
    x += space.areaWeight * baseWidth + cell
  }

  if (connections.length !== rooms.length - 1) {
    return fail('LAYOUT_CONSTRAINTS_UNSATISFIABLE', 'A generated chain needs exactly one connection between each pair of neighbouring spaces', { path: 'plan.layout.connections' })
  }
  const doorHeight = doorBodyWidths * cell
  if (doorHeight > depth) {
    return fail('LAYOUT_CONSTRAINTS_UNSATISFIABLE', `A ${doorHeight}-unit door does not fit in ${depth}-unit-deep rooms`, { path: 'model.layout.doorBodyWidths' })
  }
  // Centred in the shared wall, snapped down to a whole cell so the opening stays on the grid.
  const doorY = cell + Math.floor((depth - doorHeight) / 2 / cell) * cell

  const portals: PortalRecord[] = []
  for (let i = 0; i < connections.length; i++) {
    const edge = connections[i]!
    const left = rooms[i]!, right = rooms[i + 1]!
    if (!edge.connects.includes(left.id) || !edge.connects.includes(right.id)) {
      return fail('LAYOUT_CONSTRAINTS_UNSATISFIABLE', `Connection ${edge.id} must join neighbouring spaces ${left.id} and ${right.id}`, { path: `plan.layout.connections.${i}` })
    }
    portals.push({
      id: edge.id, connects: [...edge.connects], open: true,
      x: left.x + left.width, y: doorY, width: cell, height: doorHeight,
      ...(edge.label === undefined ? {} : { label: edge.label }),
      ...(edge.tags === undefined ? {} : { tags: [...edge.tags] }),
      ...(edge.appearance === undefined ? {} : { appearance: { ...edge.appearance } }),
    })
  }

  return ok({
    designPopulation: population, cellSize: cell, pitch, columns, spawnRows,
    worldWidth: x, worldHeight: depth + 2 * cell, rooms, portals,
  })
}
