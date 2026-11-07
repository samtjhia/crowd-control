import { z } from 'zod'
import {
  ApplyAckSchema,
  CreateInterventionRequestSchema,
  IdSchema,
  MetricSampleSchema,
  RunAnalyticsSchema,
} from '@crowd-control/contract'
import type { RunAnalytics } from '@crowd-control/contract'
import type { Pool } from 'pg'

const RunSchema = z.strictObject({
  runId: z.uuid(),
  simulationId: IdSchema,
  startedAt: z.iso.datetime(),
})

const MetricsBatchSchema = z.strictObject({
  simulationId: IdSchema,
  samples: z.array(MetricSampleSchema).min(1).max(100),
})

const InterventionSchema = z.strictObject({
  simulationId: IdSchema,
  prompt: z.string().min(1).max(8000),
  request: CreateInterventionRequestSchema,
  acknowledgement: ApplyAckSchema,
  recordedAt: z.iso.datetime(),
}).refine(
  (value) => value.request.simulationId === value.simulationId
    && value.acknowledgement.requestId === value.request.requestId,
  'Intervention data does not match the run or worker acknowledgement',
)

export const MAX_METRIC_BATCH_SIZE = 100

export const persistenceSchemas = {
  run: RunSchema,
  metrics: MetricsBatchSchema,
  intervention: InterventionSchema,
}

export async function getRunAnalytics(pool: Pool, runId: string): Promise<'invalid' | null | RunAnalytics> {
  if (!z.uuid().safeParse(runId).success) return 'invalid'

  const run = await pool.query(
    'SELECT 1 FROM crowd_runs WHERE run_id = $1',
    [runId],
  )
  if (run.rowCount === 0) return null

  const [sampleResult, peakResult, interventionResult] = await Promise.all([
    pool.query<{ sample_count: number }>(
      'SELECT COUNT(*)::integer AS sample_count FROM crowd_metric_samples WHERE run_id = $1',
      [runId],
    ),
    pool.query<{ zone_id: string; peak_density: number; at: number }>(
      `SELECT DISTINCT ON (zone_id)
         zone_id, density AS peak_density, simulation_time AS at
       FROM (
         SELECT metric.simulation_time,
                zone->>'zoneId' AS zone_id,
                (zone->>'density')::double precision AS density
         FROM crowd_metric_samples AS metric
         CROSS JOIN LATERAL jsonb_array_elements(metric.zones) AS zone
         WHERE metric.run_id = $1
       ) AS samples
       WHERE zone_id IS NOT NULL AND density IS NOT NULL
       ORDER BY zone_id, density DESC, simulation_time ASC`,
      [runId],
    ),
    pool.query<RunAnalytics['interventions'][number]>(
      `SELECT intervention.request_id AS "requestId",
              intervention.prompt,
              intervention.at,
              COALESCE(
                jsonb_agg(
                  jsonb_build_object(
                    'zoneId', comparison.zone_id,
                    'beforeDensity', comparison.before_density,
                    'afterDensity', comparison.after_density,
                    'beforeSamples', comparison.before_samples,
                    'afterSamples', comparison.after_samples
                  ) ORDER BY comparison.zone_id
                ) FILTER (WHERE comparison.zone_id IS NOT NULL),
                '[]'::jsonb
              ) AS comparisons
       FROM (
         SELECT run_id, request_id, prompt,
                (acknowledgement->>'at')::double precision AS at
         FROM crowd_interventions
         WHERE run_id = $1
       ) AS intervention
       LEFT JOIN LATERAL (
         SELECT zone->>'zoneId' AS zone_id,
                AVG((zone->>'density')::double precision)
                  FILTER (WHERE metric.simulation_time < intervention.at) AS before_density,
                AVG((zone->>'density')::double precision)
                  FILTER (WHERE metric.simulation_time >= intervention.at) AS after_density,
                COUNT(*) FILTER (WHERE metric.simulation_time < intervention.at)::integer AS before_samples,
                COUNT(*) FILTER (WHERE metric.simulation_time >= intervention.at)::integer AS after_samples
         FROM crowd_metric_samples AS metric
         CROSS JOIN LATERAL jsonb_array_elements(metric.zones) AS zone
         WHERE metric.run_id = intervention.run_id
           AND metric.simulation_time >= GREATEST(intervention.at - 10, 0)
           AND metric.simulation_time <= intervention.at + 10
         GROUP BY zone->>'zoneId'
       ) AS comparison ON TRUE
       GROUP BY intervention.run_id, intervention.request_id, intervention.prompt, intervention.at
       ORDER BY intervention.at, intervention.request_id`,
      [runId],
    ),
  ])

  return RunAnalyticsSchema.parse({
    runId,
    sampleCount: sampleResult.rows[0]?.sample_count ?? 0,
    peakDensityByZone: peakResult.rows.map((row) => ({
      zoneId: row.zone_id,
      peakDensity: row.peak_density,
      at: row.at,
    })),
    interventions: interventionResult.rows,
  })
}

export async function initializeDatabase(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crowd_runs (
      run_id UUID PRIMARY KEY,
      simulation_id TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crowd_metric_samples (
      run_id UUID NOT NULL REFERENCES crowd_runs(run_id),
      sampled_at TIMESTAMPTZ NOT NULL,
      simulation_time DOUBLE PRECISION NOT NULL,
      present INTEGER NOT NULL,
      departed INTEGER NOT NULL,
      blocked INTEGER NOT NULL,
      immobile INTEGER NOT NULL,
      removed INTEGER NOT NULL,
      zones JSONB NOT NULL,
      portals JSONB NOT NULL,
      queues JSONB NOT NULL,
      clearance JSONB NOT NULL,
      PRIMARY KEY (run_id, sampled_at)
    )
  `)
  await pool.query(`
    SELECT create_hypertable(
      'crowd_metric_samples',
      'sampled_at',
      if_not_exists => TRUE
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crowd_interventions (
      run_id UUID NOT NULL REFERENCES crowd_runs(run_id),
      request_id TEXT NOT NULL,
      simulation_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      request JSONB NOT NULL,
      acknowledgement JSONB NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (run_id, request_id)
    )
  `)
}

export async function saveRun(pool: Pool, input: unknown): Promise<boolean> {
  const parsed = RunSchema.safeParse(input)
  if (!parsed.success) return false
  const run = parsed.data
  await pool.query(
    `INSERT INTO crowd_runs (run_id, simulation_id, started_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (run_id) DO NOTHING`,
    [run.runId, run.simulationId, run.startedAt],
  )
  return true
}

export async function saveMetricBatch(pool: Pool, runId: string, input: unknown): Promise<'invalid' | 'missing-run' | 'saved'> {
  if (!z.uuid().safeParse(runId).success) return 'invalid'
  const parsed = MetricsBatchSchema.safeParse(input)
  if (!parsed.success) return 'invalid'
  const { simulationId, samples } = parsed.data
  const run = await pool.query(
    'SELECT started_at FROM crowd_runs WHERE run_id = $1 AND simulation_id = $2',
    [runId, simulationId],
  )
  if (run.rowCount === 0) return 'missing-run'

  await pool.query(
    `INSERT INTO crowd_metric_samples (
       run_id, sampled_at, simulation_time, present, departed, blocked, immobile, removed,
       zones, portals, queues, clearance
     )
     SELECT
       $1,
       run.started_at + sample.time * INTERVAL '1 second',
       sample.time, sample.present, sample.departed, sample.blocked, sample.immobile, sample.removed,
       sample.zones, sample.portals, sample.queues, sample.clearance
     FROM crowd_runs AS run
     CROSS JOIN jsonb_to_recordset($2::jsonb) AS sample(
       time DOUBLE PRECISION,
       present INTEGER,
       departed INTEGER,
       blocked INTEGER,
       immobile INTEGER,
       removed INTEGER,
       zones JSONB,
       portals JSONB,
       queues JSONB,
       clearance JSONB
     )
     WHERE run.run_id = $1
     ON CONFLICT (run_id, sampled_at) DO NOTHING`,
    [runId, JSON.stringify(samples)],
  )
  return 'saved'
}

export async function saveIntervention(pool: Pool, runId: string, input: unknown): Promise<'invalid' | 'missing-run' | 'saved'> {
  if (!z.uuid().safeParse(runId).success) return 'invalid'
  const parsed = InterventionSchema.safeParse(input)
  if (!parsed.success) return 'invalid'
  const intervention = parsed.data
  const run = await pool.query(
    'SELECT 1 FROM crowd_runs WHERE run_id = $1 AND simulation_id = $2',
    [runId, intervention.simulationId],
  )
  if (run.rowCount === 0) return 'missing-run'

  await pool.query(
    `INSERT INTO crowd_interventions (
       run_id, request_id, simulation_id, prompt, request, acknowledgement, recorded_at
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
     ON CONFLICT (run_id, request_id) DO NOTHING`,
    [
      runId,
      intervention.request.requestId,
      intervention.simulationId,
      intervention.prompt,
      JSON.stringify(intervention.request),
      JSON.stringify(intervention.acknowledgement),
      intervention.recordedAt,
    ],
  )
  return 'saved'
}
