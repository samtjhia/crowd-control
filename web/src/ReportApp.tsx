import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, LoaderCircle, Printer, RefreshCw } from 'lucide-react'
import { RunReportSchema, type RunReport } from '@crowd-control/contract'
import { SiteHeader } from './site/Site.tsx'
import { useAuthFetch } from './site/useAuthFetch.ts'
import { formatClock } from './sim/incidents.ts'
import { readable } from './sim/runNames.ts'
import './history.css'
import './report.css'

/**
 * The AI safety report for one saved run (`/report?run=<id>`): written by Gemini on the server
 * from the run's measured facts, laid out as one printable page with the numbers it came from.
 */

type Facts = {
  scenario: string
  startedAt: string
  units: 'people/m²' | 'relative'
  measuredSeconds: number
  measurements: number
  end: { present: number; departed: number; immobile: number; clearance: { t50: number | null; t90: number | null; t100: number | null } } | null
  busiest: { zoneId: string; peakDensity: number; at: number }[]
}

type State = { state: 'writing' } | { state: 'error'; message: string } | { state: 'ready'; report: RunReport; facts: Facts }

const SEVERITY: Record<RunReport['findings'][number]['severity'], string> = { high: 'Needs action', medium: 'Worth watching', low: 'Fine' }

export default function ReportApp() {
  const authFetch = useAuthFetch()
  const params = new URLSearchParams(window.location.search)
  const runId = params.get('run')
  const metres = params.get('units') === 'm'
  const [state, setState] = useState<State>({ state: 'writing' })

  const write = useCallback(async () => {
    if (!runId) { setState({ state: 'error', message: 'No run was chosen. Open one from Past runs.' }); return }
    setState({ state: 'writing' })
    try {
      const response = await authFetch(`/api/runs/${encodeURIComponent(runId)}/report`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ units: metres ? 'm' : 'model' }),
      })
      const payload = await response.json().catch(() => null) as { report?: unknown; facts?: Facts; error?: string } | null
      if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`)
      const report = RunReportSchema.safeParse(payload?.report)
      if (!report.success || !payload?.facts) throw new Error('the report came back in a form that couldn’t be read')
      setState({ state: 'ready', report: report.data, facts: payload.facts })
    } catch (error) {
      setState({ state: 'error', message: error instanceof Error ? error.message : 'something went wrong' })
    }
  }, [authFetch, runId, metres])

  useEffect(() => {
    const timer = window.setTimeout(() => void write(), 0)
    return () => window.clearTimeout(timer)
  }, [write])

  return (
    <div className="hist-page report-page">
      <SiteHeader />
      <main className="report">
        <div className="report-tools">
          <a className="hist-link report-back" href="/history"><ArrowLeft size={15} aria-hidden="true" /> Past runs</a>
          {state.state === 'ready' && (
            <span className="report-tool-buttons">
              <button type="button" className="hist-refresh" onClick={() => void write()}><RefreshCw size={15} aria-hidden="true" /> Write again</button>
              <button type="button" className="hist-button" onClick={() => window.print()}><Printer size={15} aria-hidden="true" /> Print or save as PDF</button>
            </span>
          )}
        </div>
        {state.state === 'writing' && (
          <div className="report-sheet report-status" role="status">
            <LoaderCircle size={20} className="hist-spin" aria-hidden="true" />
            <p><strong>Writing your safety report…</strong></p>
            <p>Gemini is reading this run’s measurements. This usually takes 10 to 30 seconds.</p>
          </div>
        )}
        {state.state === 'error' && (
          <div className="report-sheet report-status" role="alert">
            <p><strong>Couldn’t write the report</strong></p>
            <p>{state.message}</p>
            <button type="button" className="hist-button" onClick={() => void write()}>Try again</button>
          </div>
        )}
        {state.state === 'ready' && <Sheet report={state.report} facts={state.facts} />}
      </main>
    </div>
  )
}

function Sheet({ report, facts }: { report: RunReport; facts: Facts }) {
  const clock = (t: number | null) => (t === null ? 'not reached' : formatClock(t, false))
  const total = facts.end ? facts.end.present + facts.end.departed : 0
  return (
    <article className="report-sheet">
      <header className="report-head">
        <h1>{report.title}</h1>
        <p className="report-meta">
          Crowd safety report for {facts.scenario} · run on {new Date(facts.startedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {formatClock(facts.measuredSeconds, false)} simulated
        </p>
      </header>

      <p className="report-summary">{report.summary}</p>

      {facts.end && (
        <dl className="report-figures">
          <div><dt>People</dt><dd>{total}</dd></div>
          <div><dt>Had left by the end</dt><dd>{facts.end.departed}</dd></div>
          <div><dt>Half out</dt><dd>{clock(facts.end.clearance.t50)}</dd></div>
          <div><dt>90% out</dt><dd>{clock(facts.end.clearance.t90)}</dd></div>
          <div><dt>Everyone out</dt><dd>{clock(facts.end.clearance.t100)}</dd></div>
        </dl>
      )}

      <h2>Findings</h2>
      <ol className="report-findings">
        {report.findings.map((finding) => (
          <li key={finding.heading} className={`is-${finding.severity}`}>
            <p className="report-finding-head">
              <span className="report-severity">{SEVERITY[finding.severity]}</span>
              <strong>{finding.heading}</strong>
            </p>
            {(finding.where || finding.when) && <p className="report-where">{[finding.where, finding.when].filter(Boolean).join(' · ')}</p>}
            <p>{finding.detail}</p>
          </li>
        ))}
      </ol>

      <h2>Recommendations</h2>
      <ol className="report-recommendations">
        {report.recommendations.map((recommendation) => <li key={recommendation}>{recommendation}</li>)}
      </ol>

      {facts.busiest.length > 0 && (
        <>
          <h2>Busiest spots</h2>
          <table className="hist-table">
            <thead><tr><th scope="col">Area</th><th scope="col" className="num">Peak density{facts.units === 'people/m²' && <span> people/m²</span>}</th><th scope="col" className="num">At</th></tr></thead>
            <tbody>
              {facts.busiest.slice(0, 6).map((zone) => (
                <tr key={zone.zoneId}><th scope="row">{readable(zone.zoneId)}</th><td className="num">{zone.peakDensity.toFixed(2)}</td><td className="num">{formatClock(zone.at, false)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <footer className="report-caveats">
        <h2>Limits of this report</h2>
        <ul>{report.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul>
        <p>Written by AI (Gemini) from {facts.measurements} measurements of a simulated run. Check it against your venue before acting on it.</p>
      </footer>
    </article>
  )
}
