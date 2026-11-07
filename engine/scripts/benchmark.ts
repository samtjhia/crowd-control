import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { instantiateEngine } from '../../web/src/worker/wasmBindings.ts'
import { dispatchCommand } from '../../web/src/worker/dispatchCommand.ts'
import { createEngineHost } from '../../web/src/worker/engineHost.ts'
import type { Frame } from '@crowd-control/contract'

const binary = fileURLToPath(new URL(`../../target/release/examples/movement_bench${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url))
console.log(execFileSync(binary, { encoding: 'utf8' }).trim())
const load = JSON.parse(execFileSync(binary, ['--fixture'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }))
const bindings = await instantiateEngine(new Uint8Array(readFileSync(new URL('../../web/public/engine/crowd_control_engine.wasm', import.meta.url))))
const handle = bindings.create_engine()
const initial = dispatchCommand(bindings, handle, load)
if (initial.some((m) => m.type === 'error')) throw new Error(JSON.stringify(initial))
const samples: number[] = []
let last = initial
for (let i = 0; i < 90; i++) {
  const start = performance.now()
  const result = dispatchCommand(bindings, handle, { schemaVersion: 1, simulationId: 'engine-demo', commandId: 'bench', type: 'step', ticks: 1 })
  const elapsed = performance.now() - start
  if (result.some((m) => m.type === 'error')) throw new Error(JSON.stringify(result))
  last = result
  if (i >= 10) samples.push(elapsed)
}
const mean = samples.reduce((a, b) => a + b, 0) / samples.length
samples.sort((a, b) => a - b)
const frame = last.find((m) => m.type === 'frame')
if (frame?.type !== 'frame' || frame.frame.agents.length !== 2000) throw new Error('Benchmark must retain all agents')
const progress = frame.frame.agents.reduce((sum, a, i) => sum + a.x - load.compiled.scene.agents[i].x, 0) / 2000
if (progress <= 0.5) throw new Error('Benchmark crowd must actually advance')
console.log(JSON.stringify({ runtime: 'Wasm + validated worker dispatch', arch: process.arch, agents: 2000, ticksMeasured: samples.length, meanMs: mean, p95Ms: samples[Math.floor(samples.length * 0.95)], ticksPerSecond: 1000 / mean, requiredTicksPerSecondAt4x: 80, meanXProgress: progress, renderFps: null }))
bindings.destroy_engine(handle)

// Actual host batching, excluding timer/transfer/render costs.
function benchmarkHost(fixture: typeof load, speed: number, runtime: string) {
  let now = 0
  let pulse: (() => void) | undefined
  let lastFrame: Frame | undefined
  const host = createEngineHost(bindings, (message) => {
    if (message.type === 'error') throw new Error(JSON.stringify(message))
    if (message.type === 'frame') lastFrame = message.frame
  }, { now: () => now, every(_ms, callback) { pulse = callback; return () => { pulse = undefined } } })
  try {
    host.send(fixture)
    const header = { schemaVersion: 1, simulationId: 'engine-demo' }
    host.send({ ...header, commandId: 'speed', type: 'speed', multiplier: speed })
    host.send({ ...header, commandId: 'play', type: 'resume' })
    const samples: number[] = []
    let firstMeasuredTick = 0
    for (let i = 0; i < 90; i++) {
      if (i === 10) firstMeasuredTick = lastFrame!.tick
      now += 1000 / 60
      const start = performance.now()
      pulse!()
      if (i >= 10) samples.push(performance.now() - start)
    }
    const finalFrame = lastFrame!
    const expectedTicks = Math.round(1.5 * speed / fixture.compiled.scene.model.dt)
    if (finalFrame.tick !== expectedTicks || finalFrame.agents.length !== 2000) throw new Error('Playback must retain all ticks and agents')
    const cpuMs = samples.reduce((a, b) => a + b, 0)
    samples.sort((a, b) => a - b)
    console.log(JSON.stringify({ runtime, agents: 2000, ticksMeasured: finalFrame.tick - firstMeasuredTick, meanCpuMsPerPulse: cpuMs / samples.length, p95CpuMsPerPulse: samples[Math.floor(samples.length * 0.95)], ticksPerCpuSecond: (finalFrame.tick - firstMeasuredTick) * 1000 / cpuMs, requiredTicksPerSecond: speed / fixture.compiled.scene.model.dt, renderFps: null }))
  } finally { host.dispose() }
}
benchmarkHost(load, 8, 'Wasm + worker host at 8x/60 pulses per second')
const scheduled = structuredClone(load)
scheduled.compiled.scene.jobs = [{ id: 'future', at: 1000, operations: [{ op: 'emit', event: 'later' }] }]
scheduled.compiled.scene.rules = [{ op: 'define_rule', id: 'watch-count', when: { kind: 'count', targets: { kind: 'agent' }, comparison: 'gt', value: 2000 }, operations: [{ op: 'emit', event: { name: 'over-budget' } }] }]
benchmarkHost(scheduled, 4, 'Wasm + worker host at 4x with pending job and live count rule')

const contact = structuredClone(scheduled)
contact.compiled.resolvedModel.contact = { solverVersion: 'disc-impulse-v1', referenceLoad: 2, forceUnits: 'model-force', parameters: { mass: 1, iterations: 64, tolerance: 1e-8, maximumSpeed: 2 } }
contact.compiled.scene.rules.push({ op: 'define_rule', id: 'contact-monitor', when: { kind: 'entity_metric', targets: { kind: 'agent' }, metric: 'contactLoadRatio', comparison: 'gte', value: 1000, for: 1 }, operations: [{ op: 'set', targets: { binding: 'subject' }, values: { components: { mobility: { speedMultiplier: 0 } } } }] })
benchmarkHost(contact, 4, 'Wasm + worker host at 4x with contact solver and per-agent sensor rule')
