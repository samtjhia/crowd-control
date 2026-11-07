import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import {
  RunAnalyticsSchema,
  RunSummariesSchema,
  type RunAnalytics,
  type RunSummary,
} from '@crowd-control/contract'

function displayName(value: string): string {
  return value.replace(/_+/g, ' ')
}

export default function HistoryApp() {
  const { getAccessTokenSilently } = useAuth0()
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [runsLoading, setRunsLoading] = useState(true)
  const [runsError, setRunsError] = useState('')
  const [analytics, setAnalytics] = useState<RunAnalytics | null>(null)
  const [analyticsRun, setAnalyticsRun] = useState<RunSummary | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analyticsError, setAnalyticsError] = useState('')
  const analyticsRequestId = useRef(0)

  const authFetch = useCallback(async (input: RequestInfo | URL) => {
    const token = await getAccessTokenSilently()
    return fetch(input, { headers: { Authorization: `Bearer ${token}` } })
  }, [getAccessTokenSilently])

  const refreshRuns = useCallback(async () => {
    setRunsLoading(true)
    try {
      const response = await authFetch('/api/runs')
      const payload: unknown = await response.json()
      if (!response.ok) {
        const detail = typeof payload === 'object' && payload !== null && 'error' in payload
          && typeof payload.error === 'string'
          ? payload.error
          : `HTTP ${response.status}`
        throw new Error(detail)
      }
      const value = typeof payload === 'object' && payload !== null && 'runs' in payload
        ? payload.runs
        : undefined
      const parsed = RunSummariesSchema.safeParse(value)
      if (!parsed.success) throw new Error('Tiger Data returned an invalid past simulations response.')
      setRuns(parsed.data)
      setRunsError('')
    } catch (error) {
      setRunsError(error instanceof Error ? error.message : 'Could not load past simulations.')
    } finally {
      setRunsLoading(false)
    }
  }, [authFetch])

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshRuns(), 0)
    return () => window.clearTimeout(timer)
  }, [refreshRuns])

  const viewAnalytics = async (run: RunSummary) => {
    const requestId = ++analyticsRequestId.current
    setAnalyticsRun(run)
    setAnalytics(null)
    setAnalyticsError('')
    setAnalyticsLoading(true)
    try {
      const response = await authFetch(`/api/runs/${run.runId}/analytics`)
      const payload: unknown = await response.json()
      if (!response.ok) {
        const detail = typeof payload === 'object' && payload !== null && 'error' in payload
          && typeof payload.error === 'string'
          ? payload.error
          : `HTTP ${response.status}`
        throw new Error(detail)
      }
      const value = typeof payload === 'object' && payload !== null && 'analytics' in payload
        ? payload.analytics
        : undefined
      const parsed = RunAnalyticsSchema.safeParse(value)
      if (!parsed.success) throw new Error('Tiger Data returned an invalid analytics response.')
      if (requestId === analyticsRequestId.current) setAnalytics(parsed.data)
    } catch (error) {
      if (requestId === analyticsRequestId.current) {
        setAnalyticsError(error instanceof Error ? error.message : 'Could not load simulation analytics.')
      }
    } finally {
      if (requestId === analyticsRequestId.current) setAnalyticsLoading(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="page-heading">
        <p className="eyebrow">Saved to Tiger Data</p>
        <h1>Past simulations</h1>
        <p>Review saved runs from your account. Opening a run shows its analytics; it does not replay the simulation.</p>
      </header>

      <section className="panel" aria-labelledby="past-runs-heading">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Your account</p>
            <h2 id="past-runs-heading">Simulation history</h2>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void refreshRuns()}
            disabled={runsLoading}
          >
            {runsLoading ? 'Refreshing…' : 'Refresh list'}
          </button>
        </div>
        <p className="fine-print">Only simulations saved by your signed-in account appear here. Anonymous and other users’ runs are not shown.</p>
        {runsError && <p className="error" role="alert">Could not load past simulations: {runsError}</p>}
        {!runs.length && !runsError && (
          <p className="muted">{runsLoading ? 'Loading your saved simulations…' : 'No saved simulations yet. Create and run a simulation to get started.'}</p>
        )}
        {runs.length > 0 && (
          <ul className="past-runs-list">
            {runs.map((run) => (
              <li key={run.runId}>
                <div>
                  <strong>{displayName(run.simulationId)}</strong>
                  <span className="muted"> · {new Date(run.startedAt).toLocaleString()}</span>
                  <p className="fine-print">
                    {run.sampleCount} metric {run.sampleCount === 1 ? 'sample' : 'samples'} · {run.interventionCount} saved {run.interventionCount === 1 ? 'intervention' : 'interventions'}
                  </p>
                </div>
                <button type="button" onClick={() => void viewAnalytics(run)}>
                  View analytics
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel" aria-labelledby="run-analytics-heading">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Saved run data · Tiger Data</p>
            <h2 id="run-analytics-heading">Simulation analytics</h2>
          </div>
          {analyticsRun && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => void viewAnalytics(analyticsRun)}
              disabled={analyticsLoading}
            >
              {analyticsLoading ? 'Refreshing…' : 'Refresh analytics'}
            </button>
          )}
        </div>
        {analyticsRun && (
          <p className="muted">
            {displayName(analyticsRun.simulationId)} · {new Date(analyticsRun.startedAt).toLocaleString()}
          </p>
        )}
        {!analyticsRun && <p className="muted">Choose a simulation above to see its saved analytics.</p>}
        {analyticsLoading && <p className="muted" role="status">Loading analytics…</p>}
        {analyticsError && <p className="error" role="alert">Analytics unavailable: {analyticsError}</p>}
        {analytics && (
          <>
            <p className="muted">{analytics.sampleCount} metric samples saved for this run.</p>
            <h3>Peak density by zone</h3>
            {analytics.peakDensityByZone.length ? (
              <ul>
                {analytics.peakDensityByZone.map((zone) => (
                  <li key={zone.zoneId}>
                    {displayName(zone.zoneId)}: {zone.peakDensity.toFixed(2)} at {zone.at.toFixed(1)} seconds
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No zone density samples were saved for this run.</p>
            )}
            <h3>Before / after interventions</h3>
            {analytics.interventions.length ? (
              <ul className="analytics-interventions">
                {analytics.interventions.map((intervention) => (
                  <li key={intervention.requestId}>
                    <strong>{intervention.prompt}</strong>
                    <span className="muted"> · applied at {intervention.at.toFixed(1)} seconds</span>
                    {intervention.comparisons.length ? (
                      <ul>
                        {intervention.comparisons.map((comparison) => (
                          <li key={comparison.zoneId}>
                            {displayName(comparison.zoneId)}: before {comparison.beforeDensity?.toFixed(2) ?? '—'}
                            {' '}({comparison.beforeSamples} samples), after {comparison.afterDensity?.toFixed(2) ?? '—'}
                            {' '}({comparison.afterSamples} samples)
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">No zone samples were saved in the comparison window.</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No acknowledged interventions were saved for this run.</p>
            )}
          </>
        )}
      </section>
    </main>
  )
}
