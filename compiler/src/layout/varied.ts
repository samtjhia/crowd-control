import type { ConnectionPlan, ModelPreset, Result, SpacePlan } from '@crowd-control/contract'
import { seeded } from '../random.ts'
import { fail, ok } from '../result.ts'
import { chainLayout, type ChainLayout } from './chain.ts'

export type VariedLayout = ChainLayout & { sampledAspect: number; randomState: number }

/**
 * Seeded layout variation (Technical PRD §10 `compileVariedLayout`). The plan's seed draws the
 * room proportions (an aspect between 1 and 3 instead of the preset's fixed value), then one
 * position per door along its wall. Area ratios, head counts and connections never change,
 * and the same seed always gives the same building.
 *
 * Draw order matters for reproducibility: the aspect first, then each door in plan order.
 */
export function variedChainLayout(spaces: SpacePlan[], connections: ConnectionPlan[], population: number, model: ModelPreset, seed: number): Result<VariedLayout> {
  const random = seeded(seed)
  const sampledAspect = 1 + 2 * random.next()
  const sized = chainLayout(spaces, connections, population, { ...model, layout: { ...model.layout, preferredAspect: sampledAspect } })
  if (!sized.ok) return sized
  const { cellSize } = sized.value
  const portals = []
  for (const door of sized.value.portals) {
    const room = sized.value.rooms.find((candidate) => candidate.id === door.connects[0])!
    const slots = Math.floor((room.height - door.height) / cellSize + 1e-9) + 1
    if (slots <= 0) return fail('LAYOUT_CONSTRAINTS_UNSATISFIABLE', `No valid position for "${door.id}"`, { affectedIds: [door.id] })
    portals.push({ ...door, y: room.y + Math.floor(random.next() * slots) * cellSize })
  }
  return ok({ ...sized.value, portals, sampledAspect, randomState: random.state })
}
