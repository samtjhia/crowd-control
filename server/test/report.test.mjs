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
