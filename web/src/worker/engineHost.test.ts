import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { WasmEngineBindings, WorkerCommand, WorkerMessage } from '@crowd-control/contract'
import { createEngineHost, MAX_TICKS_PER_BATCH } from './engineHost.ts'
import type { WorkerClock } from './clock.ts'

const load = JSON.parse(readFileSync(new URL('../../../contract/fixtures/engine-static-load.json', import.meta.url), 'utf8')) as WorkerCommand
function setup(stepCostMs = 0, withDensity = false, completeAt = Infinity) {
  const clock: WorkerClock & { time: number; callback: (() => void) | undefined; elapse(ms: number): void } = {
    time: 0, callback: undefined, now: () => clock.time,
    every(_ms, callback) { clock.callback = callback; return () => { clock.callback = undefined } },
    elapse(ms) { clock.time += ms; clock.callback?.() },
  }
  let tick = 0, destroyed = false
  const batches: number[] = [], received: WorkerMessage[] = []
  const bindings: WasmEngineBindings = {
    abi_version: () => 1, engine_version: () => 'contact-engine-v8.16', create_engine: () => 1, destroy_engine() { destroyed = true },
    dispatch(_handle, json) {
      const command = JSON.parse(json) as WorkerCommand
      if (command.simulationId !== 'engine-demo') return JSON.stringify([{ schemaVersion: 1, simulationId: command.simulationId, type: 'error', commandId: command.commandId, error: { code: 'INVALID_SCHEMA', message: 'wrong simulation' } }])
      if (command.type === 'load' || command.type === 'reset') tick = 0
      if (command.type === 'seek') tick = Math.ceil(command.time / 0.05)
      if (command.type === 'step') { batches.push(command.ticks); tick += command.ticks; clock.time += stepCostMs * command.ticks }
      const stamp = { streamId: 'clock-test', tick, time: tick * 0.05, topologyVersion: 0, sceneVersion: 1, historyRevision: 0 }
      return JSON.stringify([{ schemaVersion: 1, simulationId: 'engine-demo', commandId: command.commandId, type: 'ack', stamp }, ...(command.type === 'step' ? [{ schemaVersion: 1, simulationId: 'engine-demo', type: 'frame', frame: { ...stamp, agents: [] } }, ...(withDensity ? [{ schemaVersion: 1, simulationId: 'engine-demo', type: 'metrics', stamp,
        completed: tick >= completeAt, sample: { time: tick * .05, present: 0, departed: 0, blocked: 0, immobile: 0, removed: 0, zones: [], portals: [], queues: [], clearance: { t50: null, t90: null, t100: null } },
        density: { width: 1, height: 1, cellSize: 1, origin: { x: 0, y: 0 }, units: 'people/model-unit2', values: [0] } }] : [])] : [])])
    },
  }
  const host = createEngineHost(bindings, (message) => received.push(message), clock)
  let sequence = 0
  let playbackSpeed = 1
  const send = (type: 'pause' | 'resume' | 'reset' | 'speed', multiplier = 1) => { if (type === 'speed') playbackSpeed = multiplier; if (type === 'reset') playbackSpeed = 1; host.send({ schemaVersion: 1, simulationId: 'engine-demo', commandId: `control-${++sequence}`, type, ...(type === 'speed' ? { multiplier } : {}) }) }
  host.send(load)
  const drain = (target: number) => { for (let i = 0; tick < target && i < 10000; i++) clock.elapse(50 / playbackSpeed); assert.equal(tick, target) }
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
  assert.equal(s.tick(), 1)
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
  s.send('resume'); s.clock.elapse(0); assert.equal(s.tick(), paused)
  s.clock.elapse(50); assert.equal(s.tick(), paused + 2)
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
  assert.ok(s.batches[0]! <= 3)
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

test('automatic density transport is capped in wall time without losing ticks or metric counts', () => {
  const s = setup(0, true)
  s.send('speed', 8); s.send('resume')
  for (let i = 0; i < 60; i++) s.clock.elapse(1000 / 60)
  assert.equal(s.tick(), 160)
  const metrics = s.received.filter((m) => m.type === 'metrics')
  assert.equal(metrics.length, 60, 'live counts keep the full publication rate')
  const grids = metrics.filter((m) => m.density)
  assert.ok(grids.length >= 4 && grids.length <= 5, `${grids.length} density grids sent in one second`)
  s.host.dispose()
})

test('completion stops automatic ticks and reset permits another run', () => {
  const s = setup(0, true, 4)
  s.send('resume'); for (let i = 0; i < 4; i++) s.clock.elapse(50)
  assert.equal(s.tick(), 4)
  assert.equal(s.clock.callback, undefined)
  s.clock.elapse(5000); assert.equal(s.tick(), 4)
  s.send('resume'); assert.equal(s.clock.callback, undefined)
  s.send('reset'); s.send('resume'); assert.ok(s.clock.callback)
  s.clock.elapse(50); assert.equal(s.tick(), 1)
  s.host.dispose()
})

test('seek pauses playback, clears old debt and preserves playback speed', () => {
  const s = setup()
  s.send('speed', 4); s.send('resume'); s.clock.elapse(1000)
  s.host.send({ schemaVersion: 1, simulationId: 'engine-demo', commandId: 'seek-back', type: 'seek', time: 0 })
  assert.equal(s.clock.callback, undefined)
  assert.equal(s.tick(), 0)
  s.send('resume'); s.clock.elapse(0); assert.equal(s.tick(), 0)
  s.clock.elapse(12.5); assert.equal(s.tick(), 1)
  s.host.dispose()
})

test('an alarm-sized stall cannot produce sustained catch-up above the selected 8× rate', () => {
  const s = setup()
  s.send('speed', 8); s.send('resume')
  s.clock.elapse(1000)
  const afterStall = s.tick()
  assert.ok(afterStall <= 3)
  for (let i = 0; i < 60; i++) s.clock.elapse(1000 / 60)
  assert.equal(s.tick() - afterStall, 160, 'recovery must keep the requested speed rather than emptying debt in a burst')
  assert.ok(s.tick() < 320, 'unprocessed debt is retained instead of skipped')
  const before = s.tick()
  for (let i = 0; i < 100; i++) s.clock.elapse(0)
  assert.equal(s.tick(), before, 'queued messages cannot spend the same wall-clock allowance twice')
  s.host.dispose()
})

test('prepared venue dt=0.1 also recovers at 8× after an expensive alarm', () => {
  const s = setup()
  const venue = structuredClone(load)
  assert.equal(venue.type, 'load')
  if (venue.type !== 'load') throw new Error('Expected load fixture')
  venue.compiled.scene.model.dt = 0.1
  venue.compiled.resolvedModel.dt = 0.1
  s.host.send(venue)
  s.send('speed', 8); s.send('resume'); s.clock.elapse(1000)
  const before = s.tick()
  assert.ok(before <= 2)
  for (let i = 0; i < 60; i++) s.clock.elapse(1000 / 60)
  assert.equal(s.tick() - before, 80, 'one second advances eight simulated seconds at the venue timestep')
  s.host.dispose()
})
