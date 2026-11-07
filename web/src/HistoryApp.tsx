import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import {
  RunAnalyticsSchema,
  RunSummariesSchema,
  SafetyReportSchema,
  type RunAnalytics,
  type SafetyReport,
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
  const [safetyReport, setSafetyReport] = useState<SafetyReport | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState('')
  const analyticsRequestId = useRef(0)
  const reportRequestId = useRef(0)

  const authFetch = useCallback(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const token = await getAccessTokenSilently()
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    return fetch(input, { ...init, headers })
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
    reportRequestId.current += 1
    setAnalyticsRun(run)
    setAnalytics(null)
    setAnalyticsError('')
    setSafetyReport(null)
    setReportLoading(false)
    setReportError('')
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

  const generateReport = async () => {
    if (!analyticsRun) return
    const requestId = ++reportRequestId.current
    const runId = analyticsRun.runId
    setReportLoading(true)
    setReportError('')
    setSafetyReport(null)
    try {
      const response = await authFetch(`/api/runs/${analyticsRun.runId}/report`, { method: 'POST' })
      const payload: unknown = await response.json()
      if (!response.ok) {
        const detail = typeof payload === 'object' && payload !== null && 'error' in payload
          && typeof payload.error === 'string'
          ? payload.error
          : `HTTP ${response.status}`
        throw new Error(detail)
      }
      const value = typeof payload === 'object' && payload !== null && 'report' in payload
        ? payload.report
        : undefined
      const parsed = SafetyReportSchema.safeParse(value)
      if (!parsed.success) throw new Error('The server returned an invalid safety report.')
      if (requestId === reportRequestId.current && analyticsRun?.runId === runId) setSafetyReport(parsed.data)
    } catch (error) {
      if (requestId === reportRequestId.current) {
        setReportError(error instanceof Error ? error.message : 'Could not generate the safety report.')
      }
    } finally {
      if (requestId === reportRequestId.current) setReportLoading(false)
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

      <section className="panel safety-report-card" aria-labelledby="safety-report-heading">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">AI-generated · Gemini</p>
            <h2 id="safety-report-heading">Safety planning report</h2>
          </div>
          <div className="button-row">
            {safetyReport && (
              <button type="button" className="secondary-button" onClick={() => window.print()}>
                Print / Save as PDF
              </button>
            )}
            <button type="button" onClick={() => void generateReport()} disabled={!analyticsRun || reportLoading}>
              {reportLoading ? 'Generating…' : safetyReport ? 'Regenerate report' : 'Generate report'}
            </button>
          </div>
        </div>
        <p className="fine-print">
          The report uses saved density peaks and acknowledged interventions for the selected run. It is a planning aid, not a certified safety or egress assessment.
        </p>
        {!analyticsRun && <p className="muted">Select a saved simulation above before generating its report.</p>}
        {reportError && <p className="error" role="alert">Could not generate the report: {reportError}</p>}
        {reportLoading && <p className="muted" role="status">Gemini is reviewing the saved run evidence…</p>}
        {safetyReport && (
          <article>
            <p className="fine-print">
              {analyticsRun ? displayName(analyticsRun.simulationId) : 'Saved simulation'} · Generated {new Date(safetyReport.generatedAt).toLocaleString()}
            </p>
            <h3>Summary</h3>
            <p>{safetyReport.executiveSummary}</p>
            <h3>Findings and recommendations</h3>
            {safetyReport.findings.length ? (
              <ol className="report-findings">
                {safetyReport.findings.map((finding, index) => (
                  <li key={`${finding.title}-${index}`}>
                    <h4>{finding.title}</h4>
                    <p className="muted">
                      {finding.zoneId ? `${displayName(finding.zoneId)} · ` : ''}
                      {finding.at === null ? 'No specific time recorded' : `Simulation time ${finding.at.toFixed(1)} seconds`}
                    </p>
                    <p>{finding.observation}</p>
                    <p><strong>Recommendation:</strong> {finding.recommendation}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">No findings could be drawn from the available saved evidence.</p>
            )}
            <h3>Limitations</h3>
            <ul>
              {safetyReport.limitations.map((limitation, index) => <li key={`${index}-${limitation}`}>{limitation}</li>)}
            </ul>
            <p className="report-disclaimer">{safetyReport.disclaimer}</p>
          </article>
        )}
      </section>
    </main>
  )
}
