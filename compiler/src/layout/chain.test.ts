import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConnectionPlan, Result, SpacePlan } from '@crowd-control/contract'
import { workedExample } from '../testing.ts'
import { chainLayout, designPopulation, type ChainLayout } from './chain.ts'

function generated() {
  const input = workedExample()
  if (input.plan.layout.mode !== 'generate') throw new Error('worked example should be a generated layout')
  return { input, spaces: input.plan.layout.spaces, connections: input.plan.layout.connections }
}

function sized(result: Result<ChainLayout>): ChainLayout {
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) throw new Error('unreachable')
  return result.value
}

const errorCode = (result: Result<unknown>) => (result.ok ? null : result.error.code)

test('PRD §8: design population counts initial and timeline spawns (8 + 2 = 10)', () => {
  assert.equal(designPopulation(generated().input.plan), 10)
})

test('PRD §8 / §14 baseline: rooms 10×4, 5×4, 5×4 in a 24×6 world', () => {
  const { input, spaces, connections } = generated()
  const layout = sized(chainLayout(spaces, connections, designPopulation(input.plan), input.model))
  assert.deepEqual([layout.pitch, layout.columns, layout.spawnRows], [2, 5, 2])
  assert.deepEqual(layout.rooms.map((r) => [r.id, r.x, r.y, r.width, r.height]), [
    ['hall', 1, 1, 10, 4],
    ['foyer', 12, 1, 5, 4],
    ['outside', 18, 1, 5, 4],
  ])
  assert.deepEqual([layout.worldWidth, layout.worldHeight, layout.cellSize], [24, 6, 1])
})

test('PRD §8: doors sit in the shared walls, centred, two body widths tall', () => {
  const { input, spaces, connections } = generated()
  const layout = sized(chainLayout(spaces, connections, 10, input.model))
  assert.deepEqual(layout.portals.map((p) => [p.id, p.x, p.y, p.width, p.height, p.open]), [
    ['hall_door', 11, 2, 1, 2, true],
    ['exit', 17, 2, 1, 2, true],
  ])
})

test('labels, tags and appearance are copied from the plan, not shared with it', () => {
  const { input, spaces, connections } = generated()
  const layout = sized(chainLayout(spaces, connections, 10, input.model))
  assert.deepEqual(layout.rooms[0], { id: 'hall', x: 1, y: 1, width: 10, height: 4, label: 'Hall', appearance: { fill: '#DBEAFE', labelVisible: true } })
  assert.deepEqual(layout.portals[1]?.tags, ['exit'])
  assert.notEqual(layout.rooms[0]?.appearance, spaces[0]?.appearance)
})

test('area weights set relative widths; a different crowd size changes depth, not the ratios', () => {
  const { input } = generated()
  const spaces: SpacePlan[] = [{ id: 'a', areaWeight: 3 }, { id: 'b', areaWeight: 1 }]
  const connections: ConnectionPlan[] = [{ id: 'ab', connects: ['a', 'b'] }]
  const layout = sized(chainLayout(spaces, connections, 40, input.model))
  // 40 people: columns ceil(sqrt(80)) = 9, rows ceil(40/9) = 5, depth 10, base width ceil(18/3) = 6.
  assert.deepEqual(layout.rooms.map((r) => [r.width, r.height]), [[18, 10], [6, 10]])
  assert.equal(layout.rooms[0]!.width / layout.rooms[1]!.width, 3)
  // Door centred in a 10-deep wall: y = 1 + (10 - 2) / 2 = 5.
  assert.equal(layout.portals[0]?.y, 5)
})

test('impossible layouts fail clearly instead of producing broken geometry', () => {
  const { input, spaces, connections } = generated()
  const wideDoor = { ...input.model, layout: { ...input.model.layout, doorBodyWidths: 6 } }
  assert.equal(errorCode(chainLayout(spaces, connections, 10, wideDoor)), 'LAYOUT_CONSTRAINTS_UNSATISFIABLE')
  assert.equal(errorCode(chainLayout(spaces, connections, 0, input.model)), 'LAYOUT_CONSTRAINTS_UNSATISFIABLE')
  const offGrid = { ...input.model, layout: { ...input.model.layout, spacingDiameters: 1.5 } }
  assert.equal(errorCode(chainLayout(spaces, connections, 10, offGrid)), 'LAYOUT_CONSTRAINTS_UNSATISFIABLE')
  const skipping: ConnectionPlan[] = [{ id: 'x', connects: ['hall', 'outside'] }, connections[1]!]
  assert.equal(errorCode(chainLayout(spaces, skipping, 10, input.model)), 'LAYOUT_CONSTRAINTS_UNSATISFIABLE')
})

test('an odd gap between door and room depth snaps the door to a whole cell', () => {
  const { input, spaces, connections } = generated()
  const threeWide = { ...input.model, layout: { ...input.model.layout, doorBodyWidths: 3 } }
  const layout = sized(chainLayout(spaces, connections, 10, threeWide))
  // (4 - 3) / 2 = 0.5 cells would split a cell; it snaps to y = 1.
  assert.deepEqual(layout.portals.map((p) => [p.y, p.height]), [[1, 3], [1, 3]])
})
