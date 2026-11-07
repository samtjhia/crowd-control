import type { AgentBlueprint, AgentProfile, GridData, ModelPreset, Operation, Placement, Rect, Result, RoomRecord } from '@crowd-control/contract'
import { DEFAULT_PROFILE } from '../profiles/catalog.ts'
import { fail, ok } from '../result.ts'

type Point = { x: number; y: number }

/** Somewhere people can be spawned: its bounding box and a test for whether a body fits at a point. */
export type SpawnArea = { id: string; bounds: Rect; fits: (x: number, y: number, radius: number) => boolean }

const EPSILON = 1e-9

/** A rectangular room: a body fits when it lies wholly inside the rectangle. */
export function rectArea(room: RoomRecord): SpawnArea {
  return {
    id: room.id,
    bounds: { x: room.x, y: room.y, width: room.width, height: room.height },
    fits: (x, y, r) => x - r >= room.x - EPSILON && y - r >= room.y - EPSILON && x + r <= room.x + room.width + EPSILON && y + r <= room.y + room.height + EPSILON,
  }
}

/**
 * A zone of a prepared grid map: a body fits when every cell under its bounding square is
 * walkable floor of that zone, so nobody starts in a wall, a doorway or the next room.
 */
export function gridArea(grid: GridData, zoneId: string, bounds: Rect): SpawnArea {
  const zone = grid.zoneIds.indexOf(zoneId)
  const { cellSize, width, height } = grid
  return {
    id: zoneId,
    bounds,
    fits: (x, y, r) => {
      const left = Math.floor((x - r) / cellSize + EPSILON), right = Math.ceil((x + r) / cellSize - EPSILON)
      const top = Math.floor((y - r) / cellSize + EPSILON), bottom = Math.ceil((y + r) / cellSize - EPSILON)
      if (left < 0 || top < 0 || right > width || bottom > height) return false
      for (let cy = top; cy < bottom; cy++) {
        for (let cx = left; cx < right; cx++) {
          const i = cy * width + cx
          if (grid.blocked[i] !== 0 || grid.zoneIndex[i] !== zone || grid.portalIndex[i] !== 0) return false
        }
      }
      return true
    },
  }
}

/**
 * The spawn lattice for one area (Technical PRD §8 "Rasterization and spawning"):
 *   x = bounds.x + radius + column * pitch
 *   y = bounds.y + radius + row * pitch
 * over the area's bounding box, keeping the points where a body fits. Slots run left to right,
 * then top to bottom. For a rectangular room this is exactly the PRD's lattice: the worked
 * example's 10×4 hall gets five columns of two rows.
 */
export function latticeSlots(area: SpawnArea, radius: number, pitch: number): Point[] {
  const { x, y, width, height } = area.bounds
  const slots: Point[] = []
  for (let row = 0; y + radius + row * pitch + radius <= y + height + EPSILON; row++) {
    for (let column = 0; x + radius + column * pitch + radius <= x + width + EPSILON; column++) {
      const point = { x: x + radius + column * pitch, y: y + radius + row * pitch }
      if (area.fits(point.x, point.y, radius)) slots.push(point)
    }
  }
  return slots
}

/**
 * Places the plan's starting crowd: every `spawn` in `initialOperations`, in order, with IDs
 * a1, a2, … Later spawns into the same area continue its lattice, so nobody overlaps.
 * Scheduled spawns are left to the engine, which places them when they fall due.
 *
 * Each body's clearance uses its template radius override, else its profile's radius. A count
 * that cannot fit fails with NO_WALKABLE_SPACE; bodies never overlap and the count never shrinks.
 */
export function placeInitialAgents(operations: Operation[], areas: SpawnArea[], profiles: { [id: string]: AgentProfile }, model: ModelPreset): Result<AgentBlueprint[]> {
  const pitch = model.layout.spacingDiameters * model.layout.bodyDiameter
  const latticeRadius = model.defaultAgent.physical.radius
  const slots = new Map<string, Point[]>()
  const used = new Map<string, number>()
  const agents: AgentBlueprint[] = []

  for (const [index, operation] of operations.entries()) {
    if (operation.op !== 'spawn') continue
    const path = `plan.initialOperations.${index}.placement`
    const areaId = insideRoomId(operation.placement)
    if (areaId === undefined) {
      return fail('UNSUPPORTED_CAPABILITY', 'Starting crowds can only be placed inside a single named room for now', { path })
    }
    const area = areas.find((candidate) => candidate.id === areaId)
    if (!area) return fail('NOT_FOUND', `No room called "${areaId}" to spawn into`, { path, affectedIds: [areaId] })

    const { template } = operation
    const profile = template.profile ?? DEFAULT_PROFILE
    const radius = template.components?.physical?.radius ?? profiles[profile]?.radius ?? latticeRadius
    if (2 * radius > pitch) {
      return fail('NO_WALKABLE_SPACE', `Agents of radius ${radius} are wider than the spawn spacing of ${pitch}`, { path: `plan.initialOperations.${index}.template` })
    }
    if (!slots.has(area.id)) slots.set(area.id, latticeSlots(area, latticeRadius, pitch))
    const free = slots.get(area.id)!
    const start = used.get(area.id) ?? 0
    if (start + operation.count > free.length) {
      return fail('NO_WALKABLE_SPACE', `"${area.id}" fits ${free.length} people at the starting spacing, but ${start + operation.count} are placed there`, { path, affectedIds: [area.id] })
    }
    for (const { x, y } of free.slice(start, start + operation.count)) {
      if (!area.fits(x, y, radius)) {
        return fail('NO_WALKABLE_SPACE', `Agents of radius ${radius} do not clear the walls of "${area.id}"`, { path, affectedIds: [area.id] })
      }
      agents.push({
        id: `a${agents.length + 1}`,
        ...(template.label !== undefined && { label: template.label }),
        tags: [...(template.tags ?? [])],
        profile,
        x,
        y,
        ...(template.components !== undefined && { components: JSON.parse(JSON.stringify(template.components)) as typeof template.components }),
        ...(template.appearance !== undefined && { appearance: { ...template.appearance } }),
      })
    }
    used.set(area.id, start + operation.count)
  }
  return ok(agents)
}

/** `{ inside: { ids: [room] } }`, optionally with `kind: "zone"`, is the one placement supported so far. */
export function insideRoomId(placement: Placement): string | undefined {
  if (!('inside' in placement) || Object.keys(placement).length !== 1) return undefined
  const { ids, kind, ...rest } = placement.inside
  if (Object.keys(rest).length > 0 || (kind !== undefined && kind !== 'zone') || ids?.length !== 1) return undefined
  return ids[0]
}
