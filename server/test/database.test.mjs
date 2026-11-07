import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getRunAnalytics,
  initializeDatabase,
  saveIntervention,
  saveMetricBatch,
  saveRun,
} from '../dist/database.js'

function fakePool() {
  const calls = []
  return {
    calls,
    async query(text, values) {
      calls.push({ text, values })
      if (text.includes('SELECT started_at')) {
        return { rowCount: 1, rows: [{ started_at: new Date('2026-01-01T00:00:00Z') }] }
      }
      if (text.includes('SELECT 1 FROM crowd_runs')) {
        return { rowCount: 1, rows: [{ '?column?': 1 }] }
      }
      return { rowCount: 1, rows: [] }
    },
  }
}

const metricSample = {
  time: 0,
  present: 1,
  departed: 0,
  blocked: 0,
  immobile: 0,
  removed: 0,
  zones: [],
  portals: [],
  queues: [],
  clearance: { t50: null, t90: null, t100: null },
}

test('initializes runs, metrics hypertable, and intervention tables', async () => {
  const pool = fakePool()

  await initializeDatabase(pool)

  assert.equal(pool.calls.length, 4)
  assert.match(pool.calls[2].text, /create_hypertable/)
  assert.match(pool.calls[2].text, /sampled_at/)
  assert.match(pool.calls[3].text, /crowd_interventions/)
})

test('validates and stores run records without overwriting existing runs', async () => {
  const pool = fakePool()
  const run = {
    runId: '37c6729d-9e21-4c8f-a414-fdbf8c56d66c',
    simulationId: 'worked-demo',
    startedAt: '2026-01-01T00:00:00.000Z',
  }

  assert.equal(await saveRun(pool, run), true)
  assert.equal(await saveRun(pool, { ...run, runId: 'not-a-uuid' }), false)
  assert.match(pool.calls[0].text, /ON CONFLICT \(run_id\) DO NOTHING/)
  assert.deepEqual(pool.calls[0].values, [run.runId, run.simulationId, run.startedAt])
})

test('stores validated metrics in an idempotent time-series batch', async () => {
  const pool = fakePool()
  const runId = '37c6729d-9e21-4c8f-a414-fdbf8c56d66c'

  assert.equal(await saveMetricBatch(pool, runId, { simulationId: 'worked-demo', samples: [metricSample] }), 'saved')
  assert.equal(await saveMetricBatch(pool, runId, { simulationId: 'worked-demo', samples: [{ ...metricSample, time: -1 }] }), 'invalid')
  assert.match(pool.calls[1].text, /jsonb_to_recordset/)
  assert.match(pool.calls[1].text, /ON CONFLICT \(run_id, sampled_at\) DO NOTHING/)
  assert.equal(JSON.parse(pool.calls[1].values[1])[0].present, 1)
})

test('stores an intervention only when it matches the worker acknowledgement', async () => {
  const pool = fakePool()
  const runId = '37c6729d-9e21-4c8f-a414-fdbf8c56d66c'
  const input = {
    simulationId: 'worked-demo',
    prompt: 'Close the hall door.',
    request: {
      schemaVersion: 1,
      simulationId: 'worked-demo',
      requestId: 'request-close-door',
      operations: [{
        op: 'set',
        targets: { ids: ['hall_door'] },
        values: { components: { portal: { open: false } } },
      }],
    },
    acknowledgement: {
      requestId: 'request-close-door',
      interventionId: 'intervention-1',
      revision: 1,
      at: 0,
      historyRevision: 1,
    },
    recordedAt: '2026-01-01T00:00:01.000Z',
  }

  assert.equal(await saveIntervention(pool, runId, input), 'saved')
  assert.equal(await saveIntervention(pool, runId, {
    ...input,
    acknowledgement: { ...input.acknowledgement, requestId: 'different-request' },
  }), 'invalid')
  assert.match(pool.calls[1].text, /ON CONFLICT \(run_id, request_id\) DO NOTHING/)
})

test('returns peak zone density and intervention comparisons for a run', async () => {
  const runId = '37c6729d-9e21-4c8f-a414-fdbf8c56d66c'
  const calls = []
  const pool = {
    async query(text, values) {
      calls.push({ text, values })
      if (text.includes('SELECT 1 FROM crowd_runs')) {
        return { rowCount: 1, rows: [{ '?column?': 1 }] }
      }
      if (text.includes('COUNT(*)::integer')) {
        return { rowCount: 1, rows: [{ sample_count: 21 }] }
      }
      if (text.includes('DISTINCT ON (zone_id)')) {
        return { rowCount: 1, rows: [{ zone_id: 'hall', peak_density: 2.5, at: 12 }] }
      }
      if (text.includes('FROM crowd_interventions')) {
        return {
          rowCount: 1,
          rows: [{
            requestId: 'request-close-door',
            prompt: 'Close the hall door.',
            at: 10,
            comparisons: [{
              zoneId: 'hall',
              beforeDensity: 1.2,
              afterDensity: 0.8,
              beforeSamples: 10,
              afterSamples: 10,
            }],
          }],
        }
      }
      throw new Error('Unexpected analytics query')
    },
  }

  assert.deepEqual(await getRunAnalytics(pool, runId), {
    runId,
    sampleCount: 21,
    peakDensityByZone: [{ zoneId: 'hall', peakDensity: 2.5, at: 12 }],
    interventions: [{
      requestId: 'request-close-door',
      prompt: 'Close the hall door.',
      at: 10,
      comparisons: [{
        zoneId: 'hall',
        beforeDensity: 1.2,
        afterDensity: 0.8,
        beforeSamples: 10,
        afterSamples: 10,
      }],
    }],
  })
  assert.equal(calls.length, 4)
  assert.ok(calls.every((call) => call.values[0] === runId))
  assert.match(calls[2].text, /DISTINCT ON \(zone_id\)/)
  assert.match(calls[2].text, /jsonb_array_elements/)
  assert.match(calls[3].text, /GREATEST\(intervention\.at - 10, 0\)/)
  assert.match(calls[3].text, /intervention\.at \+ 10/)
})

test('rejects invalid analytics run IDs and returns null for missing runs', async () => {
  const calls = []
  const pool = {
    async query(text, values) {
      calls.push({ text, values })
      return { rowCount: 0, rows: [] }
    },
  }

  assert.equal(await getRunAnalytics(pool, 'not-a-uuid'), 'invalid')
  assert.equal(calls.length, 0)
  assert.equal(await getRunAnalytics(pool, '37c6729d-9e21-4c8f-a414-fdbf8c56d66c'), null)
  assert.equal(calls.length, 1)
})
