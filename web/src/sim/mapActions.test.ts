import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { CompileOutput, Frame, RenderScene, ScenarioPlan, Vec2 } from '@crowd-control/contract'
import { figureLook } from '../render/agentStyle.ts'
import { pickAt, pickInBox, zoneAt, zoneStrips } from '../render/hitTest.ts'
import { createMockEndpoint } from '../worker/mockEndpoint.ts'
import { SimulationClient } from '../worker/simulationClient.ts'
import { actionFor, isDown, isOpen, selectionActions, toggle, union } from './mapActions.ts'
import { scenarios, startScenario } from './scenario.ts'

const fixture = <T>(name: string) => JSON.parse(readFileSync(new URL(`../../../contract/fixtures/${name}.json`, import.meta.url), 'utf8')) as T
const compiled = fixture<CompileOutput>('compile-output')
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const idleClock = { now: () => 0, every: () => () => {} }

/** The worked example as the renderer sees it at load: a scene plus the first frame. */
function worked(): { scene: RenderScene; frame: Frame; positions: Map<string, Vec2> } {
  const scene: RenderScene = {
    map: compiled.scene.map, entities: [],
    agents: compiled.scene.agents.map((agent) => ({ id: agent.id, radius: 0.5, appearance: agent.appearance ?? {} })),
  }
  const frame: Frame = {
    streamId: 's', tick: 0, time: 0, topologyVersion: 0, sceneVersion: 1, historyRevision: 0,
    agents: compiled.scene.agents.map((agent) => ({ id: agent.id, x: agent.x, y: agent.y, profile: agent.profile, controller: agent.controller ?? null, state: 'moving' as const })),
  }
  return { scene, frame, positions: new Map(frame.agents.map((agent) => [agent.id, { x: agent.x, y: agent.y }])) }
}

const ALL = ['agent', 'portal', 'zone'] as const

test('a click picks the person, then the door, then the room under it', () => {
  const { scene, frame, positions } = worked()
  assert.deepEqual(pickAt(scene, frame, positions, { x: 1.5, y: 1.5 }, 0.2, ALL), { kind: 'agent', id: 'a1' })
  assert.deepEqual(pickAt(scene, frame, positions, { x: 2.1, y: 1.5 }, 0.2, ALL), { kind: 'agent', id: 'a1' }, 'body plus a little slop')
  assert.deepEqual(pickAt(scene, frame, positions, { x: 11.5, y: 3 }, 0.2, ALL), { kind: 'portal', id: 'hall_door' })
  assert.deepEqual(pickAt(scene, frame, positions, { x: 8.5, y: 3.5 }, 0.2, ALL), { kind: 'zone', id: 'hall' })
  assert.equal(pickAt(scene, frame, positions, { x: 0.5, y: 0.5 }, 0.2, ALL), null, 'walls pick nothing')
})

test('each tool only picks what it acts on, and people who left cannot be picked', () => {
  const { scene, frame, positions } = worked()
  assert.equal(pickAt(scene, frame, positions, { x: 11.5, y: 3 }, 0.2, ['agent']), null)
  assert.equal(pickAt(scene, frame, positions, { x: 1.5, y: 1.5 }, 0.2, ['portal']), null)
  const departed = { ...frame, agents: frame.agents.map((agent) => (agent.id === 'a1' ? { ...agent, state: 'departed' as const } : agent)) }
  assert.deepEqual(pickAt(scene, departed, positions, { x: 1.5, y: 1.5 }, 0.2, ALL), { kind: 'zone', id: 'hall' })
})

test('rooms on grid maps are found by their floor cells, not their bounding box', () => {
  const school = scenarios(fixture<ScenarioPlan>('scenario-plan'), compiled.resolvedModel).find((s) => s.id === 'school-wing')!
  const result = startScenario(school.plan, school.model)
  assert.ok(result.ok)
  const scene: RenderScene = { map: result.value.scene.map, entities: [], agents: [] }
  assert.equal(zoneAt(scene, { x: 20, y: 9.5 }), 'corridor')
  assert.equal(zoneAt(scene, { x: 10, y: 3 }), 'room_101')
  assert.equal(zoneAt(scene, { x: 16.75, y: 3 }), null, 'the wall between two classrooms')
})

test('Trip and Doors toggle through the same request path as chat, and changes are listed', async () => {
  const client = new SimulationClient(createMockEndpoint({ clock: idleClock }))
  await client.load(compiled)
  await flush()
  const view = () => client.getView()
  const act = async (tool: 'trip' | 'doors', kind: 'agent' | 'portal', id: string) => {
    const action = actionFor(tool, view().scene!, view().current!.frame, kind, id)
    assert.ok(action, `${tool} on ${id}`)
    const result = await client.apply(action.label, action.operations)
    assert.equal(result.ok, true, JSON.stringify(result))
    await client.step(1)
    await flush()
  }

  await act('trip', 'agent', 'a3')
  assert.equal(isDown(view().scene!, view().current!.frame, 'a3'), true)
  assert.equal(view().current!.frame.agents.find((a) => a.id === 'a3')!.state, 'immobile')
  await act('trip', 'agent', 'a3')
  assert.equal(isDown(view().scene!, view().current!.frame, 'a3'), false, 'a second click helps them up')

  await act('doors', 'portal', 'hall_door')
  assert.equal(isOpen(view().scene!, 'hall_door'), false)
  await act('doors', 'portal', 'hall_door')
  assert.equal(isOpen(view().scene!, 'hall_door'), true)

  assert.deepEqual(view().changes.map((change) => change.label), ['a3 falls', 'a3 gets up', 'Close hall door', 'Open hall door'])
  assert.equal(actionFor('trip', view().scene!, view().current!.frame, 'portal', 'hall_door'), null, 'Trip ignores doors')

  await client.reset()
  await flush()
  assert.deepEqual(view().changes, [], 'a reset starts a clean run')
})

test('a rejected change is reported, not listed', async () => {
  const client = new SimulationClient(createMockEndpoint({ clock: idleClock }))
  await client.load(compiled)
  await flush()
  const result = await client.apply('Remove the hall', [{ op: 'remove', targets: { ids: ['hall'] } }])
  assert.equal(result.ok, false)
  await flush()
  assert.deepEqual(client.getView().changes, [])
  assert.ok(client.getView().lastError)
})

test('a selected room is tinted over its floor only, never over tables or walls', () => {
  const plan = fixture<ScenarioPlan>('scenario-plan')
  const hackathon = scenarios(plan, compiled.resolvedModel).find((s) => s.id === 'hackathon-hall')!
  const result = startScenario(hackathon.plan, hackathon.model)
  assert.ok(result.ok)
  const scene: RenderScene = { map: result.value.scene.map, entities: [], agents: [] }
  const area = zoneStrips(scene, 'hall').reduce((sum, strip) => sum + strip.width * strip.height, 0)
  assert.equal(area, 40 * 30 - 24 * 6 * 0.75 - 4 * 1, 'the 40 × 30 m hall minus its 24 tables and the snack table')
  assert.deepEqual(zoneStrips(worked().scene, 'hall'), [{ x: 1, y: 1, width: 10, height: 4 }])
})

test('Shift-drag selects the people and doors inside the box', () => {
  const { scene, frame, positions } = worked()
  const top = pickInBox(scene, frame, positions, { x: 1, y: 1 }, { x: 6, y: 2 })
  assert.deepEqual(top.map((pick) => pick.id), ['a1', 'a2', 'a3'])
  const wide = pickInBox(scene, frame, positions, { x: 12, y: 4 }, { x: 0, y: 0 })
  assert.deepEqual(wide.map((pick) => pick.id), ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'hall_door'], 'boxes work dragged in any direction')
})

test('Shift-click toggles one item; a box adds without duplicates', () => {
  const a1 = { kind: 'agent' as const, id: 'a1' }, a2 = { kind: 'agent' as const, id: 'a2' }
  assert.deepEqual(toggle([a1], a2), [a1, a2])
  assert.deepEqual(toggle([a1, a2], a1), [a2])
  assert.deepEqual(union([a1], [a1, a2]), [a1, a2])
})

test('a group only offers actions its members share, and each says how many it affects', () => {
  const { scene, frame } = worked()
  const people = ['a1', 'a2', 'a3'].map((id) => ({ kind: 'agent' as const, id }))
  assert.deepEqual(selectionActions(scene, frame, people).map((a) => a.button), ['Make 3 fall'])
  assert.deepEqual(selectionActions(scene, frame, [people[0]!]).map((a) => a.button), ['Make them fall'])

  const someDown: RenderScene = { ...scene, agents: scene.agents.map((a) => (a.id === 'a2' ? { ...a, appearance: { ...a.appearance, pose: 'fallen' } } : a)) }
  const mixed = [...people, { kind: 'portal' as const, id: 'hall_door' }, { kind: 'zone' as const, id: 'foyer' }]
  const actions = selectionActions(someDown, frame, mixed)
  assert.deepEqual(actions.map((a) => a.button), ['Make 2 fall', 'Help 1 up', 'Close 1 door'])
  assert.deepEqual(actions.map((a) => a.action.label), ['2 people fall', 'a2 gets up', 'Close hall door'])
  assert.deepEqual(actions[0]!.action.operations[0], {
    op: 'set', targets: { ids: ['a1', 'a3'] }, values: { components: { mobility: { speedMultiplier: 0 } }, appearance: { pose: 'fallen' } },
  }, 'one operation for the whole group, only the people it fits')
  assert.deepEqual(selectionActions(scene, frame, [{ kind: 'zone', id: 'hall' }]), [], 'rooms have nothing to do yet')
})

test('a group action is one change in the list', async () => {
  const client = new SimulationClient(createMockEndpoint({ clock: idleClock }))
  await client.load(compiled)
  await flush()
  const view = client.getView()
  const picks = ['a1', 'a2', 'a3', 'a4'].map((id) => ({ kind: 'agent' as const, id }))
  const [makeFall] = selectionActions(view.scene!, view.current!.frame, picks)
  assert.equal((await client.apply(makeFall!.action.label, makeFall!.action.operations)).ok, true)
  await client.step(1)
  await flush()
  const after = client.getView()
  assert.deepEqual(after.changes.map((change) => change.label), ['4 people fall'])
  assert.ok(['a1', 'a2', 'a3', 'a4'].every((id) => isDown(after.scene!, after.current!.frame, id)))
  assert.equal(isDown(after.scene!, after.current!.frame, 'a5'), false)
})

test('people get a stable mix of hairstyles and outfits', () => {
  const looks = Array.from({ length: 300 }, (_, i) => figureLook(`a${i + 1}`))
  assert.deepEqual(new Set(looks.map((look) => look.hair)), new Set(['short', 'long', 'bun', 'ponytail']))
  const skirts = looks.filter((look) => look.outfit === 'skirt').length
  assert.ok(skirts > 60 && skirts < 140, `about a third wear skirts or dresses (${skirts}/300)`)
  assert.deepEqual(figureLook('a42'), figureLook('a42'), 'the same person always looks the same')
})
