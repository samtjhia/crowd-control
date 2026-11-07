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
  assert.deepEqual(messages.map((m: { type: string }) => m.type), ['ack', 'scene', 'frame', 'metrics'])
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
  const drain = (target: number) => { for (let i = 0; frame().frame.tick < target && i < 1000; i++) callback?.(); assert.equal(frame().frame.tick, target) }
  drain(80); assert.equal(frame().frame.time, 4)
  now += 10_000; callback?.(); assert.equal(frame().frame.tick, 88)
  drain(880)
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

test('part six runs every compiled frontend scenario through the real host and SimulationClient', async () => {
  const { scenarios, startScenario, movementPreset } = await import('../../web/src/sim/scenario.ts')
  const { SimulationClient } = await import('../../web/src/worker/simulationClient.ts')
  const worked = JSON.parse(readFileSync(new URL('../../contract/fixtures/scenario-plan.json', import.meta.url), 'utf8'))
  const preset = JSON.parse(readFileSync(new URL('../../contract/fixtures/compile-output.json', import.meta.url), 'utf8')).resolvedModel
  const bindings = await engine()
  for (const scenario of scenarios(worked, movementPreset(preset))) {
    const compiled = startScenario(scenario.plan, scenario.model)
    assert.equal(compiled.ok, true, `${scenario.id}: ${JSON.stringify(compiled)}`)
    if (!compiled.ok) continue
    const listeners = new Set<(m: WorkerMessage) => void>()
    const host = createEngineHost(bindings, (m) => queueMicrotask(() => listeners.forEach((listener) => listener(m))))
    const client = new SimulationClient({ kind: 'real', send: (command) => host.send(command), subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } } })
    try {
      assert.equal((await client.load(compiled.value)).type, 'ack', scenario.id)
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(client.getView().scene?.agents.length, compiled.value.scene.agents.length, scenario.id)
      assert.equal((await client.step()).type, 'ack', scenario.id)
      const id = compiled.value.scene.agents[0]!.id
      assert.equal((await client.apply('Colour attendee', [{ op: 'set', targets: { ids: [id] }, values: { appearance: { fill: '#AABBCC' } } }])).ok, true)
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(client.getView().scene?.agents.find((a) => a.id === id)?.appearance.fill, '#AABBCC')
      const snapshot = await client.command({ type: 'snapshot', snapshotId: 'part-six' })
      assert.equal(snapshot.type, 'snapshot')
      if (snapshot.type === 'snapshot') assert.equal(parseSnapshot(snapshot.snapshot).ok, true, JSON.stringify(snapshot.snapshot))
      assert.equal(client.getView().lastError, null)
      assert.ok(client.getView().metrics, 'real metrics reach the existing frontend client')
      assert.ok(client.getView().density, 'real density reaches the existing frontend client')
    } finally { client.dispose(); host.dispose() }
  }
})

test('part six scheduled arrivals, rules, origins and failures match native Rust in actual Wasm', async () => {
  const load = JSON.parse(readFileSync(new URL('../../contract/fixtures/engine-load.json', import.meta.url), 'utf8'))
  const h = (type: string, extra = {}) => ({ schemaVersion: 1, simulationId: 'engine-demo', commandId: type, type, ...extra })
  const commands = [load, h('step', { ticks: 100 }), h('snapshot', { snapshotId: 'arrivals' }), h('step', { ticks: 100 }), h('snapshot', { snapshotId: 'alarm' }), h('apply_request', { request: { schemaVersion: 1, simulationId: 'engine-demo', requestId: 'deferred', operations: [{ op: 'schedule', id: 'bad-arrival', after: 0.1, operations: [{ op: 'spawn', count: 2000, template: { kind: 'agent', profile: 'person' }, placement: { inside: { ids: ['hall'] } } }] }] } }), h('step', { ticks: 2 }), h('snapshot', { snapshotId: 'failed' })]
  const bindings = await engine(), handle = bindings.create_engine()
  try {
    const wasm = commands.map((c) => JSON.parse(bindings.dispatch(handle, JSON.stringify(c))))
    for (const batch of wasm) for (const message of batch) { const parsed = parseWorkerMessage(message); assert.equal(parsed.ok, true, JSON.stringify(parsed)) }
    assert.equal(wasm[2][0].snapshot.agents.length, 3)
    assert.ok(wasm[4][0].snapshot.agents.every((a: EngineSnapshot['agents'][number]) => a.currentGoal?.spec.kind === 'reach'))
    assert.equal(wasm[7][0].snapshot.events.at(-1).name, 'job_failed')
    assert.equal(wasm[7][0].snapshot.events.at(-1).origin.parentJobId, 'bad-arrival')
    const executable = fileURLToPath(new URL('../../target/debug/examples/protocol', import.meta.url))
    const native = execFileSync(executable, { input: commands.map((c) => JSON.stringify(c)).join('\n') + '\n', encoding: 'utf8' }).trim().split('\n').map((v) => JSON.parse(v))
    assert.deepEqual(wasm, native)
  } finally { bindings.destroy_engine(handle) }
})

test('part seven metrics, cohorts and read-only queries validate in Wasm with native parity', async () => {
  const load = JSON.parse(readFileSync(new URL('../../contract/fixtures/engine-services-load.json', import.meta.url), 'utf8'))
  load.compiled.scene.clearance = { cohortIds: ['a1', 'a2'], startedAt: 0 }
  const h = (type: string, extra = {}) => ({ schemaVersion: 1, simulationId: 'engine-demo', commandId: type, type, ...extra })
  const commands = [load, h('snapshot', { snapshotId: 'unchanged' }),
    h('query', { query: { kind: 'inventory' } }),
    h('query', { query: { kind: 'agents', targets: { kind: 'agent', sample: { count: 1 } } } }),
    h('query', { query: { kind: 'metrics', from: 0, to: 0, zones: ['hall'] } }),
    h('query', { query: { kind: 'events', names: ['departure'] } }),
    h('snapshot', { snapshotId: 'unchanged' }), h('step', { ticks: 400 }),
    h('query', { query: { kind: 'metrics', from: 0, to: 20, zones: ['hall'] } }),
    h('snapshot', { snapshotId: 'complete' }), h('step', { ticks: 1 })]
  const bindings = await engine(), handle = bindings.create_engine()
  try {
    const wasm = commands.map((c) => JSON.parse(bindings.dispatch(handle, JSON.stringify(c))))
    for (const batch of wasm) for (const message of batch) {
      const parsed = parseWorkerMessage(message)
      assert.equal(parsed.ok, true, JSON.stringify(parsed))
    }
    assert.deepEqual(wasm[1], wasm[6], 'all five reads leave snapshot state and RNG unchanged')
    assert.equal(wasm[8][0].result.samples.length, 41)
    const metrics = wasm[7].find((m: WorkerMessage) => m.type === 'metrics')
    assert.ok(metrics.sample.clearance.t100 !== null)
    assert.equal(metrics.sample.departed, 2)
    assert.equal(metrics.density.units, 'people/model-unit2')
    assert.equal(metrics.sample.queues.find((q: { targetId: string }) => q.targetId === 'desk').served, 2)
    assert.equal(metrics.sample.portals.find((p: { portalId: string }) => p.portalId === 'door').crossed, 2)
    const frame = wasm[7].find((m: WorkerMessage) => m.type === 'frame').frame
    for (const key of ['tick', 'time', 'historyRevision', 'sceneVersion', 'topologyVersion', 'streamId']) assert.equal(metrics.stamp[key], frame[key])
    assert.equal(wasm[10].find((m: WorkerMessage) => m.type === 'metrics').density, undefined, 'density publication is throttled while counts remain live')
    assert.ok(wasm[9][0].snapshot.agents.every((a: EngineSnapshot['agents'][number]) => a.sensors === null))
    const executable = fileURLToPath(new URL('../../target/debug/examples/protocol', import.meta.url))
    const native = execFileSync(executable, { input: commands.map((c) => JSON.stringify(c)).join('\n') + '\n', encoding: 'utf8' }).trim().split('\n').map((v) => JSON.parse(v))
    assert.deepEqual(wasm, native)
  } finally { bindings.destroy_engine(handle) }
})

test('part eight contact impulses, subject jobs, falls and recovery validate with native parity', async () => {
  const load = JSON.parse(readFileSync(new URL('../../contract/fixtures/engine-contact-load.json', import.meta.url), 'utf8'))
  const h = (type: string, extra = {}) => ({ schemaVersion: 1, simulationId: 'engine-demo', commandId: type, type, ...extra })
  const commands = [load, h('step', { ticks: 2 }), h('snapshot', { snapshotId: 'queued' }), h('step', { ticks: 1 }), h('snapshot', { snapshotId: 'fallen' }), h('apply_request', { request: { schemaVersion: 1, simulationId: 'engine-demo', requestId: 'recover', operations: [{ op: 'set', targets: { ids: ['a2'] }, values: { components: { mobility: { speedMultiplier: 1 } }, appearance: { pose: 'upright' } } }] } }), h('step', { ticks: 5 }), h('snapshot', { snapshotId: 'recovered' })]
  const bindings = await engine(), handle = bindings.create_engine()
  try {
    const wasm = commands.map((c) => JSON.parse(bindings.dispatch(handle, JSON.stringify(c))))
    for (const batch of wasm) for (const message of batch) {
      const parsed = parseWorkerMessage(message); assert.equal(parsed.ok, true, JSON.stringify(parsed))
    }
    const queued = wasm[2][0].snapshot, fallen = wasm[4][0].snapshot, recovered = wasm[7][0].snapshot
    assert.equal(queued.jobs[0].subjectId, 'a2'); assert.equal(queued.jobs[0].dueTick, 3)
    assert.ok(Math.abs(queued.agents[1].sensors.contactLoad - 4) < 1e-8)
    assert.equal(fallen.agents[1].state, 'immobile'); assert.equal(fallen.agents[1].appearance.pose, 'fallen')
    assert.equal(fallen.contactState.solverVersion, 'disc-impulse-v1')
    assert.equal(recovered.rules[0].subjects.a2.fired, true); assert.notEqual(recovered.agents[1].state, 'immobile')
    const executable = fileURLToPath(new URL('../../target/debug/examples/protocol', import.meta.url))
    const native = execFileSync(executable, { input: commands.map((c) => JSON.stringify(c)).join('\n') + '\n', encoding: 'utf8' }).trim().split('\n').map((v) => JSON.parse(v))
    assert.deepEqual(wasm, native)
  } finally { bindings.destroy_engine(handle) }
})

test('registered contact presets advertise sensors to the compiler and real frontend client', async () => {
  const { startScenario } = await import('../../web/src/sim/scenario.ts')
  const { SimulationClient } = await import('../../web/src/worker/simulationClient.ts')
  const plan = JSON.parse(readFileSync(new URL('../../contract/fixtures/scenario-plan.json', import.meta.url), 'utf8'))
  const fixture = JSON.parse(readFileSync(new URL('../../contract/fixtures/engine-contact-load.json', import.meta.url), 'utf8'))
  plan.rules = fixture.compiled.scene.rules
  plan.timeline = []
  plan.initialOperations = [{ op: 'spawn', count: 3, template: { kind: 'agent', tags: ['attendee'] }, placement: { inside: { ids: ['hall'] } } }, { op: 'assign_goal', targets: { kind: 'agent' }, goal: { kind: 'wait', duration: 100 } }]
  const compiled = startScenario(plan, fixture.compiled.resolvedModel)
  assert.equal(compiled.ok, true, JSON.stringify(compiled))
  if (!compiled.ok) return
  const bindings = await engine(), listeners = new Set<(m: WorkerMessage) => void>()
  const host = createEngineHost(bindings, (m) => queueMicrotask(() => listeners.forEach((listener) => listener(m))))
  const client = new SimulationClient({ kind: 'real', send: (c) => host.send(c), subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } } })
  try {
    assert.equal((await client.load(compiled.value)).type, 'ack')
    assert.equal((await client.step(3)).type, 'ack')
    const reply = await client.command({ type: 'query', query: { kind: 'agents', targets: { kind: 'agent' } } })
    assert.equal(reply.type, 'query_result')
    if (reply.type === 'query_result' && reply.result.kind === 'agents') assert.ok(reply.result.agents.every((a) => a.sensors !== null && a.sensors.contactLoadRatio === 0 && a.state !== 'immobile'))
    assert.equal(client.getView().lastError, null)
  } finally { client.dispose(); host.dispose() }
})

test('worked fire drill clears every agent in actual Wasm', async () => {
  const compiled = JSON.parse(readFileSync(new URL('../../contract/fixtures/compile-output.json', import.meta.url), 'utf8'))
  delete compiled.resolvedModel.contact
  const simulationId = compiled.scene.simulationId
  const h = (type: string, extra = {}) => ({ schemaVersion: 1, simulationId, commandId: type, type, ...extra })
  const commands = [h('load', { compiled, history: { historyRevision: 0, records: [], outcomes: [] } }), h('run_to', { time: 90 }), h('snapshot', { snapshotId: 'evacuated' })]
  const bindings = await engine(), handle = bindings.create_engine()
  try {
    const wasm = commands.map((c) => JSON.parse(bindings.dispatch(handle, JSON.stringify(c))))
    for (const batch of wasm) for (const message of batch) assert.equal(parseWorkerMessage(message).ok, true)
    const agents: EngineSnapshot['agents'] = wasm[2][0].snapshot.agents
    assert.equal(agents.length, 10)
    assert.ok(agents.every((a) => a.state === 'departed'), JSON.stringify(agents))
    const executable = fileURLToPath(new URL('../../target/debug/examples/protocol', import.meta.url))
    const native = execFileSync(executable, { input: commands.map((c) => JSON.stringify(c)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 10_000_000 }).trim().split('\n').map((v) => JSON.parse(v))
    assert.deepEqual(wasm, native)
  } finally { bindings.destroy_engine(handle) }
})

test('prepared fire drill, concert and hackathon demos finish their advertised behavior', async () => {
  const { scenarios, startScenario, movementPreset } = await import('../../web/src/sim/scenario.ts')
  const worked = JSON.parse(readFileSync(new URL('../../contract/fixtures/scenario-plan.json', import.meta.url), 'utf8'))
  const preset = JSON.parse(readFileSync(new URL('../../contract/fixtures/compile-output.json', import.meta.url), 'utf8')).resolvedModel
  const bindings = await engine()
  for (const scenario of scenarios(worked, movementPreset(preset)).filter((s) => ['school-wing', 'concert-floor', 'hackathon-hall', 'hillside-alley'].includes(s.id))) {
    const compiled = startScenario(scenario.plan, scenario.model)
    assert.equal(compiled.ok, true)
    if (!compiled.ok) throw new Error(scenario.id)
    const h = (type: string, extra = {}) => ({ schemaVersion: 1, simulationId: scenario.plan.simulationId, commandId: type, type, ...extra })
    const handle = bindings.create_engine()
    try {
      const commands = [h('load', { compiled: compiled.value, history: { historyRevision: 0, records: [], outcomes: [] } })]
      if (scenario.id === 'school-wing') commands.push(h('run_to', { time: 60 }))
      for (const command of commands) {
        const messages: WorkerMessage[] = JSON.parse(bindings.dispatch(handle, JSON.stringify(command)))
        assert.ok(messages.every((m) => m.type !== 'error'))
      }
      if (scenario.id === 'school-wing') {
        const reports: WorkerMessage[] = JSON.parse(bindings.dispatch(handle, JSON.stringify(h('snapshot', { snapshotId: 'classrooms-clear' }))))
        const report = reports.find((m) => m.type === 'snapshot')
        assert.ok(report?.type === 'snapshot')
        assert.ok(report.snapshot.agents.every((a) => !a.zoneId?.startsWith('room_')), 'every classroom empties by 60 seconds, rather than waiting out a long completion budget')
      }
      for (const command of [h('run_to', { time: scenario.id === 'school-wing' ? 120 : scenario.id === 'concert-floor' ? 300 : scenario.id === 'hillside-alley' ? 180 : 600 })]) {
        const messages: WorkerMessage[] = JSON.parse(bindings.dispatch(handle, JSON.stringify(command)))
        assert.ok(messages.every((m) => m.type !== 'error'), `${scenario.id}: ${JSON.stringify(messages.find((m) => m.type === 'error'))}`)
      }
      const messages: WorkerMessage[] = JSON.parse(bindings.dispatch(handle, JSON.stringify(h('snapshot', { snapshotId: 'finished' }))))
      const snapshot = messages.find((m) => m.type === 'snapshot')
      assert.ok(snapshot?.type === 'snapshot')
      assert.ok(snapshot.snapshot.events.every((event) => event.name !== 'rule_failed' && event.name !== 'job_failed'), scenario.id)
      const agents = snapshot.snapshot.agents
      assert.equal(agents.length, compiled.value.scene.agents.length)
      if (scenario.id === 'hackathon-hall') {
        assert.ok(agents.filter((a) => a.tags.includes('arrival')).every((a) => a.zoneId === 'hall' && a.currentGoal?.cursor[0]?.childIndex === 1), `all arrivals reach the hall and start wandering: ${JSON.stringify(agents.filter((a) => a.tags.includes('arrival') && (a.zoneId !== 'hall' || a.currentGoal?.cursor[0]?.childIndex !== 1)).map((a) => ({ id: a.id, position: a.position, zone: a.zoneId, cursor: a.currentGoal?.cursor })))}`)
        const randomBefore = new Map(agents.map((a) => [a.id, a.randomState]))
        const advanced: WorkerMessage[] = JSON.parse(bindings.dispatch(handle, JSON.stringify(h('step', { ticks: 61 }))))
        assert.ok(advanced.every((m) => m.type !== 'error'))
        const later: WorkerMessage[] = JSON.parse(bindings.dispatch(handle, JSON.stringify(h('snapshot', { snapshotId: 'still-wandering' }))))
        const next = later.find((m) => m.type === 'snapshot')
        assert.ok(next?.type === 'snapshot')
        assert.ok(next.snapshot.agents.every((a) => a.randomState !== randomBefore.get(a.id)), 'all hackathon agents keep selecting wander targets after arrivals finish')
      } else if (scenario.id === 'hillside-alley') {
        for (const direction of ['uphill', 'downhill']) assert.ok(agents.some((a) => a.tags.includes(direction) && a.currentGoal?.cursor[0]?.childIndex === 1), `${direction} traffic crosses the alley`)
      } else {
        assert.ok(agents.every((a) => a.state === 'departed'), `${scenario.id}: ${agents.filter((a) => a.state !== 'departed').length} never exited`)
      }
    } finally { bindings.destroy_engine(handle) }
  }
})

test('concert evacuation keeps making progress across different crowd seeds', async () => {
  const { scenarios, startScenario, movementPreset } = await import('../../web/src/sim/scenario.ts')
  const worked = JSON.parse(readFileSync(new URL('../../contract/fixtures/scenario-plan.json', import.meta.url), 'utf8'))
  const preset = JSON.parse(readFileSync(new URL('../../contract/fixtures/compile-output.json', import.meta.url), 'utf8')).resolvedModel
  const scenario = scenarios(worked, movementPreset(preset)).find((s) => s.id === 'concert-floor')!
  const bindings = await engine()
  for (const seed of [7, 99]) {
    const compiled = startScenario({ ...scenario.plan, seed }, scenario.model)
    assert.ok(compiled.ok)
    const handle = bindings.create_engine()
    const send = (type: string, extra = {}): WorkerMessage[] => {
      const messages: WorkerMessage[] = JSON.parse(bindings.dispatch(handle, JSON.stringify({ schemaVersion: 1, simulationId: scenario.plan.simulationId, commandId: type, type, ...extra })))
      assert.ok(messages.every((m) => m.type !== 'error'), JSON.stringify(messages.find((m) => m.type === 'error')))
      return messages
    }
    try {
      send('load', { compiled: compiled.value, history: { historyRevision: 0, records: [], outcomes: [] } })
      let departed = 0
      for (const time of [90, 120, 150, 180, 210, 240, 270, 300]) {
        const frame = send('run_to', { time }).find((m) => m.type === 'frame')
        assert.ok(frame?.type === 'frame')
        assert.equal(frame.frame.agents.length, 430)
        const count = frame.frame.agents.filter((a) => a.state === 'departed').length
        assert.ok(count > departed || departed === 430, `seed ${seed}: exits stopped making progress at ${time}s (${count}/430)`)
        departed = count
      }
      assert.equal(departed, 430, `seed ${seed}: people left behind`)
    } finally { bindings.destroy_engine(handle) }
  }
})
