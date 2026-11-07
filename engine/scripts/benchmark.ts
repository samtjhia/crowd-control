import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { instantiateEngine } from '../../web/src/worker/wasmBindings.ts'
import { dispatchCommand } from '../../web/src/worker/dispatchCommand.ts'

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
