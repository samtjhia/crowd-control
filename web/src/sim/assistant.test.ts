import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { CompileOutput, PlannerRequest, ScenarioPlan } from '@crowd-control/contract'
import { CHANGE_CAPABILITIES, SCENARIO_CAPABILITIES, askPlanner, buildRequest, titleFrom } from './assistant.ts'
import { startScenario } from './scenario.ts'

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

  const remove = server((r) => ({ ok: true, value: { kind: 'followup', request: { schemaVersion: 1, simulationId: r.simulationId, requestId: r.requestId, operations: [{ op: 'remove', targets: { ids: ['exit'] } }] } } }))
  const unsupported = await askPlanner(request('change'), 'change', remove.fetcher)
  assert.equal(unsupported.type, 'message', 'operations the simulator can’t apply live are refused')
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

test('the conversation and the assistant’s scenarios survive a reload', async () => {
  const { loadAssistant, saveMessages, saveScenarios } = await import('./assistantStore.ts')
  const memory = new Map<string, string>()
  const global = globalThis as unknown as { localStorage?: unknown }
  global.localStorage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => { memory.set(k, v) } }
  try {
    const change = { schemaVersion: 1 as const, simulationId: 's', requestId: 'r', operations: [{ op: 'set' as const, targets: { ids: ['exit'] }, values: { components: { portal: { open: false } } } }] }
    saveMessages([
      { id: 1, from: 'you', text: 'close the exit', kind: 'change' },
      { id: 2, from: 'assistant', change, prompt: 'close the exit', inventory: [], status: 'applied' },
    ])
    saveScenarios([{ id: 'assistant-1', title: 'Assistant: drill', plan, model }])
    const restored = loadAssistant()
    assert.equal(restored.messages.length, 2)
    assert.equal(restored.scenarios[0]!.id, 'assistant-1', 'saving messages kept the scenarios, and the other way round')
    const applied = restored.messages[1]!
    assert.ok('change' in applied && applied.note === 'Applied in an earlier run.', 'a change from before the reload is marked as belonging to that run')
    saveMessages(Array.from({ length: 100 }, (_, k) => ({ id: k, from: 'you' as const, text: `m${k}`, kind: 'change' as const })))
    assert.equal(loadAssistant().messages.length, 60, 'only the most recent messages are kept')
  } finally {
    delete global.localStorage
  }
  assert.deepEqual(loadAssistant(), { messages: [], scenarios: [] }, 'without storage it simply starts fresh')
})
