import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { CompileOutput, PlannerRequest, ScenarioPlan } from '@crowd-control/contract'
import { CHANGE_CAPABILITIES, SCENARIO_CAPABILITIES, askPlanner, buildRequest, titleFrom } from './assistant.ts'
import { startScenario } from './scenario.ts'
import { describeOperations } from '../planner/describe.ts'

const fixture = <T>(name: string) => JSON.parse(readFileSync(new URL(`../../../contract/fixtures/${name}.json`, import.meta.url), 'utf8')) as T
const plan = fixture<ScenarioPlan>('scenario-plan')
const model = fixture<CompileOutput>('compile-output').resolvedModel

/** A fake /api/plan that answers with `body` and records what it was sent. */
function server(body: (request: PlannerRequest) => unknown) {
  const sent: PlannerRequest[] = []
  const fetcher = async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body)) as PlannerRequest
    sent.push(request)
    return { json: async () => body(request) }
  }
  return { fetcher, sent }
}

function request(kind: 'scenario' | 'change', extra: Partial<Parameters<typeof buildRequest>[0]> = {}) {
  const built = buildRequest({ simulationId: 'worked-demo', prompt: '  close the exit  ', kind, inventory: [], interventions: [], requestId: 'req-1', ...extra })
  assert.ok(built.ok, JSON.stringify(built))
  return built.value
}

test('a new-scenario request asks for a plan the compiler can build; a change asks within what the simulator accepts', () => {
  const scenario = request('scenario')
  assert.equal(scenario.prompt, 'close the exit')
  assert.deepEqual(scenario.context.capabilities, SCENARIO_CAPABILITIES)
  assert.equal(scenario.context.capabilities.editableHistory, true, 'the planner’s signal for a new scenario')
  const change = request('change', { layout: plan.layout, inventory: [{ id: 'exit', kind: 'portal', tags: ['exit'], componentNames: ['portal'] }] })
  assert.deepEqual(change.context.capabilities, CHANGE_CAPABILITIES)
  assert.equal(change.context.inventory[0]!.id, 'exit', 'the planner sees what is loaded, by real ID')
  assert.deepEqual(change.context.layout, plan.layout)
})

test('a scenario reply becomes a plan that compiles and runs', async () => {
  const { fetcher } = server(() => ({ ok: true, value: { kind: 'scenario', plan } }))
  const outcome = await askPlanner(request('scenario'), 'scenario', fetcher)
  assert.equal(outcome.type, 'scenario')
  if (outcome.type !== 'scenario') return
  assert.equal(startScenario(outcome.plan, model).ok, true)
})

test('a change reply is checked against the request and the simulator’s rules before it can be applied', async () => {
  const close = [{ op: 'set', targets: { ids: ['exit'] }, values: { components: { portal: { open: false } } } }]
  const good = server((r) => ({ ok: true, value: { kind: 'followup', request: { schemaVersion: 1, simulationId: r.simulationId, requestId: r.requestId, label: 'Close the exit', at: 20, operations: close } } }))
  const outcome = await askPlanner(request('change'), 'change', good.fetcher)
  assert.equal(outcome.type, 'change')
  if (outcome.type === 'change') assert.deepEqual([outcome.request.at, outcome.request.label], [20, 'Close the exit'])

  const otherRun = server(() => ({ ok: true, value: { kind: 'followup', request: { schemaVersion: 1, simulationId: 'someone-else', requestId: 'req-1', operations: close } } }))
  const mismatched = await askPlanner(request('change'), 'change', otherRun.fetcher)
  assert.equal(mismatched.type === 'message' && mismatched.tone, 'error', 'a change for another simulation is refused')

  // Live changes can place an object inside a room (a danger), but not draw shapes such as walls.
  const addWall = server((r) => ({ ok: true, value: { kind: 'followup', request: { schemaVersion: 1, simulationId: r.simulationId, requestId: r.requestId, operations: [{ op: 'add', entity: { id: 'wall_1', kind: 'barrier', shape: { kind: 'rectangle', x: 1, y: 1, width: 2, height: 0.5 } } }] } } }))
  const unsupported = await askPlanner(request('change'), 'change', addWall.fetcher)
  assert.equal(unsupported.type, 'message', 'operations the simulator can’t apply live are refused')
  const fire = [
    { op: 'add', entity: { id: 'danger_1', kind: 'object', label: 'Fire', tags: ['hazard'] }, placement: { inside: { ids: ['hall'] } } },
    { op: 'assign_goal', targets: { kind: 'agent', inside: { ids: ['hall'] } }, goal: { kind: 'avoid', target: { ids: ['danger_1'] }, distance: 6 } },
  ]
  const addFire = server((r) => ({ ok: true, value: { kind: 'followup', request: { schemaVersion: 1, simulationId: r.simulationId, requestId: r.requestId, operations: fire } } }))
  const danger = await askPlanner(request('change'), 'change', addFire.fetcher)
  assert.equal(danger.type, 'change', 'a danger placed in a room, and people avoiding it, is accepted')
  if (danger.type === 'change') assert.deepEqual(describeOperations(danger.request.operations, []), ['Place a danger in hall', 'Have everyone in hall keep away from danger 1'])
})

test('a reply of the wrong kind is explained instead of applied', async () => {
  const scenarioForChange = server(() => ({ ok: true, value: { kind: 'scenario', plan } }))
  const outcome = await askPlanner(request('change'), 'change', scenarioForChange.fetcher)
  assert.ok(outcome.type === 'message' && /New scenario/.test(outcome.text))
})

test('questions and answers from the planner are shown as text', async () => {
  const question = server(() => ({ ok: true, value: { kind: 'clarification', message: 'Which door do you mean?' } }))
  const outcome = await askPlanner(request('change'), 'change', question.fetcher)
  assert.deepEqual(outcome, { type: 'message', tone: 'info', text: 'Which door do you mean?' })
})

test('server problems become a clear message, not a crash', async () => {
  const unconfigured = server(() => ({ ok: false, error: { code: 'PLANNER_UNAVAILABLE', message: 'Planner is not configured. Set GEMINI_API_KEY.', retryable: false } }))
  const notConfigured = await askPlanner(request('scenario'), 'scenario', unconfigured.fetcher)
  assert.ok(notConfigured.type === 'message' && /GEMINI_API_KEY/.test(notConfigured.text))
  const offline = await askPlanner(request('scenario'), 'scenario', async () => { throw new TypeError('fetch failed') })
  assert.ok(offline.type === 'message' && /npm run dev:server/.test(offline.text))
  const garbage = server(() => ({ nonsense: true }))
  const unreadable = await askPlanner(request('scenario'), 'scenario', garbage.fetcher)
  assert.ok(unreadable.type === 'message' && unreadable.tone === 'error')
})

test('scenario titles come from the person’s words, kept short', () => {
  assert.equal(titleFrom('  Fire drill   at noon '), 'Fire drill at noon')
  assert.ok(titleFrom('a'.repeat(80)).length <= 40)
})

test('changes can be asked for on prepared venues and uploaded plans, not just generated buildings', () => {
  for (const layout of [
    { mode: 'lookup' as const, venue: 'Hillside Alley', floor: 'Street level' },
    { mode: 'upload' as const, assetId: 'upload-abc', page: 1 },
  ]) {
    const built = buildRequest({ simulationId: 'venue-demo', prompt: 'Close the alley head', kind: 'change', layout, inventory: [], interventions: [] })
    assert.equal(built.ok, true, `${layout.mode}: ${JSON.stringify(built)}`)
  }
})

test('new scenarios can be set in any prepared venue, with its real rooms and doors', async () => {
  const { venueOptions } = await import('./scenario.ts')
  const venues = venueOptions()
  assert.deepEqual(venues.map((v) => v.name), ['Hillside Alley', 'Riverside School', 'Harbour Concert Hall', 'Hackathon Hall'])
  const alley = venues[0]!
  assert.deepEqual(alley.layout, { mode: 'lookup', venue: 'Hillside Alley', floor: 'Street level' })
  assert.ok(alley.inventory.some((item) => item.id === 'alley_head' && item.kind === 'portal' && item.label === 'Alley head'))
  assert.ok(alley.inventory.every((item) => item.kind === 'zone' || item.kind === 'portal'), 'rooms and doors only, no people')
})

test('previews name doors and rooms the way the plan does', async () => {
  const { describeOperations } = await import('../planner/describe.ts')
  const inventory = [{ id: 'alley_head', kind: 'portal' as const, label: 'Alley head', tags: [], componentNames: ['portal'] }]
  const close = { op: 'set' as const, targets: { ids: ['alley_head'] }, values: { components: { portal: { open: false } } } }
  assert.deepEqual(describeOperations([close], inventory), ['Close Alley head'])
  assert.deepEqual(describeOperations([close], []), ['Close alley head'], 'without a label, the ID reads as words')
})

test('each scenario keeps its own conversation, and they and the assistant’s scenarios survive a reload', async () => {
  const { loadAssistant, loadThread, saveThread, saveScenarios } = await import('./assistantStore.ts')
  const memory = new Map<string, string>()
  const global = globalThis as unknown as { localStorage?: unknown }
  global.localStorage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => { memory.set(k, v) } }
  try {
    const change = { schemaVersion: 1 as const, simulationId: 's', requestId: 'r', operations: [{ op: 'set' as const, targets: { ids: ['exit'] }, values: { components: { portal: { open: false } } } }] }
    saveThread('concert-floor', [
      { id: 1, from: 'you', text: 'close the exit', kind: 'change' },
      { id: 2, from: 'assistant', change, prompt: 'close the exit', inventory: [], status: 'applied' },
    ])
    saveThread('school-wing', [{ id: 1, from: 'you', text: 'sound the alarm', kind: 'change' }])
    saveScenarios([{ id: 'assistant-1', title: 'Assistant: drill', plan, model }])
    assert.equal(loadThread('concert-floor').length, 2)
    assert.deepEqual(loadThread('school-wing').map((m) => 'text' in m && m.text), ['sound the alarm'], 'another scenario has its own conversation')
    assert.deepEqual(loadThread('hackathon-hall'), [], 'a scenario never chatted about starts empty')
    assert.equal(loadAssistant().scenarios[0]!.id, 'assistant-1', 'saving conversations kept the scenarios, and the other way round')
    const applied = loadThread('concert-floor')[1]!
    assert.ok('change' in applied && applied.note === 'Applied in an earlier run.', 'a change from before the reload is marked as belonging to that run')
    saveThread('concert-floor', [])
    assert.deepEqual(loadThread('concert-floor'), [], 'starting over clears only this scenario')
    assert.equal(loadThread('school-wing').length, 1)
    saveThread('school-wing', Array.from({ length: 100 }, (_, k) => ({ id: k, from: 'you' as const, text: `m${k}`, kind: 'change' as const })))
    assert.equal(loadThread('school-wing').length, 60, 'only the most recent messages are kept')
    memory.set('crowd-control:assistant', JSON.stringify({ messages: [{ id: 1, from: 'you', text: 'old', kind: 'change' }], scenarios: [] }))
    assert.deepEqual(loadAssistant(), { threads: {}, scenarios: [] }, 'the old shared conversation is left behind')
  } finally {
    delete global.localStorage
  }
  assert.deepEqual(loadAssistant(), { threads: {}, scenarios: [] }, 'without storage it simply starts fresh')
})

test('wider live changes are allowed and read as plain English', async () => {
  const { describeOperations } = await import('../planner/describe.ts')
  const inventory = [
    { id: 'outside', kind: 'zone' as const, label: 'Outside', tags: ['outside'], componentNames: [] },
    { id: 'main_door', kind: 'portal' as const, label: 'Main door', tags: [], componentNames: ['portal'] },
  ]
  const operations = [
    { op: 'emit' as const, event: { name: 'alarm' } },
    { op: 'assign_goal' as const, targets: { kind: 'agent' as const }, goal: { kind: 'reach' as const, target: { ids: ['outside'] } } },
    { op: 'assign_goal' as const, targets: { tags: ['late'] }, goal: { kind: 'sequence' as const, goals: [{ kind: 'wait' as const, duration: 10 }, { kind: 'reach' as const, target: { ids: ['outside'] } }] } },
    { op: 'define_rule' as const, id: 'shut', when: { kind: 'event' as const, name: 'alarm' }, once: true, operations: [{ op: 'set' as const, targets: { ids: ['main_door'] }, values: { components: { portal: { open: false } } } }] },
    { op: 'clear_goal' as const, targets: { tags: ['staff'] } },
  ]
  assert.deepEqual(describeOperations(operations, inventory), [
    'Sound the alarm',
    'Send everyone to Outside',
    'Have people tagged late wait 10 s, then go to Outside',
    'When the alarm sounds: Close Main door',
    'Stop people tagged staff from what they are doing',
  ])
  const close = { op: 'set' as const, targets: { ids: ['main_door'] }, values: { components: { portal: { open: false } } } }
  const evacuate = server((r) => ({ ok: true, value: { kind: 'followup', request: { schemaVersion: 1, simulationId: r.simulationId, requestId: r.requestId, operations: [...operations, close] } } }))
  const outcome = await askPlanner(request('change'), 'change', evacuate.fetcher)
  assert.equal(outcome.type, 'change', JSON.stringify(outcome))
})

test('goal targets chosen by tag become the explicit IDs the engine needs; who stays as written', async () => {
  const { pinGoalTargets, explainRefusal } = await import('./assistant.ts')
  const inventory = [
    { id: 'street_exit_west', kind: 'portal' as const, label: 'West street exit', tags: ['exit'], componentNames: ['portal'] },
    { id: 'street_exit_east', kind: 'portal' as const, label: 'East street exit', tags: ['exit'], componentNames: ['portal'] },
    { id: 'foyer', kind: 'zone' as const, label: 'Foyer', tags: [], componentNames: [] },
    { id: 'a1', kind: 'agent' as const, tags: ['exit'], componentNames: [] },
  ]
  const toExits = { op: 'assign_goal' as const, targets: { tags: ['audience'] }, goal: { kind: 'reach' as const, target: { tags: ['exit'] }, selection: 'nearest' as const } }
  const request = {
    schemaVersion: 1 as const, simulationId: 's', requestId: 'r',
    operations: [
      toExits,
      { op: 'schedule' as const, id: 'later', at: 30, operations: [toExits] },
      { op: 'assign_goal' as const, targets: { kind: 'agent' as const }, goal: { kind: 'reach' as const, target: { ids: ['foyer'] } } },
      { op: 'assign_goal' as const, targets: { kind: 'agent' as const }, goal: { kind: 'reach' as const, target: { tags: ['nowhere'] } } },
    ],
  }
  const pinned = pinGoalTargets(request, inventory).operations
  const target = (o: (typeof pinned)[number]) => (o.op === 'assign_goal' && o.goal.kind === 'reach' ? o.goal.target : null)
  assert.deepEqual(target(pinned[0]!), { ids: ['street_exit_west', 'street_exit_east'] }, 'the exits, not the person also tagged exit')
  assert.deepEqual(pinned[0]!.op === 'assign_goal' && pinned[0]!.targets, { tags: ['audience'], kind: 'agent' }, 'who it applies to stays a live tag, limited to people (the concert floor zone is also tagged audience)')
  const later = pinned[1]!
  assert.ok(later.op === 'schedule' && later.operations[0]!.op === 'assign_goal' && 'ids' in (later.operations[0]!.goal as { target: object }).target, 'scheduled goals are pinned too')
  assert.deepEqual(target(pinned[2]!), { ids: ['foyer'] }, 'explicit IDs are left alone')
  assert.deepEqual(target(pinned[3]!), { tags: ['nowhere'] }, 'a tag matching nothing is left for the simulator to report')
  assert.match(explainRefusal('Selector matched no agents'), /Nobody matches that right now/)
})

test('a sign-in refusal from the server is shown as it is, not as an unreadable reply', async () => {
  const gate = server(() => ({ ok: false, error: 'A valid Auth0 access token is required.' }))
  const outcome = await askPlanner(request('change'), 'change', gate.fetcher)
  assert.deepEqual(outcome, { type: 'message', tone: 'error', text: 'The assistant is unavailable: A valid Auth0 access token is required.' })
})
