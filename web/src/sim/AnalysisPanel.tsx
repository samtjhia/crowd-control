import { useState } from 'react'
import { ExternalLink, FileText, LoaderCircle, RefreshCw } from 'lucide-react'
import { ReportView } from '../ReportView.tsx'
import { writeReport, type SavedReport } from '../reports.ts'
import { useAuthFetch } from '../site/useAuthFetch.ts'
import type { SimulationView } from '../worker/simulationClient.ts'

/** How much of the run must have played before a report has something to say. */
const ENOUGH_SECONDS = 5

type State = { state: 'idle' | 'writing' } | { state: 'error'; message: string } | { state: 'ready'; saved: SavedReport }

/**
 * The Analysis tab: writes the AI safety report for the run on screen, from what has been
 * measured so far, and shows it here. The run is saved first, so the report is kept with it
 * and also appears in Past runs. Before the run has played, it says so.
 */
export function AnalysisPanel({ view, runId, flush }: { view: SimulationView; runId: string | null; flush: () => Promise<boolean> }) {
  const authFetch = useAuthFetch()
  const [state, setState] = useState<State>({ state: 'idle' })
  const played = (view.current?.frame.time ?? 0) >= ENOUGH_SECONDS
  const metres = view.scene?.map.units === 'm'

  const write = async () => {
    setState({ state: 'writing' })
    try {
      // Everything measured so far goes to the account first; the report is written from it.
      if (!(await flush()) || !runId) throw new Error('this run couldn’t be saved, so there’s nothing to write from yet. Check you’re signed in and try again')
      setState({ state: 'ready', saved: await writeReport(authFetch, runId, metres) })
    } catch (error) {
      setState({ state: 'error', message: error instanceof Error ? error.message : 'something went wrong' })
    }
  }

  if (!view.scene) return <p className="sim-muted sim-analysis-note">Load a scenario first. Its safety report is written here after it has played.</p>
  if (state.state === 'ready') {
    return (
      <div className="sim-analysis">
        <ReportView {...state.saved} compact />
        <div className="sim-analysis-actions">
          <button type="button" className="sim-action editor-secondary" onClick={() => void write()} title="Writes it again from everything measured up to now">
            <RefreshCw size={14} aria-hidden="true" /> Write again
          </button>
          {runId && (
            <a className="sim-link" href={`/report?run=${encodeURIComponent(runId)}${metres ? '&units=m' : ''}`} target="_blank" rel="noreferrer">
              <ExternalLink size={13} aria-hidden="true" /> Printable report
            </a>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className="sim-analysis sim-analysis-start">
      <p className="sim-analysis-title">Safety report</p>
      {played ? (
        <p className="sim-muted">Writes a one-page report on this run so far: where and when it got crowded, how long clearing took, and what your changes did. It’s also saved with the run in Past runs.</p>
      ) : (
        <p className="sim-muted">Press Play and let the simulation run for a while. Once something has happened, come back here to write its safety report.</p>
      )}
      {state.state === 'error' && <p className="sim-error" role="alert">Couldn’t write it: {state.message}.</p>}
      <button type="button" className="sim-action" onClick={() => void write()} disabled={!played || state.state === 'writing'}>
        {state.state === 'writing'
          ? <><LoaderCircle size={14} className="sim-spin" aria-hidden="true" /> Writing… (10 to 30 s)</>
          : <><FileText size={14} aria-hidden="true" /> Write safety report</>}
      </button>
    </div>
  )
}
