import { z } from 'zod'
import {
  ApplyAckSchema,
  CreateInterventionRequestSchema,
  IdSchema,
  MetricSampleSchema,
  PreparedMapSchema,
  RunAnalyticsSchema,
  RunReplaySchema,
  ScenarioPlanSchema,
  RunSummariesSchema,
} from '@crowd-control/contract'
import type { RunAnalytics, RunReplay, RunSummary } from '@crowd-control/contract'
import type { Pool } from 'pg'

const RunSchema = z.strictObject({
  runId: z.uuid(),
  simulationId: IdSchema,
  startedAt: z.iso.datetime(),
  /** What the person calls it ("Concert evacuation"), and the scenario itself, so it can be replayed anywhere. */
  title: z.string().min(1).max(200).optional(),
  plan: ScenarioPlanSchema.optional(),
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

export async function getOwnedRuns(pool: Pool, ownerSub: string): Promise<RunSummary[]> {
  const result = await pool.query<{
    runId: string
    simulationId: string
    startedAt: Date | string
    sampleCount: number
    interventionCount: number
    title: string | null
  }>(
    `SELECT run.run_id AS "runId",
            run.simulation_id AS "simulationId",
            run.started_at AS "startedAt",
            run.title AS "title",
            COALESCE(metrics.sample_count, 0)::integer AS "sampleCount",
            COALESCE(interventions.intervention_count, 0)::integer AS "interventionCount"
     FROM crowd_runs AS run
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::integer AS sample_count
       FROM crowd_metric_samples
       WHERE run_id = run.run_id
     ) AS metrics ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::integer AS intervention_count
       FROM crowd_interventions
       WHERE run_id = run.run_id
     ) AS interventions ON TRUE
     WHERE run.owner_sub = $1
     ORDER BY run.started_at DESC
     LIMIT 50`,
    [ownerSub],
  )

  return RunSummariesSchema.parse(result.rows.map(({ title, ...row }) => ({
    ...row,
    ...(title ? { title } : {}),
    startedAt: row.startedAt instanceof Date ? row.startedAt.toISOString() : row.startedAt,
  })))
}

export async function getRunAnalytics(pool: Pool, ownerSub: string, runId: string): Promise<'invalid' | null | RunAnalytics> {
  if (!z.uuid().safeParse(runId).success) return 'invalid'

  const run = await pool.query(
    'SELECT 1 FROM crowd_runs WHERE run_id = $1 AND owner_sub = $2',
    [runId, ownerSub],
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

/**
 * A floor plan saved from the editor: its name and floor, when it was saved, and the reviewed
 * map (walls, rooms, doors as a grid). The map's own ID is the venue's ID.
 */
const SavedVenueSchema = z.strictObject({
  name: z.string().min(1).max(200),
  floor: z.string().max(200),
  savedAt: z.iso.datetime(),
  map: PreparedMapSchema,
})
export type SavedVenueRecord = z.infer<typeof SavedVenueSchema>

/** The signed-in person's saved floor plans, newest first. */
export async function listVenues(pool: Pool, ownerSub: string): Promise<SavedVenueRecord[]> {
  const result = await pool.query(
    `SELECT name, floor, saved_at AS "savedAt", map
     FROM crowd_venues
     WHERE owner_sub = $1
     ORDER BY saved_at DESC
     LIMIT 100`,
    [ownerSub],
  )
  return result.rows.flatMap((row) => {
    const parsed = SavedVenueSchema.safeParse({ ...row, savedAt: row.savedAt instanceof Date ? row.savedAt.toISOString() : row.savedAt })
    return parsed.success ? [parsed.data] : []
  })
}

/**
 * Saves a floor plan under its map ID. Saving again replaces it, unless the stored copy is
 * newer (another device saved it since), so an old copy never overwrites a newer one.
 */
export async function saveVenue(pool: Pool, ownerSub: string, venueId: string, input: unknown): Promise<'invalid' | 'saved'> {
  const parsed = SavedVenueSchema.safeParse(input)
  if (!parsed.success || parsed.data.map.id !== venueId) return 'invalid'
  const venue = parsed.data
  await pool.query(
    `INSERT INTO crowd_venues (owner_sub, venue_id, name, floor, saved_at, map)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (owner_sub, venue_id) DO UPDATE
       SET name = EXCLUDED.name, floor = EXCLUDED.floor, saved_at = EXCLUDED.saved_at, map = EXCLUDED.map
       WHERE crowd_venues.saved_at <= EXCLUDED.saved_at`,
    [ownerSub, venueId, venue.name, venue.floor, venue.savedAt, JSON.stringify(venue.map)],
  )
  return 'saved'
}

/** Deletes one of the signed-in person's floor plans; false if there was none. */
export async function deleteVenue(pool: Pool, ownerSub: string, venueId: string): Promise<'invalid' | boolean> {
  if (!IdSchema.safeParse(venueId).success) return 'invalid'
  const result = await pool.query('DELETE FROM crowd_venues WHERE owner_sub = $1 AND venue_id = $2', [ownerSub, venueId])
  return (result.rowCount ?? 0) > 0
}

export async function initializeDatabase(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crowd_runs (
      run_id UUID PRIMARY KEY,
      simulation_id TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      owner_sub TEXT
    )
  `)
  await pool.query('ALTER TABLE crowd_runs ADD COLUMN IF NOT EXISTS owner_sub TEXT')
  await pool.query(`
    CREATE INDEX IF NOT EXISTS crowd_runs_owner_started_at_idx
    ON crowd_runs (owner_sub, started_at DESC)
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crowd_venues (
      owner_sub TEXT NOT NULL,
      venue_id TEXT NOT NULL,
      name TEXT NOT NULL,
      floor TEXT NOT NULL,
      saved_at TIMESTAMPTZ NOT NULL,
      map JSONB NOT NULL,
      PRIMARY KEY (owner_sub, venue_id)
    )
  `)
  // A run's title and scenario, for Past runs and replay.
  await pool.query('ALTER TABLE crowd_runs ADD COLUMN IF NOT EXISTS title TEXT')
  await pool.query('ALTER TABLE crowd_runs ADD COLUMN IF NOT EXISTS plan JSONB')
}

export async function saveRun(pool: Pool, ownerSub: string, input: unknown): Promise<boolean> {
  const parsed = RunSchema.safeParse(input)
  if (!parsed.success) return false
  const run = parsed.data
  const result = await pool.query(
    `INSERT INTO crowd_runs (run_id, simulation_id, started_at, owner_sub, title, plan)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (run_id) DO UPDATE
       SET run_id = EXCLUDED.run_id
       WHERE crowd_runs.owner_sub = EXCLUDED.owner_sub
         AND crowd_runs.simulation_id = EXCLUDED.simulation_id
     RETURNING run_id`,
    [run.runId, run.simulationId, run.startedAt, ownerSub, run.title ?? null, run.plan ? JSON.stringify(run.plan) : null],
  )
  return result.rowCount !== null && result.rowCount > 0
}

/** Deletes one of the person's runs with its measurements and changes; false if it isn't theirs. */
export async function deleteRun(pool: Pool, ownerSub: string, runId: string): Promise<'invalid' | boolean> {
  if (!z.uuid().safeParse(runId).success) return 'invalid'
  const owned = await pool.query('SELECT 1 FROM crowd_runs WHERE run_id = $1 AND owner_sub = $2', [runId, ownerSub])
  if (owned.rowCount === 0) return false
  await pool.query('DELETE FROM crowd_metric_samples WHERE run_id = $1', [runId])
  await pool.query('DELETE FROM crowd_interventions WHERE run_id = $1', [runId])
  const removed = await pool.query('DELETE FROM crowd_runs WHERE run_id = $1 AND owner_sub = $2', [runId, ownerSub])
  return (removed.rowCount ?? 0) > 0
}

/** The measured facts the safety report is written from, all from one of the person's runs. */
export type RunFacts = {
  scenario: string
  startedAt: string
  units: 'people/m²' | 'relative'
  measuredSeconds: number
  measurements: number
  end: { present: number; departed: number; immobile: number; clearance: { t50: number | null; t90: number | null; t100: number | null } } | null
  busiest: RunAnalytics['peakDensityByZone']
  changes: RunAnalytics['interventions']
}

export async function getRunFacts(pool: Pool, ownerSub: string, runId: string, units: RunFacts['units']): Promise<'invalid' | null | RunFacts> {
  const analytics = await getRunAnalytics(pool, ownerSub, runId)
  if (analytics === 'invalid' || analytics === null) return analytics
  const [run, timeline] = await Promise.all([
    pool.query('SELECT simulation_id AS "simulationId", title, started_at AS "startedAt" FROM crowd_runs WHERE run_id = $1', [runId]),
    pool.query(
      `SELECT simulation_time AS "time", present, departed, immobile, clearance
       FROM crowd_metric_samples WHERE run_id = $1 ORDER BY simulation_time`,
      [runId],
    ),
  ])
  const row = run.rows[0] ?? {}
  const samples = timeline.rows as { time: number; present: number; departed: number; immobile: number; clearance: { t50: number | null; t90: number | null; t100: number | null } }[]
  const last = samples.at(-1)
  // Clearance times, when the simulator didn't record them: the first moment half, 90% and
  // everyone had left, from the departure counts.
  const total = last ? last.present + last.departed : 0
  const firstAt = (share: number) => {
    if (total === 0) return null
    const needed = Math.ceil(total * share)
    return samples.find((sample) => sample.departed >= needed)?.time ?? null
  }
  const end = last && {
    ...last,
    clearance: {
      t50: last.clearance?.t50 ?? firstAt(0.5),
      t90: last.clearance?.t90 ?? firstAt(0.9),
      t100: last.clearance?.t100 ?? (last.present === 0 ? firstAt(1) : null),
    },
  }
  return {
    scenario: row.title ?? row.simulationId ?? 'Simulation',
    startedAt: row.startedAt instanceof Date ? row.startedAt.toISOString() : String(row.startedAt ?? ''),
    units,
    measuredSeconds: end ? Number(end.time) : 0,
    measurements: analytics.sampleCount,
    end: end ? { present: end.present, departed: end.departed, immobile: end.immobile, clearance: end.clearance } : null,
    busiest: [...analytics.peakDensityByZone].sort((a, b) => b.peakDensity - a.peakDensity).slice(0, 12),
    changes: analytics.interventions,
  }
}

/**
 * What it takes to replay one of the person's runs: its scenario (if it was saved with the run)
 * and every change applied, in the order they took effect, with the time each took effect.
 */
export async function getRunReplay(pool: Pool, ownerSub: string, runId: string): Promise<'invalid' | null | RunReplay> {
  if (!z.uuid().safeParse(runId).success) return 'invalid'
  const run = await pool.query(
    `SELECT simulation_id AS "simulationId", started_at AS "startedAt", title, plan
     FROM crowd_runs WHERE run_id = $1 AND owner_sub = $2`,
    [runId, ownerSub],
  )
  const row = run.rows[0]
  if (!row) return null
  const changes = await pool.query(
    `SELECT prompt, request, acknowledgement
     FROM crowd_interventions WHERE run_id = $1
     ORDER BY (acknowledgement->>'at')::double precision, recorded_at`,
    [runId],
  )
  const plan = ScenarioPlanSchema.safeParse(row.plan)
  return RunReplaySchema.parse({
    runId,
    simulationId: row.simulationId,
    startedAt: row.startedAt instanceof Date ? row.startedAt.toISOString() : row.startedAt,
    ...(row.title ? { title: row.title } : {}),
    plan: plan.success ? plan.data : null,
    changes: changes.rows.flatMap((change) => {
      const request = CreateInterventionRequestSchema.safeParse(change.request)
      const ack = ApplyAckSchema.safeParse(change.acknowledgement)
      if (!request.success || !ack.success) return []
      return [{ at: ack.data.at, label: request.data.label ?? change.prompt, prompt: change.prompt, operations: request.data.operations }]
    }),
  })
}

export async function saveMetricBatch(pool: Pool, ownerSub: string, runId: string, input: unknown): Promise<'invalid' | 'missing-run' | 'saved'> {
  if (!z.uuid().safeParse(runId).success) return 'invalid'
  const parsed = MetricsBatchSchema.safeParse(input)
  if (!parsed.success) return 'invalid'
  const { simulationId, samples } = parsed.data
  const run = await pool.query(
    'SELECT started_at FROM crowd_runs WHERE run_id = $1 AND simulation_id = $2 AND owner_sub = $3',
    [runId, simulationId, ownerSub],
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
     WHERE run.run_id = $1 AND run.simulation_id = $3 AND run.owner_sub = $4
     ON CONFLICT (run_id, sampled_at) DO NOTHING`,
    [runId, JSON.stringify(samples), simulationId, ownerSub],
  )
  return 'saved'
}

export async function saveIntervention(pool: Pool, ownerSub: string, runId: string, input: unknown): Promise<'invalid' | 'missing-run' | 'saved'> {
  if (!z.uuid().safeParse(runId).success) return 'invalid'
  const parsed = InterventionSchema.safeParse(input)
  if (!parsed.success) return 'invalid'
  const intervention = parsed.data
  const run = await pool.query(
    'SELECT 1 FROM crowd_runs WHERE run_id = $1 AND simulation_id = $2 AND owner_sub = $3',
    [runId, intervention.simulationId, ownerSub],
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
