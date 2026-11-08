import assert from 'node:assert/strict'
import test from 'node:test'
import type { Result } from '@crowd-control/contract'
import { compile } from '../compile.ts'
import { seeded } from '../random.ts'
import { workedExample } from '../testing.ts'
import { chainLayout, designPopulation } from './chain.ts'
import { variedChainLayout, type VariedLayout } from './varied.ts'

function value<T>(result: Result<T>): T {
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) throw new Error('unreachable')
  return result.value
}

function varied(seed: number): VariedLayout {
  const { plan, model } = workedExample()
  if (plan.layout.mode !== 'generate') throw new Error('worked example should be generated')
  return value(variedChainLayout(plan.layout.spaces, plan.layout.connections, designPopulation(plan), model, seed))
}

const size = (layout: VariedLayout, id: string) => {
  const room = layout.rooms.find((r) => r.id === id)!
  return [room.width, room.height]
}

test('PRD §10: the generator\'s first draws for seeds 42 and 9001', () => {
  assert.equal(seeded(42).next().toFixed(6), '0.252345')
  assert.equal(seeded(9001).next().toFixed(6), '0.724427')
})

test('PRD §10 table: seed 42 gives an 8 × 6 hall, 4 × 6 rooms and doors at y 1 and 3', () => {
  const layout = varied(42)
  assert.equal(layout.sampledAspect.toFixed(6), '1.504690')
  assert.deepEqual([size(layout, 'hall'), size(layout, 'foyer'), size(layout, 'outside')], [[8, 6], [4, 6], [4, 6]])
  assert.deepEqual(layout.portals.map((door) => door.y), [1, 3])
})

test('PRD §10 table: seed 9001 gives a 10 × 4 hall, 5 × 4 rooms and doors at y 3 and 3', () => {
  const layout = varied(9001)
  assert.equal(layout.sampledAspect.toFixed(6), '2.448855')
  assert.deepEqual([size(layout, 'hall'), size(layout, 'foyer'), size(layout, 'outside')], [[10, 4], [5, 4], [5, 4]])
  assert.deepEqual(layout.portals.map((door) => door.y), [3, 3])
})

test('variation keeps area ratios and door sizes, and every door stays inside its wall', () => {
  for (const seed of [1, 7, 42, 9001, 123456, 4294967295]) {
    const layout = varied(seed)
    const [hall, foyer, outside] = layout.rooms
    assert.equal(hall!.width * hall!.height, 2 * foyer!.width * foyer!.height, `seed ${seed}`)
    assert.equal(foyer!.width * foyer!.height, outside!.width * outside!.height)
    for (const door of layout.portals) {
      assert.equal(door.height, 2)
      assert.ok(door.y >= hall!.y && door.y + door.height <= hall!.y + hall!.height, `seed ${seed} ${door.id}`)
    }
  }
})

test('the same seed always gives the same building', () => {
  assert.deepEqual(varied(42), varied(42))
  assert.notDeepEqual(varied(42).rooms, varied(9001).rooms)
})

test('compile varies only when asked; people are re-placed on the new shape', () => {
  const input = workedExample()
  const plain = value(compile(input))
  const changed = value(compile(input, { varyLayout: true }))
  if (input.plan.layout.mode !== 'generate') throw new Error('worked example should be generated')
  const baseline = value(chainLayout(input.plan.layout.spaces, input.plan.layout.connections, 10, input.model))
  assert.deepEqual(plain.scene.map.rooms, baseline.rooms, 'without the option the worked example is unchanged')
  assert.deepEqual('rows' in changed.scene.map ? changed.scene.map.rows : null, [
    '####################',
    '#HHHHHHHHDFFFF#OOOO#',
    '#HHHHHHHHDFFFF#OOOO#',
    '#HHHHHHHH#FFFFEOOOO#',
    '#HHHHHHHH#FFFFEOOOO#',
    '#HHHHHHHH#FFFF#OOOO#',
    '#HHHHHHHH#FFFF#OOOO#',
    '####################',
  ])
  assert.equal(changed.scene.agents.length, 8)
  const hall = changed.scene.map.rooms[0]!
  for (const agent of changed.scene.agents) assert.ok(agent.x > hall.x && agent.x < hall.x + hall.width && agent.y > hall.y && agent.y < hall.y + hall.height)
})
