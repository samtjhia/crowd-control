import assert from 'node:assert/strict'
import test from 'node:test'
import type { WasmEngineBindings, WorkerCommand, WorkerMessage } from '@crowd-control/contract'
import { createRealEndpoint, type WorkerPort } from './realEndpoint.ts'
import { commandError, dispatchCommand } from './dispatchCommand.ts'

const pause: WorkerCommand = { schemaVersion: 1, simulationId: 'demo', commandId: 'pause-1', type: 'pause' }
const stamp = { streamId: 'rust-stream-1', tick: 0, time: 0, topologyVersion: 0, sceneVersion: 1, historyRevision: 0 }
const ack: WorkerMessage = { schemaVersion: 1, simulationId: 'demo', type: 'ack', commandId: 'pause-1', stamp }
class Port implements WorkerPort {
  sent: WorkerCommand[] = []
  stopped = false
  onmessage: WorkerPort['onmessage'] = null
  onerror: WorkerPort['onerror'] = null
  onmessageerror: WorkerPort['onmessageerror'] = null
  postMessage(command: WorkerCommand) { this.sent.push(command) }
  terminate() { this.stopped = true }
  emit(data: unknown) { this.onmessage?.(new MessageEvent('message', { data })) }
}
test('real endpoint delivers asynchronously, unsubscribes and disposes its worker', async () => {
  const port = new Port(), endpoint = createRealEndpoint({ worker: port }), received: WorkerMessage[] = []
  const unsubscribe = endpoint.subscribe((m) => received.push(m))
  endpoint.send(pause); assert.deepEqual(port.sent, [pause])
  port.emit(ack); assert.equal(received.length, 0)
  await Promise.resolve(); assert.deepEqual(received, [ack])
  unsubscribe(); port.emit(ack); await Promise.resolve(); assert.equal(received.length, 1)
  endpoint.dispose(); assert.equal(port.stopped, true); assert.equal(port.onmessage, null)
  assert.throws(() => endpoint.send(pause), /disposed/)
})
test('malformed commands stay out of the worker and bad responses fail pending commands', async () => {
  const port = new Port(), endpoint = createRealEndpoint({ worker: port }), received: WorkerMessage[] = []
  endpoint.subscribe((m) => received.push(m))
  endpoint.send({ ...pause, schemaVersion: 2 } as unknown as WorkerCommand)
  await Promise.resolve(); assert.equal(port.sent.length, 0); assert.equal(received[0].type, 'error')
  endpoint.send(pause); port.emit({ surprise: true }); await Promise.resolve()
  const error = received.at(-1)!; assert.equal(error.type, 'error')
  if (error.type === 'error') assert.equal(error.commandId, 'pause-1')
  assert.equal(port.stopped, true); endpoint.dispose()
})
test('worker failure reports errors and disposal cancels queued notifications', async () => {
  const port = new Port(), endpoint = createRealEndpoint({ worker: port }), received: WorkerMessage[] = []
  endpoint.subscribe((m) => received.push(m)); endpoint.send(pause)
  port.onerror?.({ message: 'Failed to load Wasm' } as ErrorEvent)
  await Promise.resolve(); assert.equal(received[0].type, 'error')
  endpoint.send(pause); endpoint.dispose(); await Promise.resolve(); assert.equal(received.length, 1)
})
test('dispatch boundary validates both directions and preserves response order', () => {
  let calls = 0
  const bindings: WasmEngineBindings = { abi_version: () => 1, engine_version: () => 'static-engine-v1', create_engine: () => 1, destroy_engine() {}, dispatch(_handle, json) { calls++; assert.deepEqual(JSON.parse(json), pause); return JSON.stringify([ack]) } }
  assert.deepEqual(dispatchCommand(bindings, 1, pause), [ack])
  const rejected = dispatchCommand(bindings, 1, { ...pause, foo: 1 }); assert.equal(rejected[0].type, 'error'); assert.equal(calls, 1)
  bindings.dispatch = () => JSON.stringify([{ ...ack, simulationId: 'wrong' }])
  assert.throws(() => dispatchCommand(bindings, 1, pause), /simulationId/)
  bindings.dispatch = () => JSON.stringify([{ ...ack, commandId: 'wrong' }])
  assert.throws(() => dispatchCommand(bindings, 1, pause), /commandId/)
})

test('error correlation never invokes invalid input accessors or echoes invalid IDs', () => {
  const input = Object.defineProperty({ commandId: '__proto__' }, 'simulationId', { get() { throw new Error('accessor ran') } })
  assert.deepEqual(commandError(input, { code: 'INVALID_SCHEMA', message: 'bad input' }), { schemaVersion: 1, simulationId: 'unknown', type: 'error', error: { code: 'INVALID_SCHEMA', message: 'bad input' } })
})
test('unused endpoints do not construct workers during discarded React renders', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
  let constructions = 0
  const ports: Port[] = []
  class BrowserPort extends Port { constructor() { super(); constructions++; ports.push(this) } }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: BrowserPort })
  try {
    const unused = createRealEndpoint(); unused.dispose()
    assert.equal(constructions, 0)
    const active = createRealEndpoint(); active.send(pause); active.send({ ...pause, commandId: 'second' })
    assert.equal(constructions, 1); assert.equal(ports[0]!.sent.length, 2)
    active.dispose(); assert.equal(ports[0]!.stopped, true)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'Worker', previous)
    else Reflect.deleteProperty(globalThis, 'Worker')
  }
})

test('validation timing observes responses without accepting malformed messages', async () => {
  const port = new Port(), durations: number[] = []
  const endpoint = createRealEndpoint({ worker: port, onValidationTime: (ms) => durations.push(ms) })
  const messages: WorkerMessage[] = []
  endpoint.subscribe((m) => messages.push(m))
  endpoint.send(pause)
  port.emit(ack)
  port.emit({ schemaVersion: 1, type: 'frame' })
  await Promise.resolve()
  assert.equal(durations.length, 2)
  assert.ok(durations.every((ms) => Number.isFinite(ms) && ms >= 0))
  assert.ok(messages.some((m) => m.type === 'error'))
  assert.equal(port.stopped, true)
  endpoint.dispose()
})
