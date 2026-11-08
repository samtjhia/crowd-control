import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { CompileOutput, Frame, ScenarioPlan, WorkerCommand, WorkerMessage } from '@crowd-control/contract'
import { MockSimulation } from '../worker/mock/simulation.ts'
import { describeScenario, scenarios, startScenario } from './scenario.ts'

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
function send(sim: MockSimulation, body: Record<string, unknown>, simulationId = 'worked-demo'): WorkerMessage[] {
  return sim.handle({ schemaVersion: 1, simulationId, commandId: `c${++commands}`, ...body } as WorkerCommand)
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

const all = scenarios(plan(), model)

test('every scenario in the picker compiles, and venues are summarised by name', () => {
  assert.deepEqual(all.map((s) => s.id), ['worked-example', 'hillside-alley', 'school-wing', 'concert-floor', 'hackathon-hall'])
  for (const scenario of all) {
    const result = startScenario(scenario.plan, scenario.model)
    assert.equal(result.ok, true, `${scenario.id}: ${JSON.stringify(result.ok ? '' : result.error)}`)
  }
  const alley = startScenario(all[1]!.plan, all[1]!.model)
  assert.equal(alley.ok && describeScenario(alley.value), 'Hillside Alley, Street level · 160 people')
})

test('each venue plays in the mock worker without errors, and walkers stay on floor cells', () => {
  for (const scenario of all.slice(1)) {
    const result = startScenario(scenario.plan, scenario.model)
    if (!result.ok) throw new Error(result.error.message)
    const { map } = result.value.scene
    if (!('grid' in map)) throw new Error('venues use grid maps')
    const sim = new MockSimulation()
    const id = result.value.scene.simulationId
    send(sim, { type: 'load', compiled: result.value, history: { historyRevision: 0, records: [], outcomes: [] } }, id)
    const messages = send(sim, { type: 'run_to', time: 20 }, id)
    assert.deepEqual(messages.filter((m) => m.type === 'error'), [], scenario.id)
    const frame = lastFrame(messages)
    assert.ok(frame.agents.length > 0)
    // Wanderers and waiters stand on walkable cells (people walking between targets may cut corners in the mock).
    const parked = frame.agents.filter((agent) => agent.state === 'waiting' || agent.state === 'idle')
    for (const agent of parked) {
      const i: number = Math.floor(agent.y / map.cellSize) * map.grid.width + Math.floor(agent.x / map.cellSize)
      assert.equal(map.grid.blocked[i], 0, `${scenario.id} ${agent.id} at ${agent.x},${agent.y}`)
    }
  }
})

test('two-way alley: people from each end head for the other', () => {
  const result = startScenario(all[1]!.plan, all[1]!.model)
  if (!result.ok) throw new Error(result.error.message)
  const sim = new MockSimulation()
  const id = result.value.scene.simulationId
  const start = lastFrame(send(sim, { type: 'load', compiled: result.value, history: { historyRevision: 0, records: [], outcomes: [] } }, id))
  const later = lastFrame(send(sim, { type: 'run_to', time: 15 }, id))
  const x = (frame: Frame, id: string) => frame.agents.find((agent) => agent.id === id)!.x
  assert.ok(x(later, 'a1') > x(start, 'a1'), 'an uphill walker moves east')
  assert.ok(x(later, 'a81') < x(start, 'a81'), 'a downhill walker moves west')
})

test('a varied layout reshapes a generated plan and still plays', () => {
  const varied = startScenario({ ...plan(), seed: 9001 }, model, { varyLayout: true })
  const standard = startScenario(plan(), model)
  assert.ok(varied.ok && standard.ok)
  assert.equal(varied.value.scene.map.height, 6, 'seed 9001 keeps the 10 × 4 hall')
  const seed42 = startScenario(plan(), model, { varyLayout: true })
  assert.ok(seed42.ok)
  assert.notDeepEqual(seed42.value.scene.map.rooms, standard.value.scene.map.rooms)
  const sim = new MockSimulation()
  send(sim, { type: 'load', compiled: seed42.value, history: { historyRevision: 0, records: [], outcomes: [] } })
  const frame = lastFrame(send(sim, { type: 'run_to', time: 60 }))
  assert.ok(frame.agents.every((agent) => agent.state === 'departed'), 'everyone still gets out of the reshaped building')
})

test('a scenario the assistant wrote gets a simulation ID of its own, once', async () => {
  const { ownSimulationId } = await import('./ownSimulationId.ts')
  const { scenarios } = await import('./scenario.ts')
  const { readFileSync } = await import('node:fs')
  const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../contract/fixtures/${name}.json`, import.meta.url), 'utf8'))
  const concert = scenarios(fixture('scenario-plan'), fixture('compile-output').resolvedModel).find((s) => s.id === 'concert-floor')!
  // The planner hands plans back under the ID of the scenario they were asked from.
  const written = { ...concert, id: 'assistant-3', title: 'Assistant: check-in at point B' }
  const own = ownSimulationId(written)
  assert.notEqual(own.plan.simulationId, concert.plan.simulationId, 'its runs no longer look like the concert demo’s')
  assert.match(own.plan.simulationId, /^assistant-3-/)
  assert.equal(ownSimulationId(own), own, 'an ID it already has is kept')
})
