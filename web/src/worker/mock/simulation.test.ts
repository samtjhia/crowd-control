import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parseWorkerMessage, type CompileOutput, type FollowupRequest, type Frame, type WorkerCommand, type WorkerMessage } from '@crowd-control/contract'
import { MockSimulation } from './simulation.ts'

const compiled = JSON.parse(readFileSync(new URL('../../../../contract/fixtures/compile-output.json', import.meta.url), 'utf8')) as CompileOutput
const header = { schemaVersion: 1, simulationId: 'worked-demo' } as const
let commandCount = 0

type CommandBody = WorkerCommand extends infer C ? (C extends WorkerCommand ? Omit<C, 'schemaVersion' | 'simulationId' | 'commandId'> : never) : never

/** Sends a command and asserts every resulting message passes the strict contract. */
function send(sim: MockSimulation, body: CommandBody): WorkerMessage[] {
  const messages = sim.handle({ ...header, commandId: `c${++commandCount}`, ...body } as WorkerCommand)
  for (const message of messages) {
    const parsed = parseWorkerMessage(message)
    assert.equal(parsed.ok, true, `Invalid ${message.type} message: ${JSON.stringify(parsed)}`)
  }
  return messages
}
const ofType = <T extends WorkerMessage['type']>(messages: WorkerMessage[], type: T) =>
  messages.filter((m): m is Extract<WorkerMessage, { type: T }> => m.type === type)
const lastFrame = (messages: WorkerMessage[]): Frame => {
  const frame = ofType(messages, 'frame').at(-1)
  assert.ok(frame, 'expected a frame')
  return frame.frame
}
const agentIn = (frame: Frame, id: string) => {
  const agent = frame.agents.find((a) => a.id === id)
  assert.ok(agent, `missing agent ${id}`)
  return agent
}
type CreateRequest = Extract<FollowupRequest, { operations: unknown }>
const request = (requestId: string, operations: CreateRequest['operations']): CreateRequest => ({ ...header, requestId, operations })
const fall = (id: string, multiplier: number) => request(`fall-${id}-${multiplier}`, [{
  op: 'set', targets: { ids: [id] },
  values: { components: { mobility: { speedMultiplier: multiplier } }, appearance: { pose: multiplier === 0 ? 'fallen' : 'upright' } },
}])
function loaded() {
  const sim = new MockSimulation()
  const messages = send(sim, { type: 'load', compiled, history: { historyRevision: 0, records: [], outcomes: [] } })
  return { sim, messages }
}

test('load emits ack, scene, frame and metrics that match the fixture', () => {
  const { messages } = loaded()
  assert.deepEqual(messages.map((m) => m.type), ['ack', 'scene', 'frame', 'metrics'])
  const frame = lastFrame(messages)
  assert.equal(frame.tick, 0)
  assert.equal(frame.agents.length, 8)
  assert.deepEqual({ x: agentIn(frame, 'a1').x, y: agentIn(frame, 'a1').y }, { x: 1.5, y: 1.5 })
  assert.equal(agentIn(frame, 'a1').controller, 'mingle')
  const scene = ofType(messages, 'scene')[0]!.scene
  assert.deepEqual(scene.agents[0], { id: 'a1', radius: 0.5, appearance: { stroke: '#0F172A', strokeWidthPx: 1, opacity: 1, symbol: 'triangle', fill: '#2563EB' } })
  const metrics = ofType(messages, 'metrics')[0]!
  assert.equal(metrics.density?.units, 'people/model-unit2')
  assert.equal(metrics.sample.zones.find((z) => z.zoneId === 'hall')?.occupancy, 8)
})

test('stepping moves wanderers deterministically', () => {
  const a = loaded().sim, b = loaded().sim
  const fa = lastFrame(send(a, { type: 'step', ticks: 25 }))
  const fb = lastFrame(send(b, { type: 'step', ticks: 25 }))
  assert.equal(fa.tick, 25)
  assert.equal(fa.time, 2.5)
  assert.deepEqual(fa.agents, fb.agents)
  assert.notDeepEqual({ x: agentIn(fa, 'a1').x, y: agentIn(fa, 'a1').y }, { x: 1.5, y: 1.5 })
  assert.ok(fa.agents.every((agent) => agent.state === 'moving'))
})

test('scheduled late arrivals spawn in the foyer and the alarm reaches them too', () => {
  const { sim } = loaded()
  const at10 = send(sim, { type: 'run_to', time: 10 })
  const frame = lastFrame(at10)
  assert.equal(frame.agents.length, 10)
  const a9 = agentIn(frame, 'a9')
  assert.ok(Math.hypot(a9.x - 12.5, a9.y - 1.5) <= 0.1 + 1e-9, 'a9 spawns at the first free foyer slot')
  assert.equal(a9.controller, 'enter_then_mingle')
  const scene = ofType(at10, 'scene').at(-1)!.scene
  assert.equal(scene.agents.find((a) => a.id === 'a10')?.appearance.symbol, 'square')

  const at30 = send(sim, { type: 'run_to', time: 30 })
  assert.ok(ofType(at30, 'events').some((m) => m.events.some((e) => e.name === 'alarm')))
  assert.ok(lastFrame(at30).agents.every((agent) => agent.controller === 'leave'), 'rule selector is resolved at fire time, including a9/a10')

  const at60 = send(sim, { type: 'run_to', time: 60 })
  assert.ok(lastFrame(at60).agents.every((agent) => agent.state === 'departed'))
  assert.equal(ofType(at60, 'metrics').at(-1)!.sample.departed, 10)
})

test('a fall anchors the agent until recovery, through the same request path as chat and clicks', () => {
  const { sim } = loaded()
  send(sim, { type: 'step', ticks: 5 })
  const fallen = send(sim, { type: 'apply_request', request: fall('a1', 0) })
  const ack = ofType(fallen, 'ack')[0]!
  assert.equal(ack.applied?.historyRevision, 1)
  assert.equal(agentIn(lastFrame(fallen), 'a1').state, 'immobile')
  assert.equal(ofType(fallen, 'scene')[0]!.scene.agents.find((a) => a.id === 'a1')?.appearance.pose, 'fallen')
  assert.ok(ofType(fallen, 'events')[0]!.events.some((e) => e.name === 'fall' && e.source === 'a1'))

  const before = agentIn(lastFrame(fallen), 'a1')
  const later = agentIn(lastFrame(send(sim, { type: 'step', ticks: 20 })), 'a1')
  assert.deepEqual({ x: later.x, y: later.y, state: later.state }, { x: before.x, y: before.y, state: 'immobile' })
  assert.equal(ofType(send(sim, { type: 'step', ticks: 1 }), 'metrics')[0]!.sample.immobile, 1)

  send(sim, { type: 'apply_request', request: fall('a1', 1) })
  const moved = agentIn(lastFrame(send(sim, { type: 'step', ticks: 5 })), 'a1')
  assert.equal(moved.state, 'moving')
  assert.notDeepEqual({ x: moved.x, y: moved.y }, { x: before.x, y: before.y })
})

test('closing a door bumps topology and scene versions and updates the scene map', () => {
  const { sim } = loaded()
  const closed = send(sim, { type: 'apply_request', request: request('close', [{ op: 'set', targets: { ids: ['hall_door'] }, values: { components: { portal: { open: false } } } }]) })
  const scene = ofType(closed, 'scene')[0]!
  assert.equal(scene.stamp.sceneVersion, 2)
  assert.equal(scene.stamp.topologyVersion, 1)
  assert.equal(scene.scene.map.portals.find((p) => p.id === 'hall_door')?.open, false)
  assert.ok(ofType(closed, 'events')[0]!.events.some((e) => e.name === 'portal_closed'))
})

test('requests are deduplicated, atomic, and unsupported actions fail explicitly', () => {
  const { sim } = loaded()
  const first = ofType(send(sim, { type: 'apply_request', request: fall('a2', 0) }), 'ack')[0]!.applied
  const retry = ofType(send(sim, { type: 'apply_request', request: fall('a2', 0) }), 'ack')[0]!.applied
  assert.deepEqual(retry, first)

  const reused = send(sim, { type: 'apply_request', request: { ...fall('a3', 0), requestId: 'fall-a2-0' } })
  assert.equal(ofType(reused, 'error')[0]?.error.code, 'INVALID_SCHEMA')

  const partial = send(sim, { type: 'apply_request', request: request('partial', [...fall('a4', 0).operations, { op: 'set', targets: { ids: ['nobody'] }, values: { appearance: { fill: '#000000' } } }]) })
  const error = ofType(partial, 'error')[0]!.error
  assert.deepEqual([error.code, error.operationIndex], ['NOT_FOUND', 1])
  assert.equal(agentIn(lastFrame(send(sim, { type: 'step', ticks: 1 })), 'a4').state, 'moving', 'failed batch rolled back the fall')

  const edit = send(sim, { type: 'apply_request', request: { ...header, requestId: 'undo', action: 'delete_intervention', interventionId: first!.interventionId, expectedRevision: 1 } })
  assert.equal(ofType(edit, 'error')[0]?.error.code, 'UNSUPPORTED_CAPABILITY')

  const contact = send(sim, { type: 'apply_request', request: request('contact', [{
    op: 'define_rule', id: 'crush', when: { kind: 'entity_metric', targets: { kind: 'agent' }, metric: 'contactLoadRatio', comparison: 'gte', value: 1, for: 1 },
    operations: [{ op: 'set', targets: { binding: 'subject' }, values: { components: { mobility: { speedMultiplier: 0 } } } }],
  }]) })
  assert.equal(ofType(contact, 'error')[0]?.error.code, 'UNSUPPORTED_CAPABILITY')

  const unloaded = new MockSimulation()
  assert.equal(ofType(send(unloaded, { type: 'pause' }), 'error')[0]?.error.code, 'NOT_FOUND')
})

test('reset starts a new stream from the initial definition', () => {
  const { sim, messages } = loaded()
  send(sim, { type: 'run_to', time: 12 })
  const reset = send(sim, { type: 'reset' })
  const frame = lastFrame(reset)
  assert.notEqual(frame.streamId, lastFrame(messages).streamId)
  assert.equal(frame.tick, 0)
  assert.deepEqual(frame.agents, lastFrame(messages).agents.map((agent) => ({ ...agent })))
})

test('queries return inventory, metrics and events without mutating state', () => {
  const { sim } = loaded()
  send(sim, { type: 'run_to', time: 11 })
  const tickBefore = lastFrame(send(sim, { type: 'step', ticks: 1 })).tick
  const inventory = ofType(send(sim, { type: 'query', query: { kind: 'inventory' } }), 'query_result')[0]!.result
  assert.ok(inventory.kind === 'inventory' && inventory.items.some((item) => item.id === 'a10'))
  const events = ofType(send(sim, { type: 'query', query: { kind: 'events', names: ['spawned'] } }), 'query_result')[0]!.result
  assert.ok(events.kind === 'events' && events.events.length === 1)
  const metrics = ofType(send(sim, { type: 'query', query: { kind: 'metrics', from: 5, to: 6, zones: ['hall'] } }), 'query_result')[0]!.result
  assert.ok(metrics.kind === 'metrics' && metrics.samples.length > 0 && metrics.samples.every((s) => s.zones.length === 1))
  assert.equal(lastFrame(send(sim, { type: 'step', ticks: 1 })).tick, tickBefore + 1)
})
