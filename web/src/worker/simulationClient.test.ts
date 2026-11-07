import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { CompileOutput, Frame, RenderScene, WorkerCommand, WorkerEndpoint, WorkerMessage } from '@crowd-control/contract'
import { createMockEndpoint } from './mockEndpoint.ts'
import { SimulationClient } from './simulationClient.ts'

const compiled = JSON.parse(readFileSync(new URL('../../../contract/fixtures/compile-output.json', import.meta.url), 'utf8')) as CompileOutput
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const idleClock = { now: () => 0, every: () => () => {} }

/** A hand-driven endpoint for exercising stale-message rules directly. */
function scriptedEndpoint() {
  const listeners = new Set<(message: WorkerMessage) => void>()
  const sent: WorkerCommand[] = []
  const endpoint: WorkerEndpoint = {
    kind: 'mock',
    send: (command) => { sent.push(command) },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  return { endpoint, sent, emit: (message: WorkerMessage) => { for (const l of listeners) l(message) } }
}
const header = { schemaVersion: 1, simulationId: 'worked-demo' } as const
const stamp = (streamId: string, tick: number, sceneVersion = 1, historyRevision = 0) => ({ streamId, tick, time: tick / 10, topologyVersion: 0, sceneVersion, historyRevision })
const sceneMessage = (streamId: string, sceneVersion = 1): WorkerMessage => ({
  ...header, type: 'scene', stamp: stamp(streamId, 0, sceneVersion), scene: { map: compiled.scene.map, entities: [], agents: [] } satisfies RenderScene,
})
const frameMessage = (streamId: string, tick: number, sceneVersion = 1, historyRevision = 0): WorkerMessage => ({
  ...header, type: 'frame', frame: { ...stamp(streamId, tick, sceneVersion, historyRevision), agents: [] } satisfies Frame,
})

test('load, play state and speed follow worker acknowledgements', async () => {
  const endpoint = createMockEndpoint({ clock: idleClock })
  const client = new SimulationClient(endpoint)
  const ack = await client.load(compiled)
  assert.equal(ack.type, 'ack')
  await flush()
  const view = client.getView()
  assert.ok(view.scene && view.current && view.metrics)
  assert.equal(view.current.frame.agents.length, 8)
  assert.equal(view.endpointKind, 'mock')

  await client.setSpeed(4)
  await client.play()
  assert.deepEqual([client.getView().speed, client.getView().playing], [4, true])
  await client.pause()
  assert.equal(client.getView().playing, false)
  const stepped = await client.step(3)
  assert.equal(stepped.type, 'ack')
  await flush()
  assert.equal(client.getView().current?.frame.tick, 3)
  client.dispose()
  endpoint.dispose()
})

test('reset retires the old stream so its late frames are ignored', async () => {
  const endpoint = createMockEndpoint({ clock: idleClock })
  const client = new SimulationClient(endpoint)
  await client.load(compiled)
  await client.step(10)
  await flush()
  const oldStream = client.getView().streamId!
  await client.reset()
  await flush()
  assert.notEqual(client.getView().streamId, oldStream)
  assert.equal(client.getView().current?.frame.tick, 0)
  client.dispose()
  endpoint.dispose()
})

test('frames wait for their scene, and stale streams or history revisions are dropped', () => {
  const { endpoint, emit } = scriptedEndpoint()
  const client = new SimulationClient(endpoint, () => 0)
  void client.load(compiled)

  emit(frameMessage('s1', 1))
  assert.equal(client.getView().current, null, 'frame held until its scene arrives')
  emit(sceneMessage('s1'))
  assert.equal(client.getView().current?.frame.tick, 1, 'held frame released by the matching scene')

  emit(frameMessage('s1', 2, 2))
  assert.equal(client.getView().current?.frame.tick, 1, 'frame referencing a newer scene version waits')
  emit(sceneMessage('s1', 2))
  assert.equal(client.getView().current?.frame.tick, 2)

  emit(sceneMessage('s2'))
  assert.equal(client.getView().current, null, 'new stream clears the old picture')
  emit(frameMessage('s1', 3, 2))
  assert.equal(client.getView().current, null, 'retired stream frames are ignored')
  emit(frameMessage('s2', 5, 1, 2))
  emit(frameMessage('s2', 6, 1, 1))
  assert.equal(client.getView().current?.frame.tick, 5, 'superseded history revision ignored')
  client.dispose()
})

test('reset after changes shows the fresh run instead of waiting forever', async () => {
  const client = new SimulationClient(createMockEndpoint({ clock: idleClock }))
  await client.load(compiled)
  await flush()
  for (const id of ['a1', 'a2', 'a3']) {
    const applied = await client.apply(`${id} falls`, [{ op: 'set', targets: { ids: [id] }, values: { components: { mobility: { speedMultiplier: 0 } } } }])
    assert.equal(applied.ok, true)
  }
  await client.step(5)
  await flush()
  assert.equal(client.getView().historyRevision, 3)

  await client.reset()
  await flush()
  const view = client.getView()
  assert.ok(view.current, 'the reset run has a frame (the bug left this null: "Loading the venue…")')
  assert.equal(view.current.frame.tick, 0)
  assert.equal(view.historyRevision, 0)
  await client.step(2)
  await flush()
  assert.equal(client.getView().current?.frame.tick, 2, 'and it keeps playing')
})
test('metrics retain throttled density and reject stale streams, revisions, scenes and ticks', () => {
  const { endpoint, emit } = scriptedEndpoint(), client = new SimulationClient(endpoint)
  void client.load(compiled)
  emit(sceneMessage('live')); emit(frameMessage('live', 10))
  const sample = { time: 1, present: 1, departed: 0, blocked: 0, immobile: 0, removed: 0, zones: [], portals: [], queues: [], clearance: { t50: null, t90: null, t100: null } }
  const density = { width: 1, height: 1, cellSize: 1, origin: { x: 0, y: 0 }, units: 'people/model-unit2' as const, values: [1] }
  const first = { ...header, type: 'metrics' as const, stamp: stamp('live', 10), sample, density }
  emit(first); assert.deepEqual(client.getView().density, density)
  emit(frameMessage('live', 11))
  emit({ ...first, stamp: stamp('live', 11), sample: { ...sample, time: 1.1 }, density: undefined })
  assert.deepEqual(client.getView().density, density)
  const before = client.getView()
  for (const stale of [stamp('old', 12), stamp('live', 12, 0), stamp('live', 12, 1, 99), stamp('live', 9)]) {
    emit({ ...first, stamp: stale, sample: { ...sample, present: 99 } })
  }
  assert.equal(client.getView(), before)
  emit(sceneMessage('live', 0)); assert.equal(client.getView(), before)
  emit(sceneMessage('live', 2)); assert.equal(client.getView().density, null)
  emit({ ...first, stamp: stamp('live', 12) }); assert.equal(client.getView().metrics, null)
  client.dispose()
})

test('view ownership survives StrictMode remount and terminates the worker on final unmount', async () => {
  let stopped = 0, detached = 0
  const client = new SimulationClient({ kind: 'real', send() {}, subscribe() { return () => { detached++ } }, dispose() { stopped++ } })
  const first = client.retain()
  first()
  const remounted = client.retain()
  await Promise.resolve()
  assert.equal(stopped, 0)
  remounted(); remounted()
  await Promise.resolve()
  assert.equal(stopped, 1)
  assert.equal(detached, 1)
  client.dispose()
  assert.equal(stopped, 1)
  assert.throws(() => client.retain(), /disposed/)
})

test('disposing a client settles outstanding requests and disposes its endpoint', async () => {
  let stopped = false
  const client = new SimulationClient({ kind: 'real', send() {}, subscribe() { return () => {} }, dispose() { stopped = true } })
  const load = client.load(compiled)
  client.dispose()
  assert.equal((await load).type, 'error')
  assert.equal(stopped, true)
  await assert.rejects(client.pause(), /disposed/)
})

test('many worker publications produce one view notification per paint without delaying acknowledgements', async () => {
  const { endpoint, emit, sent } = scriptedEndpoint()
  const paints: Array<() => void> = []
  let cancelled = 0, notifications = 0
  const client = new SimulationClient(endpoint, () => 10, (paint) => { paints.push(paint); return () => { cancelled++ } })
  client.subscribe(() => { notifications++ })
  const loading = client.load(compiled)
  emit({ ...header, type: 'ack', commandId: sent[0]!.commandId, stamp: stamp('live', 0) })
  assert.equal((await loading).type, 'ack', 'acknowledgements do not wait for a paint')
  emit(sceneMessage('live'))
  for (let tick = 0; tick < 100; tick++) emit(frameMessage('live', tick))
  assert.equal(client.getView().current!.frame.tick, 99, 'the renderer can read the latest state immediately')
  assert.equal(client.getView().previous!.frame.tick, 98)
  assert.equal(notifications, 0)
  assert.equal(paints.length, 1)
  paints.shift()!()
  assert.equal(notifications, 1)
  emit(frameMessage('live', 100))
  assert.equal(paints.length, 1)
  client.dispose()
  assert.equal(cancelled, 1)
  paints.shift()!()
  assert.equal(notifications, 1, 'unmounted views receive no late paint notification')
})
