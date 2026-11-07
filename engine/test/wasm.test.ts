import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parseSnapshot, parseWorkerMessage, parseWorkerCommand, type EngineSnapshot, type WasmEngineBindings, type WorkerMessage } from '@crowd-control/contract'
import { instantiateEngine, ENGINE_VERSION } from '../../web/src/worker/wasmBindings.ts'
import { createEngineHost } from '../../web/src/worker/engineHost.ts'

async function engine() {
  return instantiateEngine(new Uint8Array(readFileSync(new URL('../../web/public/engine/crowd_control_engine.wasm', import.meta.url))))
}
function state(bindings: WasmEngineBindings, handle: number): EngineSnapshot {
  const messages: WorkerMessage[] = JSON.parse(bindings.dispatch(handle, JSON.stringify({ schemaVersion: 1, simulationId: 'engine-demo', commandId: 'inspect', type: 'snapshot', snapshotId: 'wasm-state' })))
  const message = messages.find((m) => m.type === 'snapshot')!
  assert.equal(message.type, 'snapshot')
  if (message.type !== 'snapshot') throw new Error('Missing snapshot')
  const parsed = parseSnapshot(message.snapshot)
  assert.equal(parsed.ok, true, JSON.stringify(parsed))
  return message.snapshot
}

test('actual Wasm module loads, publishes typed messages, resets and releases handles', async () => {
  const bytes = readFileSync(new URL('../../web/public/engine/crowd_control_engine.wasm', import.meta.url))
  const bindings = await instantiateEngine(new Uint8Array(bytes))
  assert.equal(bindings.abi_version(), 1)
  assert.equal(bindings.engine_version(), ENGINE_VERSION)
  const handle = bindings.create_engine()
  const command = readFileSync(new URL('../../contract/fixtures/engine-static-load.json', import.meta.url), 'utf8')
  const messages = JSON.parse(bindings.dispatch(handle, command))
  for (const message of messages) assert.equal(parseWorkerMessage(message).ok, true)
  assert.deepEqual(messages.map((m: { type: string }) => m.type), ['ack', 'scene', 'frame'])
  assert.equal(messages[2].frame.agents[0].x, 1.5)
  const reset = JSON.parse(bindings.dispatch(handle, JSON.stringify({ schemaVersion: 1, simulationId: 'engine-demo', commandId: 'reset', type: 'reset' })))
  assert.notEqual(reset[2].frame.streamId, messages[2].frame.streamId)
  bindings.destroy_engine(handle)
  assert.throws(() => bindings.dispatch(handle, command), /destroyed/)
  const next = bindings.create_engine(); assert.notEqual(next, handle); bindings.destroy_engine(next)
})

test('actual Wasm snapshots expose full agents and match native Rust across clock commands', async () => {
  const bindings = await engine(), handle = bindings.create_engine()
  const initial = JSON.parse(readFileSync(new URL('../../contract/fixtures/engine-grid-load.json', import.meta.url), 'utf8'))
  const header = { schemaVersion: 1, simulationId: 'engine-demo' }
  const commands = [initial,
    { ...header, commandId: 'snapshot-0', type: 'snapshot', snapshotId: 'state-0' },
    { ...header, commandId: 'step', type: 'step', ticks: 17 },
    { ...header, commandId: 'speed', type: 'speed', multiplier: 4 },
    { ...header, commandId: 'resume', type: 'resume' },
    { ...header, commandId: 'pause', type: 'pause' },
    { ...header, commandId: 'forward', type: 'run_to', time: 1.4 },
    { ...header, commandId: 'snapshot-1', type: 'snapshot', snapshotId: 'state-1' },
    { ...header, commandId: 'reset', type: 'reset' },
    { ...header, commandId: 'snapshot-2', type: 'snapshot', snapshotId: 'state-2' },
  ]
  const wasm = commands.map((command) => JSON.parse(bindings.dispatch(handle, JSON.stringify(command))))
  for (const messages of wasm) for (const message of messages) assert.equal(parseWorkerMessage(message).ok, true)
  const executable = fileURLToPath(new URL(`../../target/debug/examples/protocol${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url))
  const native = execFileSync(executable, { input: commands.map((value) => JSON.stringify(value)).join('\n') + '\n', encoding: 'utf8' }).trim().split('\n').map((line) => JSON.parse(line))
  assert.deepEqual(wasm, native)
  const final = state(bindings, handle)
  assert.equal(final.tick, 0)
  assert.deepEqual(final.agents.map((a) => a.position), [{ x: 1.5, y: 1.5 }, { x: 2.5, y: 1.5 }])
  bindings.destroy_engine(handle)
})

test('real Wasm plus worker host retains tick debt and applies pause/speed with a manual wall clock', async () => {
  const bindings = await engine()
  let callback: (() => void) | undefined
  let now = 0
  const messages: WorkerMessage[] = []
  const host = createEngineHost(bindings, (message) => { assert.equal(parseWorkerMessage(message).ok, true); messages.push(message) }, { now: () => now, every(_ms, loop) { callback = loop; return () => { callback = undefined } } })
  host.send(JSON.parse(readFileSync(new URL('../../contract/fixtures/engine-static-load.json', import.meta.url), 'utf8')))
  host.send({ schemaVersion: 1, simulationId: 'engine-demo', commandId: 'speed', type: 'speed', multiplier: 4 })
  host.send({ schemaVersion: 1, simulationId: 'engine-demo', commandId: 'resume', type: 'resume' })
  now += 1000; callback?.()
  const frame = () => messages.filter((m) => m.type === 'frame').at(-1)!
  assert.equal(frame().frame.tick, 80); assert.equal(frame().frame.time, 4)
  now += 10_000; callback?.(); assert.equal(frame().frame.tick, 480)
  callback?.(); assert.equal(frame().frame.tick, 880, 'The remaining 400 ticks were retained')
  host.send({ schemaVersion: 1, simulationId: 'engine-demo', commandId: 'pause', type: 'pause' })
  assert.equal(callback, undefined)
  host.send({ schemaVersion: 1, simulationId: 'engine-demo', commandId: 'inspect', type: 'snapshot', snapshotId: 'paced' })
  const snapshot = messages.find((m) => m.type === 'snapshot')!
  if (snapshot.type === 'snapshot') assert.equal(snapshot.snapshot.agents[0].position.x, 1.5)
  assert.equal(messages.some((m) => m.type === 'error'), false)
  host.dispose()
})

test('actual Wasm navigation, topology interventions and history match native Rust', async () => {
  const bindings = await engine(), handle = bindings.create_engine()
  const initial = JSON.parse(readFileSync(new URL('../../contract/fixtures/engine-navigation-load.json', import.meta.url), 'utf8'))
  const header = { schemaVersion: 1, simulationId: 'engine-demo' }
  const change = (requestId: string, open: boolean) => ({ ...header, commandId: requestId, type: 'apply_request', request: { ...header, requestId, action: 'create_intervention', label: 'Door change', operations: [{ op: 'set', targets: { ids: ['door'] }, values: { components: { portal: { open } } } }] } })
  const commands = [initial,
    { ...header, commandId: 'move', type: 'step', ticks: 10 },
    change('close', false),
    { ...header, commandId: 'blocked', type: 'step', ticks: 20 },
    { ...header, commandId: 'blocked-state', type: 'snapshot', snapshotId: 'blocked' },
    change('open', true),
    { ...header, commandId: 'move-again', type: 'step', ticks: 50 },
    change('occupied', false),
    { ...header, commandId: 'finish', type: 'step', ticks: 50 },
    change('close', false),
    change('occupied', false),
    { ...header, commandId: 'history', type: 'query', query: { kind: 'history' } },
    { ...header, commandId: 'final', type: 'snapshot', snapshotId: 'complete' },
  ]
  for (const command of commands) assert.equal(parseWorkerCommand(command).ok, true, JSON.stringify(command))
  const wasm = commands.map((command) => JSON.parse(bindings.dispatch(handle, JSON.stringify(command))))
  for (const messages of wasm) for (const message of messages) {
    const result = parseWorkerMessage(message)
    assert.equal(result.ok, true, JSON.stringify(result))
  }
  const executable = fileURLToPath(new URL(`../../target/debug/examples/protocol${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url))
  const native = execFileSync(executable, { input: commands.map((c) => JSON.stringify(c)).join('\n') + '\n', encoding: 'utf8' }).trim().split('\n').map((line) => JSON.parse(line))
  assert.deepEqual(wasm, native)
  assert.equal(wasm[4][0].snapshot.agents[0].state, 'blocked')
  assert.equal(wasm[7][0].error.code, 'NO_WALKABLE_SPACE')
  const final = state(bindings, handle)
  assert.equal(final.agents[0]!.currentGoal!.status, 'completed')
  assert.equal(final.topologyVersion, 2)
  assert.equal(final.historyRevision, 2)
  bindings.destroy_engine(handle)
})
