import type { CompiledMap, PortalRecord, PreparedMap, Result, RoomRecord } from '@crowd-control/contract'
import { fail, ok } from '../result.ts'
import { gridArea, type SpawnArea } from '../spawn/lattice.ts'
import { cellBounds } from '../venues/build.ts'

/**
 * Turns a reviewed prepared map into the compiled map form the engine loads: the grid as is,
 * plus a room record per zone and a portal record per opening, each with the bounding box of
 * its cells and the metadata (label, tags, appearance, connections) from the map's entities.
 * Zones may be any shape; the grid decides membership and the box only bounds it.
 *
 * Objects (tables, desks, counters people can use) are passed through as map entities, which
 * the engine loads so goals can target them. Barriers are not supported yet, so they fail
 * clearly instead of being dropped.
 */
export function mapFromPrepared(asset: PreparedMap): Result<{ map: CompiledMap; areas: SpawnArea[] }> {
  const { grid } = asset
  const byId = new Map(asset.entities.map((entity) => [entity.id, entity]))
  const other = asset.entities.find((entity) => entity.kind !== 'zone' && entity.kind !== 'portal' && entity.kind !== 'object')
  if (other) {
    return fail('UNSUPPORTED_CAPABILITY', `Map objects such as "${other.id}" cannot be simulated yet`, { path: `assets.${asset.id}.entities`, affectedIds: [other.id] })
  }
  const metadata = (id: string) => {
    const entity = byId.get(id)
    return {
      ...(entity?.label !== undefined && { label: entity.label }),
      ...(entity?.tags !== undefined && { tags: [...entity.tags] }),
      ...(entity?.appearance !== undefined && { appearance: { ...entity.appearance } }),
    }
  }

  const rooms: RoomRecord[] = []
  for (const [index, id] of grid.zoneIds.entries()) {
    if (id === null) continue
    const bounds = cellBounds(grid.zoneIndex, index, grid.width, grid.cellSize)
    if (bounds.width === 0) return fail('NO_WALKABLE_SPACE', `Zone "${id}" has no floor in the prepared map`, { path: `assets.${asset.id}.grid`, affectedIds: [id] })
    rooms.push({ ...bounds, id, ...metadata(id) })
  }
  const portals: PortalRecord[] = []
  for (const [index, id] of grid.portalIds.entries()) {
    if (id === null) continue
    const connection = byId.get(id)?.components?.portal
    if (!connection) return fail('INVALID_SCHEMA', `Portal "${id}" in the prepared map does not say which zones it connects`, { path: `assets.${asset.id}.entities`, affectedIds: [id] })
    const bounds = cellBounds(grid.portalIndex, index, grid.width, grid.cellSize)
    if (bounds.width === 0) return fail('LAYOUT_CONSTRAINTS_UNSATISFIABLE', `Portal "${id}" has no cells in the prepared map`, { path: `assets.${asset.id}.grid`, affectedIds: [id] })
    portals.push({
      ...bounds,
      id,
      connects: [connection.connects[0], connection.connects[1]],
      open: connection.open,
      ...(connection.oneWay !== undefined && { oneWay: connection.oneWay }),
      ...(connection.traversalTime !== undefined && { traversalTime: connection.traversalTime }),
      ...metadata(id),
    })
  }

  const copy = JSON.parse(JSON.stringify(grid)) as typeof grid
  const map: CompiledMap = {
    units: grid.units,
    cellSize: grid.cellSize,
    width: grid.width * grid.cellSize,
    height: grid.height * grid.cellSize,
    rooms,
    portals,
    grid: copy,
    source: { ...asset.source },
  }
  const objects = asset.entities.filter((entity) => entity.kind === 'object')
  if (objects.length > 0) map.entities = JSON.parse(JSON.stringify(objects)) as typeof objects
  return ok({ map, areas: rooms.map((room) => gridArea(copy, room.id, room)) })
}
