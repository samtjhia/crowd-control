import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { CompileOutput, Frame, ScenarioPlan, WorkerCommand, WorkerMessage } from '@crowd-control/contract'
import { MockSimulation } from '../worker/mock/simulation.ts'
import { describeScenario, startScenario } from './scenario.ts'

const fixture = <T>(name: string) => JSON.parse(readFileSync(new URL(`../../../contract/fixtures/${name}.json`, import.meta.url), 'utf8')) as T
const plan = () => fixture<ScenarioPlan>('scenario-plan')
const model = fixture<CompileOutput>('compile-output').resolvedModel

function compiled(): CompileOutput {
  const result = startScenario(plan(), model)
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) throw new Error('unreachable')
  return result.value
}

let commands = 0
function send(sim: MockSimulation, body: Record<string, unknown>): WorkerMessage[] {
  return sim.handle({ schemaVersion: 1, simulationId: 'worked-demo', commandId: `c${++commands}`, ...body } as WorkerCommand)
}
const lastFrame = (messages: WorkerMessage[]): Frame => {
  const frame = messages.filter((m) => m.type === 'frame').at(-1)
  assert.ok(frame && frame.type === 'frame')
  return frame.frame
}

test('the worked plan compiles in the browser bundle and is summarised for the header', () => {
  assert.equal(describeScenario(compiled()), 'Hall, foyer and outside · 10 people')
})

test('Checkpoint B: the compiled plan plays in the mock worker like the PRD scenario', () => {
  const sim = new MockSimulation()
  const loaded = send(sim, { type: 'load', compiled: compiled(), history: { historyRevision: 0, records: [], outcomes: [] } })
  assert.deepEqual(loaded.map((m) => m.type), ['ack', 'scene', 'frame', 'metrics'])
  assert.equal(lastFrame(loaded).agents.length, 8)
  assert.ok(lastFrame(loaded).agents.every((agent) => agent.controller === 'wander-hall'))

  const at10 = lastFrame(send(sim, { type: 'run_to', time: 10 }))
  assert.equal(at10.agents.length, 10)
  assert.equal(at10.agents.find((agent) => agent.id === 'a9')?.controller, 'reach-hall-then-wander-hall')

  const at30 = lastFrame(send(sim, { type: 'run_to', time: 30 }))
  assert.ok(at30.agents.every((agent) => agent.controller === 'reach-outside'))
  const at60 = lastFrame(send(sim, { type: 'run_to', time: 60 }))
  assert.ok(at60.agents.every((agent) => agent.state === 'departed'))
})

test('a bad plan comes back as an error with the failing path, not a broken scene', () => {
  const broken = plan()
  if (broken.layout.mode !== 'generate') throw new Error('fixture changed')
  broken.layout.spaces[0]!.id = 'kitchen'
  const result = startScenario(broken, model)
  assert.equal(result.ok, false)
  assert.equal(startScenario({ nonsense: true }, model).ok, false)
})
