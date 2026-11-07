import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createGeminiPlanner } from '../dist/planner.js'

const plan = JSON.parse(readFileSync(new URL('../../contract/fixtures/scenario-plan.json', import.meta.url), 'utf8'))
const request = {
  schemaVersion: 1,
  simulationId: plan.simulationId,
  requestId: 'planner-request',
  prompt: 'Create a sample scenario.',
  context: {
    capabilities: {
      operations: ['add', 'spawn', 'remove', 'set', 'assign_goal', 'clear_goal', 'schedule', 'define_rule', 'remove_rule', 'emit'],
      goals: ['reach', 'avoid', 'wait', 'wander', 'follow', 'queue', 'interact', 'sequence'],
      geometry: ['rectangle', 'circle', 'polygon', 'thick_line'],
      layouts: ['generate', 'upload', 'lookup'],
      entityMetrics: ['contactLoadRatio'],
      editableHistory: true,
    },
    inventory: [],
    interventions: [],
  },
}

function geminiResponse(value, status = 200) {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }],
  }), { status, headers: { 'Content-Type': 'application/json' } })
}

test('requires server credentials without making a provider request', async () => {
  let called = false
  const planRequest = createGeminiPlanner({ fetcher: async () => { called = true; return geminiResponse({}) } })
  const result = await planRequest(request)

  assert.equal(result.ok, false)
  assert.match(result.error.message, /GEMINI_API_KEY and GEMINI_MODEL/)
  assert.equal(called, false)
})

test('sends prompts to Gemini and returns only a contract-valid planner reply', async () => {
  let providerUrl = ''
  let providerInit
  const planRequest = createGeminiPlanner({
    apiKey: 'server-only-key',
    model: 'gemini-test',
    fetcher: async (url, init) => {
      providerUrl = String(url)
      providerInit = init
      return geminiResponse({ kind: 'scenario', plan })
    },
  })

  const result = await planRequest(request)

  assert.equal(result.ok, true)
  assert.equal(result.value.kind, 'scenario')
  assert.match(providerUrl, /models\/gemini-test:generateContent$/)
  assert.equal(providerInit.headers['x-goog-api-key'], 'server-only-key')
  assert.equal(providerInit.headers['Content-Type'], 'application/json')
  assert.equal(JSON.parse(providerInit.body).generationConfig.responseMimeType, 'application/json')
})

test('returns a follow-up intervention for a loaded mock simulation', async () => {
  const followupRequest = {
    ...request,
    context: {
      ...request.context,
      capabilities: {
        operations: ['spawn', 'set', 'schedule'],
        goals: [],
        geometry: [],
        layouts: ['generate'],
        entityMetrics: [],
        editableHistory: false,
      },
      inventory: [{ id: 'hall_door', kind: 'portal', tags: [], componentNames: ['portal'] }],
    },
  }
  const followup = {
    kind: 'followup',
    request: {
      schemaVersion: 1,
      simulationId: request.simulationId,
      requestId: request.requestId,
      label: 'Close hall door',
      operations: [{
        op: 'set',
        targets: { ids: ['hall_door'] },
        values: { components: { portal: { open: false } } },
      }],
    },
  }
  let promptText = ''
  const planRequest = createGeminiPlanner({
    apiKey: 'server-only-key',
    model: 'gemini-test',
    fetcher: async (_url, init) => {
      promptText = JSON.parse(init.body).contents[0].parts[0].text
      return geminiResponse(followup)
    },
  })

  const result = await planRequest(followupRequest)

  assert.equal(result.ok, true)
  assert.deepEqual(result.value, followup)
  assert.match(promptText, /FOLLOW-UP to the already-loaded simulation/)
})

test('allows follow-up arrivals to spawn inside an inventoried zone', async () => {
  const followupRequest = {
    ...request,
    prompt: 'Send 3 more people from the foyer.',
    context: {
      ...request.context,
      capabilities: {
        operations: ['spawn', 'set', 'schedule'],
        goals: [],
        geometry: [],
        layouts: ['generate'],
        entityMetrics: [],
        editableHistory: false,
      },
      inventory: [{ id: 'foyer', kind: 'zone', label: 'Foyer', tags: [], componentNames: [] }],
    },
  }
  const followup = {
    kind: 'followup',
    request: {
      schemaVersion: 1,
      simulationId: request.simulationId,
      requestId: request.requestId,
      label: 'Add 3 people from the foyer',
      operations: [{
        op: 'spawn',
        template: { kind: 'agent', tags: ['attendee'] },
        count: 3,
        placement: { inside: { ids: ['foyer'] } },
      }],
    },
  }
  const planRequest = createGeminiPlanner({
    apiKey: 'server-only-key',
    model: 'gemini-test',
    fetcher: async () => geminiResponse(followup),
  })

  const result = await planRequest(followupRequest)

  assert.equal(result.ok, true)
  assert.deepEqual(result.value, followup)
})

test('corrects a follow-up reply when a new scenario was requested', async () => {
  const unexpectedFollowup = {
    kind: 'followup',
    request: {
      schemaVersion: 1,
      simulationId: request.simulationId,
      requestId: request.requestId,
      operations: [{
        op: 'set',
        targets: { ids: ['hall_door'] },
        values: { components: { portal: { open: false } } },
      }],
    },
  }
  let calls = 0
  let correctionPrompt = ''
  const planRequest = createGeminiPlanner({
    apiKey: 'server-only-key',
    model: 'gemini-test',
    fetcher: async (_url, init) => {
      calls++
      const currentPrompt = JSON.parse(init.body).contents[0].parts[0].text
      if (calls === 1) return geminiResponse(unexpectedFollowup)
      correctionPrompt = currentPrompt
      return geminiResponse({ kind: 'scenario', plan })
    },
  })

  const result = await planRequest(request)

  assert.equal(result.ok, true)
  assert.equal(result.value.kind, 'scenario')
  assert.equal(calls, 2)
  assert.match(correctionPrompt, /requires kind "scenario"/)
})

test('rejects invalid model output and never returns it as a plan', async () => {
  let calls = 0
  const planRequest = createGeminiPlanner({
    apiKey: 'server-only-key',
    model: 'gemini-test',
    fetcher: async () => {
      calls++
      return geminiResponse({ kind: 'scenario', plan: { ...plan, initialOperations: [{ op: 'execute_arbitrary_code' }] } })
    },
  })

  const result = await planRequest(request)

  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'PLANNER_UNAVAILABLE')
  assert.match(result.error.message, /did not pass planner validation after one correction attempt/)
  assert.equal(calls, 2)
})

test('corrects a generated layout after returning the contract error to Gemini', async () => {
  const invalidPlan = structuredClone(plan)
  invalidPlan.layout.connections[0].connects = ['hall', 'outside']
  let calls = 0
  let correctionPrompt = ''
  const planRequest = createGeminiPlanner({
    apiKey: 'server-only-key',
    model: 'gemini-test',
    fetcher: async (_url, init) => {
      calls++
      const currentPrompt = JSON.parse(init.body).contents[0].parts[0].text
      if (calls === 1) return geminiResponse({ kind: 'scenario', plan: invalidPlan })
      correctionPrompt = currentPrompt
      return geminiResponse({ kind: 'scenario', plan })
    },
  })

  const result = await planRequest(request)

  assert.equal(result.ok, true)
  assert.equal(result.value.kind, 'scenario')
  assert.equal(calls, 2)
  assert.match(correctionPrompt, /failed validation: Baseline generated layout/)
  assert.match(correctionPrompt, /spaces\[i\]\.id to spaces\[i \+ 1\]\.id/)
})

test('reports Gemini quota and rate limits distinctly', async () => {
  const planRequest = createGeminiPlanner({
    apiKey: 'server-only-key',
    model: 'gemini-test',
    fetcher: async () => new Response('{}', { status: 429 }),
  })

  const result = await planRequest(request)

  assert.equal(result.ok, false)
  assert.equal(result.error.retryable, true)
  assert.match(result.error.message, /rate limit or quota.*429/)
})

test('reports provider failures with their HTTP status', async () => {
  const planRequest = createGeminiPlanner({
    apiKey: 'server-only-key',
    model: 'gemini-test',
    fetcher: async () => new Response('{}', { status: 503 }),
  })

  const result = await planRequest(request)

  assert.equal(result.ok, false)
  assert.equal(result.error.retryable, true)
  assert.match(result.error.message, /service error \(HTTP 503\)/)
})
