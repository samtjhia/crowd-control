import type { RunReport } from '@crowd-control/contract'
import type { SavedReport } from './reports.ts'
import { formatClock } from './sim/incidents.ts'
import { readable } from './sim/runNames.ts'
import './report.css'

/** A run's AI safety report, shared by the printable page, Past runs and the simulator's Analysis tab. */

/** How much a finding stands out within this run; not a safety rating (there are no validated thresholds). */
const SEVERITY: Record<RunReport['findings'][number]['severity'], string> = { high: 'Look at this first', medium: 'Worth watching', low: 'For the record' }

/**
 * The report itself. \`compact\` drops the busiest-spots table and tightens spacing for the
 * side panels; the full page shows everything.
 */
export function ReportView({ report, facts, compact = false }: SavedReport & { compact?: boolean }) {
  const clock = (t: number | null) => (t === null ? 'not reached' : formatClock(t, false))
  const total = facts.end ? facts.end.present + facts.end.departed : 0
  return (
    <article className={`report-body${compact ? ' is-compact' : ''}`}>
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
          <div><dt>Had left</dt><dd>{facts.end.departed}</dd></div>
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

      {!compact && facts.busiest.length > 0 && (
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
