import assert from 'node:assert/strict'
import test from 'node:test'
import type { CompiledGoal, CompiledScene, Operation, Result, ScenarioPlan } from '@crowd-control/contract'
import { chainLayout, designPopulation } from '../layout/chain.ts'
import { resolveProfiles } from '../profiles/catalog.ts'
import { placeInitialAgents } from '../spawn/lattice.ts'
import { fixture, workedExample } from '../testing.ts'
import { compileBehaviour, type Behaviour } from './compile.ts'
import { ControllerTable } from './controllers.ts'

function value<T>(result: Result<T>): T {
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) throw new Error('unreachable')
  return result.value
}

/** Runs the pipeline so far on a (possibly edited) worked example. */
function behaviour(edit: (plan: ScenarioPlan) => void = () => {}): Result<Behaviour> {
  const { plan, model } = workedExample()
  edit(plan)
  if (plan.layout.mode !== 'generate') throw new Error('worked example should be generated')
  const { rooms, portals } = value(chainLayout(plan.layout.spaces, plan.layout.connections, designPopulation(plan), model))
  const profiles = value(resolveProfiles(plan, model))
  const agents = value(placeInitialAgents(plan.initialOperations, rooms, profiles, model))
  return compileBehaviour(plan, { rooms, portals, agents })
}

/** Replaces controller names with the goals they stand for, so tests compare structure, not names. */
function inline(scene: Pick<CompiledScene, 'agents' | 'jobs' | 'rules' | 'controllers'>) {
  const goal = (name: string | undefined): CompiledGoal | undefined => (name === undefined ? undefined : scene.controllers[name])
  return {
    agents: scene.agents.map(({ controller, ...agent }) => ({ ...agent, goal: goal(controller) })),
    jobs: scene.jobs.map((job) => ({ ...job, operations: job.operations.map((op) => ('controller' in op ? (({ controller, ...rest }) => ({ ...rest, goal: goal(controller) }))(op) : op)) })),
    rules: scene.rules.map((rule) => ('controller' in rule ? (({ controller, ...rest }) => ({ ...rest, goal: goal(controller) }))(rule) : rule)),
  }
}

const spawn = (count: number, tags: string[], room = 'hall'): Operation => ({ op: 'spawn', template: { kind: 'agent', tags }, count, placement: { inside: { ids: [room] } } })
const assign = (tags: string[], goal: Extract<Operation, { op: 'assign_goal' }>['goal'], mode?: 'replace' | 'enqueue'): Operation => ({ op: 'assign_goal', targets: { tags }, goal, ...(mode && { mode }) })
const wander = (room: string) => ({ kind: 'wander' as const, inside: { ids: [room] } })
const reach = (room: string) => ({ kind: 'reach' as const, target: { ids: [room] } })

test('PRD §8: the worked example compiles to the fixture\'s controllers, jobs and rule', () => {
  const compiled = value(behaviour())
  const expected = fixture<CompiledScene>('compiled-scene')
  assert.deepEqual(inline(compiled), inline(expected))
  assert.deepEqual(Object.keys(compiled.controllers), ['wander-hall', 'reach-hall-then-wander-hall', 'reach-outside'])
})

test('a starting goal only reaches people spawned before it', () => {
  const { agents } = value(behaviour((plan) => {
    plan.initialOperations = [spawn(2, ['guest']), assign(['guest'], wander('hall')), spawn(2, ['guest'])]
  }))
  assert.deepEqual(agents.map((agent) => agent.controller), ['wander-hall', 'wander-hall', undefined, undefined])
})

test('enqueue appends to a starting goal; replace overwrites it', () => {
  const { agents, controllers } = value(behaviour((plan) => {
    plan.initialOperations = [spawn(1, ['a']), spawn(1, ['b']), assign(['a'], reach('foyer')), assign(['b'], reach('foyer')), assign(['a'], wander('hall'), 'enqueue'), assign(['b'], wander('hall'), 'replace')]
  }))
  assert.equal(agents[0]!.controller, 'reach-foyer-then-wander-hall')
  assert.deepEqual(controllers[agents[0]!.controller!], { kind: 'sequence', goals: [{ kind: 'reach', targetZone: 'foyer' }, { kind: 'wander', insideZone: 'hall' }] })
  assert.equal(agents[1]!.controller, 'wander-hall')
})

test('a scheduled goal that starting agents could also match stays a plain operation', () => {
  const { jobs } = value(behaviour((plan) => {
    const late = plan.timeline[0]!
    const op = late.operations[1]!
    if (op.op !== 'assign_goal') throw new Error('fixture changed')
    op.targets = { tags: ['attendee'] } // the starting attendees match this too
  }))
  const [spawned, goal] = jobs[0]!.operations
  assert.ok(spawned && 'zone' in spawned && spawned.controller === undefined)
  assert.equal(goal?.op, 'assign_goal')
})

test('tag and kind targets resolve against the map; one room per wander', () => {
  const { agents } = value(behaviour((plan) => {
    plan.initialOperations = [spawn(1, ['a']), assign(['a'], { kind: 'reach', target: { tags: ['exit'] } })]
  }))
  assert.equal(agents[0]!.controller, 'reach-exit')
  const anyRoom = value(behaviour((plan) => {
    plan.initialOperations = [spawn(1, ['a']), assign(['a'], { kind: 'reach', target: { kind: 'zone' } })]
  }))
  assert.deepEqual(anyRoom.controllers[anyRoom.agents[0]!.controller!], { kind: 'reach', targetIds: ['hall', 'foyer', 'outside'] })
  const ambiguous = behaviour((plan) => {
    plan.initialOperations = [spawn(1, ['a']), assign(['a'], { kind: 'wander', inside: { kind: 'zone' } })]
  })
  assert.equal(ambiguous.ok ? null : ambiguous.error.code, 'AMBIGUOUS_SELECTOR')
})

test('bad goals fail with the path of the problem', () => {
  const missing = behaviour((plan) => { plan.initialOperations = [spawn(1, ['a']), assign(['a'], reach('kitchen'))] })
  assert.deepEqual(missing.ok ? null : [missing.error.code, missing.error.path], ['NOT_FOUND', 'plan.initialOperations.1.goal.target'])
  const nobody = behaviour((plan) => { plan.initialOperations = [spawn(1, ['a']), assign(['b'], reach('hall'))] })
  assert.deepEqual(nobody.ok ? null : [nobody.error.code, nobody.error.path], ['NOT_FOUND', 'plan.initialOperations.1.targets'])
  const set = behaviour((plan) => { plan.initialOperations = [spawn(1, ['a']), { op: 'set', targets: { tags: ['a'] }, values: { appearance: { fill: '#000000' } } }] })
  assert.equal(set.ok ? null : set.error.code, 'UNSUPPORTED_CAPABILITY')
})

test('rules that are not "on event, assign one goal" pass through as copies', () => {
  let original: ScenarioPlan['rules'][number] | undefined
  const { rules } = value(behaviour((plan) => {
    plan.rules[0]!.operations.push({ op: 'emit', event: { name: 'evacuating' } })
    original = plan.rules[0]
  }))
  assert.deepEqual(rules[0], original)
  assert.notEqual(rules[0], original)
})

test('identical goals share a controller; different goals that read alike get numbered', () => {
  const table = new ControllerTable()
  assert.equal(table.add({ kind: 'reach', targetZone: 'outside' }), 'reach-outside')
  assert.equal(table.add({ kind: 'reach', targetZone: 'outside' }), 'reach-outside')
  assert.equal(table.add({ kind: 'reach', targetZone: 'outside', urgency: 2 }), 'reach-outside-2')
})
