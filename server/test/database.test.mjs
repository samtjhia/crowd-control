import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getOwnedRuns,
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

  assert.equal(pool.calls.length, 7)
  assert.match(pool.calls[1].text, /ADD COLUMN IF NOT EXISTS owner_sub/)
  assert.match(pool.calls[2].text, /crowd_runs_owner_started_at_idx/)
  assert.match(pool.calls[4].text, /create_hypertable/)
  assert.match(pool.calls[4].text, /sampled_at/)
  assert.match(pool.calls[5].text, /crowd_interventions/)
})

test('lists only the authenticated owner’s simulations with saved-data counts', async () => {
  const ownerSub = 'auth0|organizer-1'
  const pool = {
    calls: [],
    async query(text, values) {
      this.calls.push({ text, values })
      return {
        rowCount: 1,
        rows: [{
          runId: '37c6729d-9e21-4c8f-a414-fdbf8c56d66c',
          simulationId: 'worked-demo',
          startedAt: new Date('2026-01-01T00:00:00.000Z'),
          sampleCount: 12,
          interventionCount: 2,
        }],
      }
    },
  }

  assert.deepEqual(await getOwnedRuns(pool, ownerSub), [{
    runId: '37c6729d-9e21-4c8f-a414-fdbf8c56d66c',
    simulationId: 'worked-demo',
    startedAt: '2026-01-01T00:00:00.000Z',
    sampleCount: 12,
    interventionCount: 2,
  }])
  assert.deepEqual(pool.calls[0].values, [ownerSub])
  assert.match(pool.calls[0].text, /WHERE run\.owner_sub = \$1/)
  assert.match(pool.calls[0].text, /ORDER BY run\.started_at DESC/)
  assert.match(pool.calls[0].text, /LIMIT 50/)
})

test('validates and stores run records with their authenticated owner', async () => {
  const pool = fakePool()
  const ownerSub = 'auth0|organizer-1'
  const run = {
    runId: '37c6729d-9e21-4c8f-a414-fdbf8c56d66c',
    simulationId: 'worked-demo',
    startedAt: '2026-01-01T00:00:00.000Z',
  }

  assert.equal(await saveRun(pool, ownerSub, run), true)
  assert.equal(await saveRun(pool, ownerSub, { ...run, runId: 'not-a-uuid' }), false)
  assert.match(pool.calls[0].text, /owner_sub/)
  assert.match(pool.calls[0].text, /WHERE crowd_runs\.owner_sub = EXCLUDED\.owner_sub/)
  assert.deepEqual(pool.calls[0].values, [run.runId, run.simulationId, run.startedAt, ownerSub])
})

test('stores validated metrics in an idempotent time-series batch', async () => {
  const pool = fakePool()
  const runId = '37c6729d-9e21-4c8f-a414-fdbf8c56d66c'
  const ownerSub = 'auth0|organizer-1'

  assert.equal(await saveMetricBatch(pool, ownerSub, runId, { simulationId: 'worked-demo', samples: [metricSample] }), 'saved')
  assert.equal(await saveMetricBatch(pool, ownerSub, runId, { simulationId: 'worked-demo', samples: [{ ...metricSample, time: -1 }] }), 'invalid')
  assert.match(pool.calls[0].text, /owner_sub = \$3/)
  assert.match(pool.calls[1].text, /jsonb_to_recordset/)
  assert.match(pool.calls[1].text, /run\.owner_sub = \$4/)
  assert.match(pool.calls[1].text, /ON CONFLICT \(run_id, sampled_at\) DO NOTHING/)
  assert.equal(JSON.parse(pool.calls[1].values[1])[0].present, 1)
})

test('stores an intervention only when it matches the worker acknowledgement', async () => {
  const pool = fakePool()
  const runId = '37c6729d-9e21-4c8f-a414-fdbf8c56d66c'
  const ownerSub = 'auth0|organizer-1'
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

  assert.equal(await saveIntervention(pool, ownerSub, runId, input), 'saved')
  assert.equal(await saveIntervention(pool, ownerSub, runId, {
    ...input,
    acknowledgement: { ...input.acknowledgement, requestId: 'different-request' },
  }), 'invalid')
  assert.match(pool.calls[0].text, /owner_sub = \$3/)
  assert.deepEqual(pool.calls[0].values, [runId, 'worked-demo', ownerSub])
  assert.match(pool.calls[1].text, /ON CONFLICT \(run_id, request_id\) DO NOTHING/)
})

test('returns peak zone density and intervention comparisons for a run', async () => {
  const runId = '37c6729d-9e21-4c8f-a414-fdbf8c56d66c'
  const ownerSub = 'auth0|organizer-1'
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

  assert.deepEqual(await getRunAnalytics(pool, ownerSub, runId), {
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
  assert.deepEqual(calls[0].values, [runId, ownerSub])
  assert.ok(calls.slice(1).every((call) => call.values[0] === runId))
  assert.match(calls[2].text, /DISTINCT ON \(zone_id\)/)
  assert.match(calls[2].text, /jsonb_array_elements/)
  assert.match(calls[3].text, /GREATEST\(intervention\.at - 10, 0\)/)
  assert.match(calls[3].text, /intervention\.at \+ 10/)
})

test('rejects invalid analytics run IDs and returns null for missing runs', async () => {
  const calls = []
  const ownerSub = 'auth0|organizer-1'
  const pool = {
    async query(text, values) {
      calls.push({ text, values })
      return { rowCount: 0, rows: [] }
    },
  }

  assert.equal(await getRunAnalytics(pool, ownerSub, 'not-a-uuid'), 'invalid')
  assert.equal(calls.length, 0)
  assert.equal(await getRunAnalytics(pool, ownerSub, '37c6729d-9e21-4c8f-a414-fdbf8c56d66c'), null)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].values, ['37c6729d-9e21-4c8f-a414-fdbf8c56d66c', ownerSub])
})

test('floor plans save per person under their map ID, list back, and delete', async () => {
  const { deleteVenue, listVenues, saveVenue } = await import('../dist/database.js')
  const map = {
    id: 'upload-abc', revision: 'r1',
    source: { mode: 'upload', assetId: 'upload-abc', revision: 'r1', page: 1, calibration: null, sourceToWorld: [1, 0, 0, 1, 0, 0] },
    grid: { width: 2, height: 1, cellSize: 1, units: 'model', blocked: [0, 0], traversalCost: [1, 1], zoneIndex: [1, 1], portalIndex: [0, 0], zoneIds: [null, 'hall'], portalIds: [null] },
    entities: [{ id: 'hall', kind: 'zone', label: 'Hall' }],
    reviewed: true,
  }
  const venue = { name: 'My venue', floor: 'Ground', savedAt: '2026-11-07T12:00:00.000Z', map }
  const pool = fakePool()
  assert.equal(await saveVenue(pool, 'auth0|me', 'upload-abc', venue), 'saved')
  const insert = pool.calls.at(-1)
  assert.match(insert.text, /INSERT INTO crowd_venues/)
  assert.match(insert.text, /WHERE crowd_venues\.saved_at <= EXCLUDED\.saved_at/, 'an older copy never replaces a newer one')
  assert.deepEqual(insert.values.slice(0, 5), ['auth0|me', 'upload-abc', 'My venue', 'Ground', venue.savedAt])
  assert.equal(await saveVenue(pool, 'auth0|me', 'someone-else', venue), 'invalid', 'the URL ID must be the map ID')
  assert.equal(await saveVenue(pool, 'auth0|me', 'upload-abc', { ...venue, map: { ...map, reviewed: false } }), 'invalid')

  const listing = {
    async query(text, values) {
      assert.match(text, /WHERE owner_sub = \$1/)
      assert.deepEqual(values, ['auth0|me'])
      return { rowCount: 2, rows: [{ name: 'My venue', floor: 'Ground', savedAt: new Date(venue.savedAt), map }, { name: 'Broken', floor: '', savedAt: new Date(), map: { id: 'x' } }] }
    },
  }
  assert.deepEqual(await listVenues(listing, 'auth0|me'), [venue], 'unreadable rows are skipped')

  assert.equal(await deleteVenue(pool, 'auth0|me', 'upload-abc'), true)
  assert.deepEqual(pool.calls.at(-1).values, ['auth0|me', 'upload-abc'])
  assert.equal(await deleteVenue(pool, 'auth0|me', ''), 'invalid')
})
