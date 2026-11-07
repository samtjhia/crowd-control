import assert from 'node:assert/strict'
import test from 'node:test'
import type { CompileInput, Operation, Result, RoomRecord } from '@crowd-control/contract'
import { chainLayout, designPopulation } from '../layout/chain.ts'
import { fixture, workedExample } from '../testing.ts'
import { latticeSlots, placeInitialAgents as place, rectArea } from './lattice.ts'

const profiles = { person: { radius: 0.5, preferredSpeed: 1 }, staff: { radius: 0.5, preferredSpeed: 1 }, wide: { radius: 1.5, preferredSpeed: 1 } }
const placeInitialAgents = (operations: Operation[], all: RoomRecord[], model: CompileInput['model']) => place(operations, all.map(rectArea), profiles, model)

function value<T>(result: Result<T>): T {
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) throw new Error('unreachable')
  return result.value
}

function rooms(input: CompileInput): RoomRecord[] {
  const { plan, model } = input
  if (plan.layout.mode !== 'generate') throw new Error('worked example should be generated')
  return value(chainLayout(plan.layout.spaces, plan.layout.connections, designPopulation(plan), model)).rooms
}

function spawn(count: number, room: string, extra: Partial<Extract<Operation, { op: 'spawn' }>['template']> = {}): Operation {
  return { op: 'spawn', template: { kind: 'agent', tags: ['guest'], ...extra }, count, placement: { inside: { ids: [room] } } }
}

test('PRD §8: the eight starting attendees sit on the hall lattice exactly as in the compiled fixture', () => {
  const input = workedExample()
  const agents = value(placeInitialAgents(input.plan.initialOperations, rooms(input), input.model))
  const expected = fixture<{ agents: { id: string; tags: string[]; x: number; y: number; appearance: unknown }[] }>('compiled-scene').agents
  assert.deepEqual(
    agents.map(({ id, tags, x, y, appearance }) => ({ id, tags, x, y, appearance })),
    expected.map(({ id, tags, x, y, appearance }) => ({ id, tags, x, y, appearance })),
  )
  assert.ok(agents.every((agent) => agent.profile === 'person' && agent.controller === undefined))
})

test('the hall lattice is five columns of two rows, as the PRD computes', () => {
  const input = workedExample()
  const slots = latticeSlots(rectArea(rooms(input)[0]!), 0.5, 2)
  assert.deepEqual([...new Set(slots.map((slot) => slot.x))], [1.5, 3.5, 5.5, 7.5, 9.5])
  assert.deepEqual([...new Set(slots.map((slot) => slot.y))], [1.5, 3.5])
})

test('a second spawn into the same room continues the lattice instead of overlapping', () => {
  const input = workedExample()
  const agents = value(placeInitialAgents([spawn(3, 'hall'), spawn(2, 'foyer'), spawn(3, 'hall')], rooms(input), input.model))
  assert.deepEqual(agents.map((agent) => agent.id), ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'])
  const positions = agents.map((agent) => `${agent.x},${agent.y}`)
  assert.equal(new Set(positions).size, positions.length)
  assert.deepEqual(agents.slice(5).map(({ x, y }) => [x, y]), [[7.5, 1.5], [9.5, 1.5], [1.5, 3.5]])
  assert.deepEqual(agents.slice(3, 5).map(({ x, y }) => [x, y]), [[12.5, 1.5], [14.5, 1.5]])
})

test('every placed body clears the walls and its neighbours', () => {
  const input = workedExample()
  const all = rooms(input)
  const agents = value(placeInitialAgents([spawn(10, 'hall'), spawn(6, 'foyer')], all, input.model))
  for (const agent of agents) {
    const room = all.find((r) => agent.x > r.x && agent.x < r.x + r.width && agent.y > r.y && agent.y < r.y + r.height)!
    assert.ok(agent.x - 0.5 >= room.x && agent.x + 0.5 <= room.x + room.width && agent.y - 0.5 >= room.y && agent.y + 0.5 <= room.y + room.height)
  }
  for (const a of agents) for (const b of agents) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 1)
})

test('templates are copied, not shared, and unset fields stay unset', () => {
  const input = workedExample()
  const op = spawn(1, 'hall', { label: 'Guest', profile: 'staff', appearance: { fill: '#000000' } })
  const [agent] = value(placeInitialAgents([op], rooms(input), input.model))
  assert.equal(agent!.label, 'Guest')
  assert.equal(agent!.profile, 'staff')
  if (op.op !== 'spawn') throw new Error('unreachable')
  assert.notEqual(agent!.appearance, op.template.appearance)
  assert.notEqual(agent!.tags, op.template.tags)
  const [bare] = value(placeInitialAgents([spawn(1, 'hall')], rooms(input), input.model))
  assert.ok(!('label' in bare!) && !('appearance' in bare!) && !('components' in bare!))
})

test('impossible placements fail clearly', () => {
  const input = workedExample()
  const all = rooms(input)
  const code = (result: Result<unknown>) => (result.ok ? null : result.error.code)
  assert.equal(code(placeInitialAgents([spawn(11, 'hall')], all, input.model)), 'NO_WALKABLE_SPACE')
  assert.equal(code(placeInitialAgents([spawn(8, 'hall'), spawn(3, 'hall')], all, input.model)), 'NO_WALKABLE_SPACE')
  assert.equal(code(placeInitialAgents([spawn(1, 'kitchen')], all, input.model)), 'NOT_FOUND')
  assert.equal(code(placeInitialAgents([spawn(1, 'hall', { components: { physical: { radius: 1.5 } } })], all, input.model)), 'NO_WALKABLE_SPACE')
  const near: Operation = { op: 'spawn', template: { kind: 'agent' }, count: 1, placement: { near: { ids: ['hall_door'] } } }
  assert.equal(code(placeInitialAgents([spawn(1, 'hall', { profile: 'wide' })], all, input.model)), 'NO_WALKABLE_SPACE')
  assert.equal(code(placeInitialAgents([near], all, input.model)), 'UNSUPPORTED_CAPABILITY')
  const byTag: Operation = { op: 'spawn', template: { kind: 'agent' }, count: 1, placement: { inside: { tags: ['indoor'] } } }
  assert.equal(code(placeInitialAgents([byTag], all, input.model)), 'UNSUPPORTED_CAPABILITY')
})
