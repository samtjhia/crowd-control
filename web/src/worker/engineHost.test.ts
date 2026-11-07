import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { WasmEngineBindings, WorkerCommand, WorkerMessage } from '@crowd-control/contract'
import { createEngineHost, MAX_TICKS_PER_BATCH } from './engineHost.ts'
import type { WorkerClock } from './clock.ts'

const load = JSON.parse(readFileSync(new URL('../../../contract/fixtures/engine-static-load.json', import.meta.url), 'utf8')) as WorkerCommand
function setup(stepCostMs = 0) {
  const clock: WorkerClock & { time: number; callback: (() => void) | undefined; elapse(ms: number): void } = {
    time: 0, callback: undefined, now: () => clock.time,
    every(_ms, callback) { clock.callback = callback; return () => { clock.callback = undefined } },
    elapse(ms) { clock.time += ms; clock.callback?.() },
  }
  let tick = 0, destroyed = false
  const batches: number[] = [], received: WorkerMessage[] = []
  const bindings: WasmEngineBindings = {
    abi_version: () => 1, engine_version: () => 'contact-engine-v8.1', create_engine: () => 1, destroy_engine() { destroyed = true },
    dispatch(_handle, json) {
      const command = JSON.parse(json) as WorkerCommand
      if (command.simulationId !== 'engine-demo') return JSON.stringify([{ schemaVersion: 1, simulationId: command.simulationId, type: 'error', commandId: command.commandId, error: { code: 'INVALID_SCHEMA', message: 'wrong simulation' } }])
      if (command.type === 'load' || command.type === 'reset') tick = 0
      if (command.type === 'step') { batches.push(command.ticks); tick += command.ticks; clock.time += stepCostMs * command.ticks }
      const stamp = { streamId: 'clock-test', tick, time: tick * 0.05, topologyVersion: 0, sceneVersion: 1, historyRevision: 0 }
      return JSON.stringify([{ schemaVersion: 1, simulationId: 'engine-demo', commandId: command.commandId, type: 'ack', stamp }, ...(command.type === 'step' ? [{ schemaVersion: 1, simulationId: 'engine-demo', type: 'frame', frame: { ...stamp, agents: [] } }] : [])])
    },
  }
  const host = createEngineHost(bindings, (message) => received.push(message), clock)
  let sequence = 0
  const send = (type: 'pause' | 'resume' | 'reset' | 'speed', multiplier = 1) => host.send({ schemaVersion: 1, simulationId: 'engine-demo', commandId: `control-${++sequence}`, type, ...(type === 'speed' ? { multiplier } : {}) })
  host.send(load)
  const drain = (target: number) => { for (let i = 0; tick < target && i < 10000; i++) clock.elapse(0); assert.equal(tick, target) }
  return { host, send, drain, clock, batches, received, tick: () => tick, destroyed: () => destroyed }
}
test('fixed clock retains fractional time and runs 4× without changing dt', () => {
  const s = setup()
  assert.equal(s.clock.callback, undefined)
  s.send('speed', 4); s.send('resume')
  s.clock.elapse(10); assert.equal(s.tick(), 0)
  s.clock.elapse(990); s.drain(80)
  const frame = s.received.filter((m) => m.type === 'frame').at(-1)!
  if (frame.type === 'frame') assert.equal(frame.frame.time, 4)
  s.send('pause'); assert.equal(s.clock.callback, undefined)
  s.clock.elapse(1000); assert.equal(s.tick(), 80)
  s.send('resume'); s.clock.elapse(1000); s.drain(160)
  s.host.dispose()
})
test('large backlogs are processed in bounded batches without discarding debt', () => {
  const s = setup(); s.send('resume'); s.clock.elapse(50_000)
  assert.equal(s.tick(), MAX_TICKS_PER_BATCH)
  s.drain(1000)
  assert.ok(s.batches.every((ticks) => ticks <= MAX_TICKS_PER_BATCH))
  assert.equal(s.received.filter((m) => m.type === 'ack').length, 2, 'Paced ticks do not leak internal acknowledgements')
  s.host.dispose()
})
test('8× at 60 pulses advances 160 fixed ticks using two/three-tick batches', () => {
  const s = setup(); s.send('speed', 8); s.send('resume')
  for (let i = 0; i < 60; i++) s.clock.elapse(1000 / 60)
  assert.equal(s.tick(), 160)
  assert.ok(s.batches.every((n) => n === 2 || n === 3))
  const frame = s.received.filter((m) => m.type === 'frame').at(-1)!
  if (frame.type === 'frame') assert.equal(frame.frame.time, 8)
  s.host.dispose()
})
test('pause retains backlog; resume and speed changes preserve elapsed old-rate time', () => {
  const s = setup(); s.send('resume'); s.clock.time += 25
  s.send('speed', 4); s.clock.elapse(25); assert.equal(s.tick(), 2)
  s.send('pause'); s.clock.elapse(9999); assert.equal(s.tick(), 2)
  s.send('resume'); s.clock.elapse(6.25); assert.equal(s.tick(), 3)
  s.clock.elapse(50_000); s.send('pause'); const paused = s.tick()
  s.clock.elapse(0); assert.equal(s.tick(), paused)
  s.send('resume'); s.clock.elapse(0); assert.equal(s.tick(), paused + MAX_TICKS_PER_BATCH)
  s.host.dispose()
})
test('failed commands do not reset pacing and reset/load deliberately start a new clock', () => {
  const s = setup(); s.send('resume'); s.clock.elapse(1000); s.drain(20)
  s.host.send({ schemaVersion: 1, simulationId: 'other', commandId: 'bad', type: 'reset' })
  assert.ok(s.clock.callback); s.clock.elapse(1000); s.drain(40)
  s.send('reset'); assert.equal(s.tick(), 0); assert.equal(s.clock.callback, undefined)
  s.send('resume'); s.clock.elapse(1000); s.drain(20)
  s.host.dispose(); assert.equal(s.destroyed(), true); assert.equal(s.clock.callback, undefined)
  assert.throws(() => s.host.send(load), /disposed/)
})

test('expensive Rust ticks shrink catch-up batches instead of growing stalls', () => {
  const s = setup(25)
  s.send('speed', 8); s.send('resume')
  s.clock.elapse(1000)
  assert.equal(s.batches[0], MAX_TICKS_PER_BATCH)
  for (let i = 0; i < 20; i++) s.clock.elapse(16)
  assert.ok(s.batches.slice(1).every((n) => n === 1))
  assert.ok(s.tick() < 160, 'slow hardware retains simulation debt rather than jumping over ticks')
  const before = s.tick()
  s.send('pause')
  assert.ok(s.tick() - before <= 1, 'pause is not preceded by a giant catch-up dispatch')
  s.clock.elapse(10000)
  assert.equal(s.clock.callback, undefined)
  s.host.dispose()
})
