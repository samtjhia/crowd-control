import type { CompiledMap, EntityBlueprint, Operation, Result } from '@crowd-control/contract'
import { fail, ok } from '../result.ts'

/**
 * Objects a scenario places before it starts (`add` in its initial operations): a check-in
 * desk at a spot the person marked, a stand, a danger. They join the map's entities, so goals can
 * name them (interact, queue, avoid). They stand on the floor without blocking it: people use
 * them from beside or on them, and routes are unchanged.
 */
export function placeStartingObjects(operations: readonly Operation[], map: CompiledMap): Result<CompiledMap> {
  const adds = operations.flatMap((operation, index) => (operation.op === 'add' ? [{ operation, index }] : []))
  if (adds.length === 0) return ok(map)
  const taken = new Set<string>([
    ...map.rooms.map((room) => room.id), ...map.portals.map((portal) => portal.id), ...(map.entities ?? []).map((entity) => entity.id),
    ...('grid' in map && map.grid ? map.grid.zoneIds.filter((id): id is string => id !== null) : []),
  ])
  const placed: EntityBlueprint[] = []
  for (const { operation, index } of adds) {
    const path = `plan.initialOperations.${index}`
    const { entity } = operation
    if (entity.kind !== 'object') return fail('UNSUPPORTED_CAPABILITY', 'Only objects (desks, stands, dangers) can be placed in the starting setup', { path: `${path}.entity.kind` })
    if (!entity.shape) return fail('UNSUPPORTED_CAPABILITY', `"${entity.id}" needs a shape (where it stands) to be placed before the start`, { path: `${path}.entity.shape`, affectedIds: [entity.id] })
    if (taken.has(entity.id)) return fail('INVALID_SCHEMA', `"${entity.id}" is already used on this map`, { path: `${path}.entity.id`, affectedIds: [entity.id] })
    const centre = centreOf(entity.shape)
    if (!onFloor(map, centre)) return fail('NO_WALKABLE_SPACE', `"${entity.label ?? entity.id}" would stand in a wall or off the map`, { path: `${path}.entity.shape`, affectedIds: [entity.id] })
    taken.add(entity.id)
    placed.push(JSON.parse(JSON.stringify(entity)) as EntityBlueprint)
  }
  return ok({ ...map, entities: [...(map.entities ?? []), ...placed] })
}

function centreOf(shape: NonNullable<EntityBlueprint['shape']>): { x: number; y: number } {
  if (shape.kind === 'rectangle') return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 }
  if (shape.kind === 'circle') return shape.center
  const xs = shape.points.map((p) => p.x), ys = shape.points.map((p) => p.y)
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
}

/** Whether a point is on walkable floor: an open grid cell, or inside a room on maps without a grid. */
function onFloor(map: CompiledMap, p: { x: number; y: number }): boolean {
  if ('grid' in map && map.grid) {
    const { grid } = map
    const column = Math.floor(p.x / grid.cellSize), row = Math.floor(p.y / grid.cellSize)
    if (column < 0 || row < 0 || column >= grid.width || row >= grid.height) return false
    return grid.blocked[row * grid.width + column] === 0
  }
  return map.rooms.some((room) => p.x >= room.x && p.x <= room.x + room.width && p.y >= room.y && p.y <= room.y + room.height)
}
