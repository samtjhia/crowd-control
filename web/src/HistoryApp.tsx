import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, LoaderCircle, Play, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react'
import { RunAnalyticsSchema, RunSummariesSchema, type RunAnalytics, type RunSummary } from '@crowd-control/contract'
import { SiteHeader } from './site/Site.tsx'
import { useAuthFetch } from './site/useAuthFetch.ts'
import { formatClock } from './sim/incidents.ts'
import { readable, runIdentity } from './sim/runNames.ts'
import './history.css'

/**
 * Past simulations: the signed-in person's saved runs, newest first. Choosing one shows where it
 * got busiest and what each change did to crowding, from the analytics the server keeps.
 */

type Load<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; value: T }

/** "Today, 3:42 PM", "Yesterday, 9:05 AM", or "Nov 5, 3:42 PM". */
function when(iso: string, now = new Date()): string {
  const date = new Date(iso)
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(now) - day(date)) / 86_400_000)
  if (days === 0) return `Today, ${time}`
  if (days === 1) return `Yesterday, ${time}`
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(date.getFullYear() !== now.getFullYear() && { year: 'numeric' }) })}, ${time}`
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The server's reason for a failed request, or its status. */
async function readJson(response: Response, key: string): Promise<unknown> {
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`
    throw new Error(detail)
  }
  return typeof payload === 'object' && payload !== null && key in payload ? (payload as Record<string, unknown>)[key] : undefined
}

export default function HistoryApp() {
  const authFetch = useAuthFetch()
  const [runs, setRuns] = useState<Load<RunSummary[]>>({ state: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [selected, setSelected] = useState<RunSummary | null>(null)
  const [analytics, setAnalytics] = useState<Load<RunAnalytics> | null>(null)
  const latest = useRef(0)
  const hasRuns = runs.state === 'ready' && runs.value.length > 0

  const loadRuns = useCallback(async () => {
    setRefreshing(true)
    try {
      const parsed = RunSummariesSchema.safeParse(await readJson(await authFetch('/api/runs'), 'runs'))
      if (!parsed.success) throw new Error('the server sent a list it couldn’t read.')
      setRuns({ state: 'ready', value: parsed.data })
    } catch (error) {
      setRuns({ state: 'error', message: error instanceof Error ? error.message : 'something went wrong.' })
    } finally {
      setRefreshing(false)
    }
  }, [authFetch])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRuns(), 0)
    return () => window.clearTimeout(timer)
  }, [loadRuns])

  const open = useCallback(async (run: RunSummary) => {
    const request = ++latest.current
    setSelected(run)
    setAnalytics({ state: 'loading' })
    try {
      const parsed = RunAnalyticsSchema.safeParse(await readJson(await authFetch(`/api/runs/${run.runId}/analytics`), 'analytics'))
      if (!parsed.success) throw new Error('the server sent analytics it couldn’t read.')
      if (request === latest.current) setAnalytics({ state: 'ready', value: parsed.data })
    } catch (error) {
      if (request === latest.current) setAnalytics({ state: 'error', message: error instanceof Error ? error.message : 'something went wrong.' })
    }
  }, [authFetch])

  return (
    <div className="hist-page">
      <SiteHeader />
      <main className="hist">
        <div className="hist-head">
          <div>
            <h1>Past simulations</h1>
            <p>Runs you’ve played in the simulator, newest first. They save on their own as they play.</p>
          </div>
          <button type="button" className="hist-refresh" onClick={() => void loadRuns()} disabled={refreshing}>
            <RefreshCw size={15} className={refreshing ? 'hist-spin' : undefined} aria-hidden="true" />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {/* The details column only appears once there are runs to choose from. */}
        <div className={`hist-body${hasRuns ? '' : ' is-single'}`}>
          <section className="hist-list" aria-label="Your runs">
            <RunList runs={runs} selected={selected} onOpen={(run) => void open(run)} onRetry={() => void loadRuns()} />
          </section>
          {hasRuns && (
            <section className="hist-detail" aria-live="polite" aria-label="Run details">
              <Details run={selected} analytics={analytics} onRetry={() => selected && void open(selected)} />
            </section>
          )}
        </div>
      </main>
    </div>
  )
}

function RunList({ runs, selected, onOpen, onRetry }: { runs: Load<RunSummary[]>; selected: RunSummary | null; onOpen: (run: RunSummary) => void; onRetry: () => void }) {
  if (runs.state === 'loading') return <p className="hist-note" role="status"><LoaderCircle size={16} className="hist-spin" aria-hidden="true" /> Loading your runs…</p>
  if (runs.state === 'error') {
    return (
      <div className="hist-empty" role="alert">
        <h2>Couldn’t load your runs</h2>
        <p>The server said: {runs.message}</p>
        <button type="button" className="hist-button" onClick={onRetry}>Try again</button>
      </div>
    )
  }
  if (runs.value.length === 0) {
    return (
      <div className="hist-empty">
        <h2>No runs yet</h2>
        <p>Open a scenario in the simulator and press Play. Each run saves here as it plays, with every change you make.</p>
        <a className="hist-button" href="/sim"><Play size={15} aria-hidden="true" /> Open the simulator</a>
      </div>
    )
  }
  return (
    <ol className="hist-runs">
      {runs.value.map((run) => {
        const identity = runIdentity(run.simulationId)
        const current = selected?.runId === run.runId
        return (
          <li key={run.runId} className={current ? 'is-current' : undefined}>
            <button type="button" className="hist-run" aria-pressed={current} onClick={() => onOpen(run)}>
              <span className="hist-run-name">{identity.title}</span>
              <span className="hist-run-when">{when(run.startedAt)}</span>
              <span className="hist-run-meta">
                {plural(run.interventionCount, 'change', 'changes')} · {plural(run.sampleCount, 'measurement', 'measurements')}
              </span>
            </button>
            {identity.scenario && (
              <a className="hist-open" href={`/sim?scenario=${encodeURIComponent(identity.scenario)}`} title={`Open ${identity.title} in the simulator`}>
                Open <ArrowRight size={14} aria-hidden="true" />
              </a>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function Details({ run, analytics, onRetry }: { run: RunSummary | null; analytics: Load<RunAnalytics> | null; onRetry: () => void }) {
  if (!run || !analytics) {
    return <p className="hist-placeholder">Choose a run to see where it got busiest and what each change did.</p>
  }
  const identity = runIdentity(run.simulationId)
  const unit = identity.metres ? 'people/m²' : ''
  const density = (value: number | null) => (value === null ? '—' : value.toFixed(2))
  return (
    <>
      <header className="hist-detail-head">
        <h2>{identity.title}</h2>
        <p>{when(run.startedAt)}</p>
      </header>
      {analytics.state === 'loading' && <p className="hist-note" role="status"><LoaderCircle size={16} className="hist-spin" aria-hidden="true" /> Loading this run…</p>}
      {analytics.state === 'error' && (
        <div role="alert" className="hist-problem">
          <p>Couldn’t load this run: {analytics.message}</p>
          <button type="button" className="hist-link" onClick={onRetry}>Try again</button>
        </div>
      )}
      {analytics.state === 'ready' && (
        <>
          <h3>Busiest spots</h3>
          {analytics.value.peakDensityByZone.length > 0 ? (
            <table className="hist-table">
              <thead><tr><th scope="col">Area</th><th scope="col" className="num">Peak density{unit && <span> {unit}</span>}</th><th scope="col" className="num">At</th></tr></thead>
              <tbody>
                {[...analytics.value.peakDensityByZone].sort((a, b) => b.peakDensity - a.peakDensity).map((zone) => (
                  <tr key={zone.zoneId}>
                    <th scope="row">{readable(zone.zoneId)}</th>
                    <td className="num">{density(zone.peakDensity)}</td>
                    <td className="num">{formatClock(zone.at, false)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="hist-note">Nothing was measured in this run yet.</p>}

          <h3>Changes and what they did</h3>
          {analytics.value.interventions.length > 0 ? (
            <ol className="hist-changes">
              {analytics.value.interventions.map((change) => (
                <li key={change.requestId}>
                  <p className="hist-change-what"><time>{formatClock(change.at, false)}</time> {change.prompt}</p>
                  {change.comparisons.length > 0 ? (
                    <table className="hist-table is-compact">
                      <thead><tr><th scope="col">Area</th><th scope="col" className="num">Before</th><th scope="col" className="num">After</th></tr></thead>
                      <tbody>
                        {change.comparisons.map((zone) => {
                          const delta = zone.beforeDensity !== null && zone.afterDensity !== null ? zone.afterDensity - zone.beforeDensity : null
                          const trend = delta === null || Math.abs(delta) < 0.005 ? null : delta < 0 ? 'down' : 'up'
                          return (
                            <tr key={zone.zoneId}>
                              <th scope="row">{readable(zone.zoneId)}</th>
                              <td className="num">{density(zone.beforeDensity)}</td>
                              <td className={`num${trend ? ` is-${trend}` : ''}`}>
                                {trend === 'down' && <TrendingDown size={13} aria-label="less crowded" />}
                                {trend === 'up' && <TrendingUp size={13} aria-label="more crowded" />}
                                {density(zone.afterDensity)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  ) : <p className="hist-note">Not enough was measured around this change to compare.</p>}
                </li>
              ))}
            </ol>
          ) : <p className="hist-note">No changes were made in this run.</p>}
          <p className="hist-fine">{plural(analytics.value.sampleCount, 'measurement', 'measurements')} saved. Densities are averages over each area.</p>
        </>
      )}
    </>
  )
}
