import assert from 'node:assert/strict'
import test from 'node:test'
import { ApplyAckSchema, CreateInterventionRequestSchema, MetricSampleSchema, type MetricSample } from '@crowd-control/contract'
import type { SaveState } from '../site/saveState.ts'
import { RunRecorder, type Poster } from './runRecorder.ts'

const sample = (time: number): MetricSample => MetricSampleSchema.parse({
  time, present: 10, departed: 0, blocked: 0, immobile: 0, removed: 0,
  zones: [{ zoneId: 'hall', occupancy: 10, density: 0.5 }], portals: [], queues: [], clearance: { t50: null, t90: null, t100: null },
})

function server(fail?: (path: string) => { status: number; error?: string } | null) {
  const sent: { path: string; body: any }[] = []
  const post: Poster = async (path, body) => {
    const failure = fail?.(path)
    if (failure) return { ok: false, ...failure }
    sent.push({ path, body })
    return { ok: true, status: 201 }
  }
  return { post, sent }
}

function recorder(post: Poster) {
  const states: SaveState[] = []
  let n = 0
  const r = new RunRecorder(post, (s) => states.push(s), () => `00000000-0000-4000-8000-00000000000${++n}`)
  return { r, states }
}

test('a run is saved only once something has happened, then its samples follow in order', async () => {
  const { post, sent } = server()
  const { r, states } = recorder(post)
  r.start('concert-floor-demo')
  r.sample(sample(0))
  await r.flush()
  assert.equal(sent.length, 0, 'loading a scenario saves nothing')
  r.sample(sample(1)); r.sample(sample(1)); r.sample(sample(2))
  await r.flush()
  assert.deepEqual(sent.map((s) => s.path), ['/api/runs', '/api/runs/00000000-0000-4000-8000-000000000001/metrics'])
  assert.equal(sent[0]!.body.simulationId, 'concert-floor-demo')
  assert.deepEqual(sent[1]!.body.samples.map((s: MetricSample) => s.time), [1, 2], 'repeats are dropped')
  assert.deepEqual(states.map((s) => s.kind), ['waiting', 'saving', 'saved'])
})

test('changes are saved with the request and acknowledgement the server checks', async () => {
  const { post, sent } = server()
  const { r } = recorder(post)
  r.start('s')
  const request = CreateInterventionRequestSchema.parse({ schemaVersion: 1, simulationId: 's', requestId: 'ui-1', label: 'Close Main door', operations: [{ op: 'set', targets: { ids: ['d'] }, values: { components: { portal: { open: false } } } }] })
  const ack = ApplyAckSchema.parse({ requestId: 'ui-1', interventionId: 'i1', revision: 1, at: 3, historyRevision: 1 })
  r.change({ prompt: 'close the main door', request, ack })
  r.change({ prompt: 'other run', request: { ...request, simulationId: 'other' }, ack })
  await r.flush()
  const saved = sent.filter((s) => s.path.endsWith('/interventions'))
  assert.equal(saved.length, 1, 'only changes to this run')
  assert.deepEqual({ ...saved[0]!.body, recordedAt: 'x' }, { simulationId: 's', prompt: 'close the main door', request, acknowledgement: ack, recordedAt: 'x' })
})

test('a failed upload says why, stays queued, and goes through on the next flush', async () => {
  let down = true
  const { post, sent } = server(() => (down ? { status: 503 } : null))
  const { r, states } = recorder(post)
  r.start('s')
  r.sample(sample(1))
  await r.flush()
  assert.deepEqual(states.at(-1), { kind: 'failed', message: 'the run database is unavailable right now. It will retry.' })
  down = false
  await r.flush()
  assert.deepEqual(sent.map((s) => s.path.split('/').at(-1)), ['runs', 'metrics'])
  assert.equal(states.at(-1)!.kind, 'saved')
})

test('a reset starts a new run while the old one finishes uploading', async () => {
  const { post, sent } = server()
  const { r } = recorder(post)
  r.start('s')
  r.sample(sample(1))
  r.start('s')
  r.sample(sample(1))
  await r.flush()
  const runs = sent.filter((s) => s.path === '/api/runs').map((s) => s.body.runId)
  assert.equal(new Set(runs).size, 2)
  assert.equal(sent.filter((s) => s.path.endsWith('/metrics')).length, 2)
})

test('sample batches stay under the server’s size limit on venues with many rooms', async () => {
  const { nextBatch } = await import('./runRecorder.ts')
  const big = (time: number) => ({ ...sample(time), zones: Array.from({ length: 60 }, (_, i) => ({ zoneId: `room_${i}`, occupancy: 3, density: 0.25 })) })
  const samples = Array.from({ length: 100 }, (_, i) => big(i + 1))
  const batch = nextBatch(samples)
  assert.ok(batch.length > 1 && batch.length < 100, `${batch.length} samples`)
  assert.ok(JSON.stringify({ simulationId: 's', samples: batch }).length < 64 * 1024)
  assert.equal(nextBatch([sample(1), sample(2)]).length, 2, 'small samples go together')
})
