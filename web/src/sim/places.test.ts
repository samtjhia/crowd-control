import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { CompileOutput, Frame, RenderScene, ScenarioPlan, WorkerMessage } from '@crowd-control/contract'
import { pickAt } from '../render/hitTest.ts'
import { layoutMap } from '../render/mapLayout.ts'
import { MockSimulation } from '../worker/mock/simulation.ts'
import { pinGoalTargets, placesNote } from './assistant.ts'
import { placeDanger } from './mapActions.ts'
import { placeFacts, placeReasons, placesInScene, placeUsage } from './places.ts'
import { scenarios, startScenario, venueOptions } from './scenario.ts'

const fixture = <T>(name: string) => JSON.parse(readFileSync(new URL(`../../../contract/fixtures/${name}.json`, import.meta.url), 'utf8')) as T
const demos = scenarios(fixture<ScenarioPlan>('scenario-plan'), fixture<CompileOutput>('compile-output').resolvedModel)

function compiled(id: string) {
  const demo = demos.find((s) => s.id === id)!
  const result = startScenario(demo.plan, demo.model)
  assert.ok(result.ok, JSON.stringify(result))
  return { demo, output: result.value }
}

/** Loads a demo into the mock and returns a way to run it and read the latest frame and scene. */
function run(id: string) {
  const { demo, output } = compiled(id)
  const head = { schemaVersion: 1 as const, simulationId: output.scene.simulationId }
  const sim = new MockSimulation()
  let n = 0
  let scene: RenderScene | null = null
  let frame: Frame | null = null
  const send = (body: object) => {
    const messages = sim.handle({ ...head, commandId: `c${++n}`, ...body } as never) as WorkerMessage[]
    for (const m of messages) {
      if (m.type === 'scene') scene = m.scene
      if (m.type === 'frame') frame = m.frame
    }
    return messages
  }
  send({ type: 'load', compiled: output, history: { historyRevision: 0, records: [], outcomes: [] } })
  return {
    demo, head, send,
    at: (time: number) => { send({ type: 'run_to', time }); return { scene: scene!, frame: frame! } },
  }
}

test('venue objects are on the compiled map, marked with badges, and clickable', () => {
  const { output } = compiled('hackathon-hall')
  const objects = output.scene.map.entities ?? []
  assert.equal(objects.filter((e) => e.kind === 'object').length, 25, '24 tables and the snack table')
  const layout = layoutMap(output.scene.map)
  assert.ok(layout.badges.some((b) => b.id === 'snacks' && b.kind === 'service'))
  assert.ok(layout.badges.some((b) => b.id === 'checkin_a'), 'check-in desks take time, so they are marked too')
  const scene: RenderScene = { map: output.scene.map, entities: [], agents: [] }
  assert.deepEqual(pickAt(scene, null, new Map(), { x: 32, y: 29 }, 0.1, ['object', 'zone']), { kind: 'object', id: 'snacks' })
  assert.deepEqual(pickAt(scene, null, new Map(), { x: 32, y: 29 }, 0.1, ['zone']), null, 'without the object kind, a table is just not floor')
})

test('a point of interest says what it is, who is using it, and why people go there', () => {
  const sim = run('hackathon-hall')
  const { scene, frame } = sim.at(40)
  assert.deepEqual(placeFacts(scene, 'snacks'), { kind: 'Used by people', facts: [['At once', '3 people'], ['Each visit', '8 s']] })
  assert.deepEqual(placeFacts(scene, 'checkin_a')?.facts, [['Each person', '4 s to get through']])
  const usage = placeUsage(scene, frame, 'snacks')
  assert.ok(usage.using >= 1 && usage.using <= 3, `at most three use the snack table at once (${usage.using})`)
  assert.ok(usage.waiting >= 1, 'others wait their turn beside it')
  const reasons = placeReasons(scene, sim.demo.plan, [], 'table_3')
  assert.ok(reasons.some((r) => /^People tagged seated: go to the nearest table, then wait 300 s\.$/.test(r)), reasons.join(' | '))
  assert.ok(reasons.some((r) => /^People tagged arrival: go to Hacking hall, then go to the nearest table/.test(r)), reasons.join(' | '))
  assert.deepEqual(placeReasons(scene, sim.demo.plan, [], 'snacks'), ['People tagged hungry: use Snack table, then wander in Hacking hall (3 times).'])
})

test('the mock serves a counter a few at a time, then people move on', () => {
  const sim = run('concert-floor')
  const busy = sim.at(10)
  const atBar = (frame: Frame) => frame.agents.filter((a) => a.state === 'interacting').length
  assert.equal(atBar(busy.frame), 4, 'four served at the bar counter at once')
  assert.ok(busy.frame.agents.some((a) => a.state === 'queueing'), 'the rest of the bar crowd waits its turn')
  assert.equal(placeUsage(busy.scene, busy.frame, 'bar_counter').using, 4)
})

test('a danger dropped on the map is added, and people nearby keep their distance', () => {
  const sim = run('concert-floor')
  const before = sim.at(5)
  const at = { x: 20, y: 20 }
  const action = placeDanger(before.scene, before.frame, at)
  assert.equal(action.operations[0]?.op, 'add')
  const avoid = action.operations[1]
  assert.ok(avoid?.op === 'assign_goal' && 'ids' in avoid.targets && avoid.targets.ids!.length > 0, 'people within 12 m react')
  const reply = sim.send({ type: 'apply_request', request: { ...sim.head, requestId: 'danger', operations: action.operations } })
  assert.ok(reply.some((m) => m.type === 'ack'), JSON.stringify(reply.find((m) => m.type === 'error')))
  const after = sim.at(20)
  assert.ok(after.scene.map.entities?.some((e) => e.id === 'danger_1' && e.tags?.includes('hazard')), 'the danger is on the map')
  const reacting = new Set(avoid.op === 'assign_goal' && 'ids' in avoid.targets ? avoid.targets.ids : [])
  const close = after.frame.agents.filter((a) => reacting.has(a.id) && Math.hypot(a.x - at.x, a.y - at.y) < 6 + 1.5 - 0.3)
  assert.equal(close.length, 0, 'everyone who noticed it is now at least 6 m from its edge')
  assert.deepEqual(placeFacts(after.scene, 'danger_1')?.kind, 'Danger')
  const change = { interventionId: 'i1', label: action.label, at: 5, operations: action.operations }
  assert.deepEqual(placeReasons(after.scene, sim.demo.plan, [change], 'danger_1'), ['Placed during the run, at 5 s.', `${reacting.size} people: keep away from Danger 1.`])
  const next = placeDanger(after.scene, after.frame, at).operations[0]
  assert.equal(next?.op === 'add' ? next.entity.id : null, 'danger_2', 'the next danger gets a new ID')
})

test('the assistant is told what each place does, grouped, and single-target goals stay single', () => {
  const hackathon = venueOptions().find((v) => v.id === 'hackathon-hall')!
  const note = placesNote(hackathon.places)
  assert.match(note, /- Table \(24 of them, table_1 … table_24\): 6 at a time, 2 min each/)
  assert.match(note, /use reach \{"tags":\["table"\]\} with "selection":"nearest" and then a wait/)
  assert.match(note, /- Snack table \(snacks\): 3 at a time, 8 s each/)
  assert.match(note, /- Check-in desk A \(checkin_a\): a check-in point: a door from lobby to hall that takes 4 s per person/)
  assert.ok(hackathon.inventory.some((item) => item.id === 'snacks' && item.kind === 'object' && item.componentNames.includes('interaction')))

  const head = { schemaVersion: 1 as const, simulationId: 's', requestId: 'r' }
  const pinned = pinGoalTargets({ ...head, operations: [
    { op: 'assign_goal', targets: { tags: ['hungry'] }, goal: { kind: 'interact', target: { tags: ['snacks'] } } },
    { op: 'assign_goal', targets: { tags: ['seated'] }, goal: { kind: 'interact', target: { tags: ['table'] } } },
  ] }, hackathon.inventory).operations
  const target = (i: number) => { const o = pinned[i]!; return o.op === 'assign_goal' && o.goal.kind === 'interact' ? o.goal.target : null }
  assert.deepEqual(target(0), { ids: ['snacks'] }, 'one match is pinned to its ID')
  assert.deepEqual(target(1), { tags: ['table'] }, 'interact needs one target, so 24 tables are left for the simulator to refuse')

  const { output } = compiled('concert-floor')
  assert.match(placesNote(placesInScene({ map: output.scene.map, entities: [], agents: [] })), /Bar counter \(bar_counter\): 4 at a time, 15 s each/)
})
