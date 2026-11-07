import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentProfileSchema, type Operation, type Result } from '@crowd-control/contract'
import { fixture, workedExample } from '../testing.ts'
import { resolveProfiles } from './catalog.ts'

function value<T>(result: Result<T>): T {
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) throw new Error('unreachable')
  return result.value
}

const spawn = (profile?: string): Operation => ({ op: 'spawn', template: { kind: 'agent', ...(profile && { profile }) }, count: 1, placement: { inside: { ids: ['hall'] } } })

test('the worked example resolves to exactly the person profile in the compiled fixture', () => {
  const { plan, model } = workedExample()
  const expected = fixture<{ profiles: unknown }>('compiled-scene').profiles
  assert.deepEqual(value(resolveProfiles(plan, model)), expected)
})

test('profiles named in timeline jobs and rule actions are resolved too, in catalog order', () => {
  const { plan, model } = workedExample()
  plan.initialOperations = []
  plan.timeline = [{ op: 'schedule', id: 'later', at: 5, operations: [spawn('slow-walker')] }]
  plan.rules = [{ op: 'define_rule', id: 'r', when: { kind: 'event', name: 'alarm' }, once: true, operations: [spawn()] }]
  assert.deepEqual(Object.keys(value(resolveProfiles(plan, model))), ['person', 'slow-walker'])
})

test('every catalog profile is valid, derived from the preset, and slower walkers are slower', () => {
  const { plan, model } = workedExample()
  plan.initialOperations = [spawn('person'), spawn('slow-walker')]
  const profiles = value(resolveProfiles(plan, model))
  for (const profile of Object.values(profiles)) assert.equal(AgentProfileSchema.safeParse(profile).success, true)
  assert.equal(profiles.person!.radius, model.defaultAgent.physical.radius)
  assert.ok(profiles['slow-walker']!.preferredSpeed < profiles.person!.preferredSpeed)
})

test('scenes never share profile objects', () => {
  const { plan, model } = workedExample()
  const a = value(resolveProfiles(plan, model))
  const b = value(resolveProfiles(plan, model))
  assert.notEqual(a.person, b.person)
  assert.notEqual(a.person!.appearance, b.person!.appearance)
})

test('an unknown profile fails with the path of the spawn that named it', () => {
  const { plan, model } = workedExample()
  plan.timeline = [{ op: 'schedule', id: 'later', at: 5, operations: [spawn('giant')] }]
  const result = resolveProfiles(plan, model)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.error.code, 'NOT_FOUND')
  assert.equal(result.error.path, 'plan.timeline.0.operations.0.template.profile')
  assert.match(result.error.message, /person, slow-walker/)
})
