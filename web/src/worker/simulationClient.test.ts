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
