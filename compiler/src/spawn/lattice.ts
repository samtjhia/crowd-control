import type { AgentBlueprint, ModelPreset, Operation, Placement, Result, RoomRecord } from '@crowd-control/contract'
import { fail, ok } from '../result.ts'

/** Profile used when a spawn template names none. Step 4 resolves profiles properly. */
export const DEFAULT_PROFILE = 'person'

type Point = { x: number; y: number }

/**
 * The spawn lattice for one room (Technical PRD §8 "Rasterization and spawning"):
 *   x = room.x + radius + (index % columns) * pitch
 *   y = room.y + radius + floor(index / columns) * pitch
 * Columns and rows are as many as fit inside the room, so the worked example's 10×4 hall
 * gets five columns and two rows. Slots fill left to right, then top to bottom.
 */
export function roomLattice(room: RoomRecord, radius: number, pitch: number) {
  const fit = (span: number) => (span < 2 * radius ? 0 : Math.floor((span - 2 * radius) / pitch + 1e-9) + 1)
  const columns = fit(room.width)
  const rows = fit(room.height)
  return {
    columns,
    capacity: columns * rows,
    slot: (index: number): Point => ({
      x: room.x + radius + (index % columns) * pitch,
      y: room.y + radius + Math.floor(index / columns) * pitch,
    }),
  }
}

/**
 * Places the plan's starting crowd: every `spawn` in `initialOperations`, in order, with IDs
 * a1, a2, … Later spawns into the same room continue that room's lattice, so nobody overlaps.
 * Scheduled spawns are left to the engine, which places them when they fall due.
 *
 * Controllers are not attached here; goals are compiled in a later step.
 */
export function placeInitialAgents(operations: Operation[], rooms: RoomRecord[], model: ModelPreset): Result<AgentBlueprint[]> {
  const pitch = model.layout.spacingDiameters * model.layout.bodyDiameter
  const latticeRadius = model.defaultAgent.physical.radius
  const used = new Map<string, number>()
  const agents: AgentBlueprint[] = []

  for (const [index, operation] of operations.entries()) {
    if (operation.op !== 'spawn') continue
    const path = `plan.initialOperations.${index}.placement`
    const roomId = insideRoomId(operation.placement)
    if (roomId === undefined) {
      return fail('UNSUPPORTED_CAPABILITY', 'Starting crowds can only be placed inside a single named room for now', { path })
    }
    const room = rooms.find((candidate) => candidate.id === roomId)
    if (!room) return fail('NOT_FOUND', `No room called "${roomId}" to spawn into`, { path, affectedIds: [roomId] })

    const { template } = operation
    const radius = template.components?.physical?.radius ?? latticeRadius
    if (2 * radius > pitch) {
      return fail('LAYOUT_CONSTRAINTS_UNSATISFIABLE', `Agents of radius ${radius} are wider than the spawn spacing of ${pitch}`, { path: `plan.initialOperations.${index}.template` })
    }
    const lattice = roomLattice(room, latticeRadius, pitch)
    const start = used.get(room.id) ?? 0
    if (start + operation.count > lattice.capacity) {
      return fail('LAYOUT_CONSTRAINTS_UNSATISFIABLE', `"${room.id}" fits ${lattice.capacity} people at the starting spacing, but ${start + operation.count} are placed there`, { path, affectedIds: [room.id] })
    }
    for (let slot = start; slot < start + operation.count; slot++) {
      const { x, y } = lattice.slot(slot)
      // Clearance: the whole body must sit inside the room, clear of its walls.
      if (x - radius < room.x || y - radius < room.y || x + radius > room.x + room.width || y + radius > room.y + room.height) {
        return fail('LAYOUT_CONSTRAINTS_UNSATISFIABLE', `Agents of radius ${radius} do not clear the walls of "${room.id}"`, { path, affectedIds: [room.id] })
      }
      agents.push({
        id: `a${agents.length + 1}`,
        ...(template.label !== undefined && { label: template.label }),
        tags: [...(template.tags ?? [])],
        profile: template.profile ?? DEFAULT_PROFILE,
        x,
        y,
        ...(template.components !== undefined && { components: JSON.parse(JSON.stringify(template.components)) as typeof template.components }),
        ...(template.appearance !== undefined && { appearance: { ...template.appearance } }),
      })
    }
    used.set(room.id, start + operation.count)
  }
  return ok(agents)
}

/** `{ inside: { ids: [room] } }`, optionally with `kind: "zone"`, is the one placement supported so far. */
function insideRoomId(placement: Placement): string | undefined {
  if (!('inside' in placement) || Object.keys(placement).length !== 1) return undefined
  const { ids, kind, ...rest } = placement.inside
  if (Object.keys(rest).length > 0 || (kind !== undefined && kind !== 'zone') || ids?.length !== 1) return undefined
  return ids[0]
}
