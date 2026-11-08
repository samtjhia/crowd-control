import assert from 'node:assert/strict'
import test from 'node:test'
import { deleteRun, getRunFacts } from '../dist/database.js'
import { createReportWriter } from '../dist/report.js'

const runId = '37c6729d-9e21-4c8f-a414-fdbf8c56d66c'

test('a run is deleted with its measurements and changes, only by its owner', async () => {
  const calls = []
  const pool = (owned) => ({
    async query(text, values) {
      calls.push({ text, values })
      if (text.startsWith('SELECT 1 FROM crowd_runs')) return { rowCount: owned ? 1 : 0, rows: [] }
      return { rowCount: 1, rows: [] }
    },
  })
  assert.equal(await deleteRun(pool(true), 'auth0|me', runId), true)
  assert.deepEqual(calls.map((c) => c.text.split(' ').slice(0, 3).join(' ')), ['SELECT 1 FROM', 'DELETE FROM crowd_metric_samples', 'DELETE FROM crowd_interventions', 'DELETE FROM crowd_runs'])
  assert.deepEqual(calls.at(-1).values, [runId, 'auth0|me'])
  calls.length = 0
  assert.equal(await deleteRun(pool(false), 'auth0|someone', runId), false, 'someone else’s run is left alone')
  assert.equal(calls.length, 1, 'nothing is deleted when the run isn’t theirs')
  assert.equal(await deleteRun(pool(true), 'auth0|me', 'nope'), 'invalid')
})

test('the report is written from the run’s measured facts', async () => {
  const pool = {
    async query(text) {
      if (text.startsWith('SELECT 1 FROM crowd_runs')) return { rowCount: 1, rows: [] }
      if (text.includes('COUNT(*)::integer AS sample_count')) return { rowCount: 1, rows: [{ sample_count: 40 }] }
      if (text.includes('title, started_at')) return { rowCount: 1, rows: [{ simulationId: 'concert-floor-demo', title: 'Concert evacuation', startedAt: new Date('2026-11-07T18:00:00Z') }] }
      if (text.includes('ORDER BY simulation_time')) return { rowCount: 3, rows: [{ time: 30, present: 400, departed: 0, immobile: 0, clearance: { t50: null, t90: null, t100: null } }, { time: 61, present: 200, departed: 200, immobile: 0, clearance: { t50: null, t90: null, t100: null } }, { time: 120, present: 0, departed: 400, immobile: 0, clearance: { t50: null, t90: null, t100: null } }] }
      return { rowCount: 0, rows: [] }
    },
  }
  const facts = await getRunFacts(pool, 'auth0|me', runId, 'people/m²')
  assert.equal(facts.scenario, 'Concert evacuation')
  assert.equal(facts.measuredSeconds, 120)
  assert.deepEqual(facts.end.clearance, { t50: 61, t90: 120, t100: 120 }, 'clearance times come from the departure counts when not recorded')

  const report = { title: 'Concert evacuation', summary: 'Most people left within 1:28.', findings: [{ heading: 'Foyer crowded', detail: 'Peak 3.9 people/m² at 1:01.', severity: 'high', where: 'Foyer', when: '1:01' }], recommendations: ['Open the east exit earlier.'], caveats: ['Simulated planning estimate, not certified safety advice.'] }
  const prompts = []
  const reply = (body) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] }) })
  let first = true
  const fetcher = async (_url, init) => {
    prompts.push(JSON.parse(init.body).contents[0].parts[0].text)
    if (first) { first = false; return reply({ title: 'missing the rest' }) }
    return reply(report)
  }
  const write = createReportWriter({ apiKey: 'key', model: 'model', fetcher })
  assert.deepEqual(await write(facts), { ok: true, value: report })
  assert.match(prompts[0], /Use ONLY the facts below/)
  assert.match(prompts[0], /"scenario":"Concert evacuation"/)
  assert.match(prompts[1], /Your previous reply was not valid/, 'an invalid report is sent back once')
  const unset = await createReportWriter({})(facts)
  assert.equal(unset.ok, false)
})

test('a written report is kept with its run and read back without writing it again', async () => {
  const { getSavedReport, saveReport } = await import('../dist/database.js')
  const calls = []
  let stored = null
  const pool = {
    async query(text, values) {
      calls.push({ text, values })
      if (text.startsWith('UPDATE crowd_runs SET report')) { stored = JSON.parse(values[2]); return { rowCount: 1, rows: [] } }
      if (text.startsWith('SELECT report')) return values[1] === 'auth0|me' ? { rowCount: 1, rows: [{ report: stored }] } : { rowCount: 0, rows: [] }
      return { rowCount: 0, rows: [] }
    },
  }
  assert.equal(await getSavedReport(pool, 'auth0|me', runId), 'none', 'no report until one is written')
  await saveReport(pool, 'auth0|me', runId, { title: 'T' }, { scenario: 'S' })
  assert.deepEqual(await getSavedReport(pool, 'auth0|me', runId), { report: { title: 'T' }, facts: { scenario: 'S' } })
  assert.equal(await getSavedReport(pool, 'auth0|other', runId), null, 'someone else’s run has no report for you')
})

test('findings may only name places and times that are in the facts', async () => {
  const facts = {
    scenario: 'Concert evacuation', startedAt: '2026-11-07T18:00:00.000Z', units: 'people/m²', measuredSeconds: 150, measurements: 300,
    end: { present: 0, departed: 430, immobile: 0, clearance: { t50: 58, t90: 79, t100: 88 } },
    busiest: [{ zoneId: 'foyer', peakDensity: 0.96, at: 58 }, { zoneId: 'street', peakDensity: 0.8, at: 69 }],
    changes: [{ requestId: 'r1', prompt: 'Close the west exit', at: 30, comparisons: [{ zoneId: 'standing_floor', beforeDensity: 1, beforeSamples: 5, afterDensity: 2, afterSamples: 5 }] }],
  }
  const base = { title: 'T', summary: 'S', recommendations: ['R'], caveats: ['Simulated planning estimate, not certified safety advice.'] }
  const grounded = { ...base, findings: [{ heading: 'Foyer busiest', detail: 'd', severity: 'high', where: 'Foyer', when: '0:58' }, { heading: 'Floor after change', detail: 'd', severity: 'medium', where: 'Standing floor', when: '0:30' }] }
  const invented = { ...base, findings: [{ heading: 'Balcony crush', detail: 'd', severity: 'high', where: 'Balcony', when: '2:45' }] }

  const sent = []
  const writer = (replies) => createReportWriter({ apiKey: 'k', model: 'm', fetcher: async (_url, init) => {
    sent.push(JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(replies.shift()) }] } }] }) }
  } })
  assert.deepEqual(await writer([grounded])(facts), { ok: true, value: grounded })
  assert.equal(sent[0].generationConfig.responseSchema.type, 'OBJECT', 'Gemini is held to the report’s shape')
  assert.match(sent[0].contents[0].parts[0].text, /Never describe a density or a time as safe or unsafe/)

  sent.length = 0
  const corrected = await writer([invented, grounded])(facts)
  assert.deepEqual(corrected, { ok: true, value: grounded }, 'a made-up place or time is sent back once')
  assert.match(sent[1].contents[0].parts[0].text, /names a place \(Balcony\) that is not in the facts/)

  const stubborn = await writer([invented, invented])(facts)
  assert.deepEqual(stubborn.value.findings, [{ heading: 'Balcony crush', detail: 'd', severity: 'high' }], 'if it still makes them up, the labels are dropped')
})

test('scenarios save per person under their ID, list back, and delete', async () => {
  const { deleteScenario, listScenarios, saveScenario } = await import('../dist/database.js')
  const plan = { schemaVersion: 1, simulationId: 'assistant-x1-abc', seed: 42, layout: { mode: 'lookup', venue: 'Hall', floor: 'Ground' }, initialOperations: [], timeline: [], rules: [] }
  const model = JSON.parse((await import('node:fs')).readFileSync(new URL('../../contract/fixtures/compile-output.json', import.meta.url), 'utf8')).resolvedModel
  const scenario = { id: 'assistant-x1', title: 'Hacker check-in at point B', plan, model, savedAt: '2026-11-07T12:00:00.000Z' }
  const calls = []
  const pool = { async query(text, values) { calls.push({ text, values }); return text.startsWith('SELECT') ? { rowCount: 1, rows: [{ ...scenario, savedAt: new Date(scenario.savedAt) }] } : { rowCount: 1, rows: [] } } }
  assert.equal(await saveScenario(pool, 'auth0|me', 'assistant-x1', scenario), 'saved')
  assert.match(calls[0].text, /WHERE crowd_scenarios\.saved_at <= EXCLUDED\.saved_at/)
  assert.equal(await saveScenario(pool, 'auth0|me', 'other', scenario), 'invalid')
  assert.deepEqual(await listScenarios(pool, 'auth0|me'), [scenario])
  assert.equal(await deleteScenario(pool, 'auth0|me', 'assistant-x1'), true)
  assert.deepEqual(calls.at(-1).values, ['auth0|me', 'assistant-x1'])
})
