import type { ModelPreset, PreparedMap } from '@crowd-control/contract'
import { latticeSlots } from '../spawn/lattice.ts'
import { mapFromPrepared } from './prepared.ts'

/**
 * How many people each room of a prepared map can hold at the start, at the model's starting
 * spacing: exactly the number of spawn slots the compiler would offer. The planner is told
 * these, so it writes crowds that fit instead of plans the compiler has to refuse.
 */
export function spawnCapacities(asset: PreparedMap, model: ModelPreset): Record<string, number> {
  const prepared = mapFromPrepared(asset)
  if (!prepared.ok) return {}
  const pitch = model.layout.spacingDiameters * model.layout.bodyDiameter
  const radius = model.defaultAgent.physical.radius
  return Object.fromEntries(prepared.value.areas.map((area) => [area.id, latticeSlots(area, radius, pitch).length]))
}
