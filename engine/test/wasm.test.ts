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
  const commands: unknown[] = [initial,
    { ...header, commandId: 'move', type: 'step', ticks: 10 },
    change('close', false),
    { ...header, commandId: 'blocked', type: 'step', ticks: 20 },
    { ...header, commandId: 'blocked-state', type: 'snapshot', snapshotId: 'blocked' },
    change('open', true),
  ]
  const wasm = commands.map((c) => JSON.parse(bindings.dispatch(handle, JSON.stringify(c))))
  let frame = wasm.at(-1).find((m: WorkerMessage) => m.type === 'frame').frame
  for (let i = 0; i < 160 && frame.agents[0].x < 3.3; i++) {
    const command = { ...header, commandId: `approach-${i}`, type: 'step', ticks: 1 }
    commands.push(command)
    const messages = JSON.parse(bindings.dispatch(handle, JSON.stringify(command)))
    wasm.push(messages); frame = messages.find((m: WorkerMessage) => m.type === 'frame').frame
  }
  assert.ok(frame.agents[0].x >= 3.3 && frame.agents[0].x < 3.8)
  for (const c of [change('occupied', false),
    { ...header, commandId: 'finish', type: 'step', ticks: 160 },
    change('close', false), change('occupied', false),
    { ...header, commandId: 'history', type: 'query', query: { kind: 'history' } },
    { ...header, commandId: 'final', type: 'snapshot', snapshotId: 'complete' },
  ]) { commands.push(c); wasm.push(JSON.parse(bindings.dispatch(handle, JSON.stringify(c)))) }
  for (const c of commands) assert.equal(parseWorkerCommand(c).ok, true)
  for (const messages of wasm) for (const message of messages) assert.equal(parseWorkerMessage(message).ok, true)
  const executable = fileURLToPath(new URL(`../../target/debug/examples/protocol${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url))
  const native = execFileSync(executable, { input: commands.map((c) => JSON.stringify(c)).join('\n') + '\n', encoding: 'utf8' }).trim().split('\n').map((line) => JSON.parse(line))
  assert.deepEqual(wasm, native)
  assert.equal(wasm[4][0].snapshot.agents[0].state, 'blocked')
  assert.equal(wasm.flat().find((m) => m.commandId === 'occupied').error.code, 'NO_WALKABLE_SPACE')
  const final = state(bindings, handle)
  assert.equal(final.agents[0]!.currentGoal!.status, 'completed')
  assert.equal(final.topologyVersion, 2); assert.equal(final.historyRevision, 2)
  bindings.destroy_engine(handle)
})

test('actual Wasm movement, crossing streams, terrain and recovery match native Rust', async () => {
  const bindings = await engine()
  const header = { schemaVersion: 1, simulationId: 'engine-demo' }
  for (const fixture of ['engine-movement-load', 'engine-crossing-load']) {
    const initial = JSON.parse(readFileSync(new URL(`../../contract/fixtures/${fixture}.json`, import.meta.url), 'utf8'))
    const id = initial.compiled.scene.agents[0].id
    const change = (requestId: string, speedMultiplier: number) => ({ ...header, commandId: requestId, type: 'apply_request', request: { ...header, requestId, operations: [{ op: 'set', targets: { ids: [id], kind: 'agent' }, values: { components: { mobility: { speedMultiplier } }, appearance: { pose: speedMultiplier === 0 ? 'fallen' : 'upright' } } }] } })
    const commands = [initial,
      { ...header, commandId: 'move', type: 'step', ticks: 60 },
      change('stop', 0),
      { ...header, commandId: 'held', type: 'step', ticks: 20 },
      { ...header, commandId: 'stopped-state', type: 'snapshot', snapshotId: 'stopped' },
      change('recover', 1),
      { ...header, commandId: 'finish', type: 'step', ticks: 700 },
      { ...header, commandId: 'final', type: 'snapshot', snapshotId: 'complete' },
    ]
    const handle = bindings.create_engine()
    for (const c of commands) assert.equal(parseWorkerCommand(c).ok, true)
    const wasm = commands.map((c) => JSON.parse(bindings.dispatch(handle, JSON.stringify(c))))
    for (const messages of wasm) for (const message of messages) {
      const parsed = parseWorkerMessage(message)
      assert.equal(parsed.ok, true, JSON.stringify(parsed))
      assert.notEqual(message.type, 'error', JSON.stringify(message))
    }
    const executable = fileURLToPath(new URL(`../../target/debug/examples/protocol${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url))
    const native = execFileSync(executable, { input: commands.map((c) => JSON.stringify(c)).join('\n') + '\n', encoding: 'utf8' }).trim().split('\n').map((line) => JSON.parse(line))
    assert.deepEqual(wasm, native)
    const stopped = wasm[4][0].snapshot.agents.find((a: { id: string }) => a.id === id)
    assert.equal(stopped.state, 'immobile')
    assert.equal(stopped.currentGoal.status, 'suspended')
    assert.deepEqual(stopped.position, { x: wasm[2][2].frame.agents.find((a: { id: string }) => a.id === id).x, y: wasm[2][2].frame.agents.find((a: { id: string }) => a.id === id).y })
    assert.equal(wasm[7][0].snapshot.agents.every((a: { currentGoal: { status: string } }) => a.currentGoal.status === 'completed'), true)
    bindings.destroy_engine(handle)
  }
})

test('actual Wasm service goals preserve claims, edits, cursors and departures with native parity', async () => {
  const bindings = await engine(), handle = bindings.create_engine()
  const initial = JSON.parse(readFileSync(new URL('../../contract/fixtures/engine-services-load.json', import.meta.url), 'utf8'))
  const header = { schemaVersion: 1, simulationId: 'engine-demo' }
  const apply = (id: string, operations: unknown[]) => ({ ...header, type: 'apply_request', commandId: id, request: { ...header, requestId: id, operations } })
  const commands = [initial,
    { ...header, commandId: 'join', type: 'step', ticks: 2 },
    { ...header, commandId: 'queued', type: 'snapshot', snapshotId: 'queued' },
    { ...header, commandId: 'serve', type: 'step', ticks: 11 },
    { ...header, commandId: 'serving', type: 'snapshot', snapshotId: 'serving' },
    apply('hold', [{ op: 'set', targets: { ids: ['a1'] }, values: { components: { mobility: { speedMultiplier: 0 } }, appearance: { pose: 'fallen' } } }]),
    { ...header, commandId: 'held', type: 'step', ticks: 10 },
    apply('recover', [{ op: 'set', targets: { ids: ['a1'] }, values: { components: { mobility: { speedMultiplier: 1 } }, appearance: { pose: 'upright' } } }]),
    apply('pending', [{ op: 'assign_goal', targets: { ids: ['a3'] }, mode: 'enqueue', goal: { kind: 'wait', duration: 0.2 } }]),
    apply('replace', [{ op: 'assign_goal', targets: { ids: ['a3'] }, goal: { kind: 'sequence', repeat: 2, goals: [{ kind: 'wait', duration: 0.1 }, { kind: 'wait', duration: 0.2 }] } }]),
    apply('clear-pending', [{ op: 'clear_goal', targets: { ids: ['a3'] }, scope: 'queued' }]),
    { ...header, commandId: 'finish', type: 'step', ticks: 400 },
    { ...header, commandId: 'final', type: 'snapshot', snapshotId: 'final' },
    { ...header, commandId: 'history', type: 'query', query: { kind: 'history' } },
    apply('remove-roamer', [{ op: 'remove', targets: { ids: ['a3'], kind: 'agent' } }]),
    { ...header, commandId: 'removed', type: 'snapshot', snapshotId: 'removed' },
  ]
  const wasm = commands.map((c) => {
    assert.equal(parseWorkerCommand(c).ok, true, JSON.stringify(c))
    const messages = JSON.parse(bindings.dispatch(handle, JSON.stringify(c)))
    for (const m of messages) { const parsed = parseWorkerMessage(m); assert.equal(parsed.ok, true, JSON.stringify(parsed)); assert.notEqual(m.type, 'error', JSON.stringify(m)) }
    return messages
  })
  const executable = fileURLToPath(new URL(`../../target/debug/examples/protocol${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url))
  const native = execFileSync(executable, { input: commands.map((c) => JSON.stringify(c)).join('\n') + '\n', encoding: 'utf8' }).trim().split('\n').map((line) => JSON.parse(line))
  assert.deepEqual(wasm, native)
  assert.equal(wasm[2][0].snapshot.queues.find((q: { targetId: string }) => q.targetId === 'desk').entries.length, 2)
  assert.equal(wasm[4][0].snapshot.slots[0].slots[0].agentId, 'a1')
  const final = wasm[12][0].snapshot
  assert.equal(final.metrics.departures.length, 2)
  assert.equal(final.events.filter((e: { name: string }) => e.name === 'departure').length, 2)
  assert.equal(final.agents.every((a: { queueRef: unknown; interactionRef: unknown }) => a.queueRef === null && a.interactionRef === null), true)
  assert.equal(final.slots[0].slots[0].agentId, null)
  const removed = wasm.at(-1)[0].snapshot
  assert.equal(removed.metrics.removedCount, 1)
  assert.equal(removed.metrics.departures.length, 2)
  bindings.destroy_engine(handle)
})
