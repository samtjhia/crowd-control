import assert from 'node:assert/strict'
import test from 'node:test'
import type { Operation, ScenarioPlan } from '@crowd-control/contract'
import { spreadOverDesks } from './spread.ts'

const desks = ['checkin_b', 'checkin_d', 'checkin_e'].map((id) => ({ id, kind: 'object', tags: ['checkin'] }))
const plan = (operations: Operation[], timed: Operation[] = []): ScenarioPlan => ({
  schemaVersion: 1, simulationId: 'desks', seed: 1, layout: { mode: 'lookup', venue: 'Hall', floor: 'Main' },
  initialOperations: operations, timeline: timed.length > 0 ? [{ op: 'schedule', id: 'wave1', at: 1, operations: timed }] : [], rules: [],
} as ScenarioPlan)
const spawn = (count: number, tags: string[]): Operation => ({ op: 'spawn', template: { kind: 'agent', tags }, count, placement: { near: { ids: ['exit_3'] }, within: { ids: ['outside'] }, distance: 6 } })
const visit = (tags: string[], target: object): Operation => ({ op: 'assign_goal', targets: { tags }, goal: { kind: 'sequence', goals: [{ kind: 'reach', target: { ids: ['exit_3'] } }, { kind: 'interact', target }, { kind: 'wander', inside: { ids: ['hall'] } }] } } as Operation)

test('a wave sent to three desks is split evenly, each part with its own desk', () => {
  const out = spreadOverDesks(plan([], [spawn(20, ['hacker', 'wave1']), visit(['wave1'], { ids: ['checkin_b', 'checkin_d', 'checkin_e'] })]), desks)
  const ops = (out.timeline[0] as { operations: Operation[] }).operations
  const spawns = ops.filter((o) => o.op === 'spawn') as Extract<Operation, { op: 'spawn' }>[]
  assert.deepEqual(spawns.map((s) => s.count), [7, 7, 6])
  assert.deepEqual(spawns.map((s) => s.template.tags), [['hacker', 'wave1', 'via_checkin_b'], ['hacker', 'wave1', 'via_checkin_d'], ['hacker', 'wave1', 'via_checkin_e']])
  const goals = ops.filter((o) => o.op === 'assign_goal') as Extract<Operation, { op: 'assign_goal' }>[]
  assert.deepEqual(goals.map((g) => (g.targets as { tags: string[] }).tags), [['wave1', 'via_checkin_b'], ['wave1', 'via_checkin_d'], ['wave1', 'via_checkin_e']])
  assert.deepEqual(goals.map((g) => g.goal.kind === 'sequence' && g.goal.goals[1]), [
    { kind: 'interact', target: { ids: ['checkin_b'] } }, { kind: 'interact', target: { ids: ['checkin_d'] } }, { kind: 'interact', target: { ids: ['checkin_e'] } },
  ])
})

test('desks named by tag split the starting crowd too; one desk or no desk is left as written', () => {
  const start = spreadOverDesks(plan([spawn(4, ['guest']), visit(['guest'], { tags: ['checkin'] })]), desks)
  assert.deepEqual(start.initialOperations.filter((o) => o.op === 'spawn').map((o) => o.op === 'spawn' && o.count), [2, 1, 1])
  const single = plan([spawn(4, ['guest']), visit(['guest'], { ids: ['checkin_b'] })])
  assert.deepEqual(spreadOverDesks(single, desks), single)
})
