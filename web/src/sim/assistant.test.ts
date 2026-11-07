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
