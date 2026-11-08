import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, LoaderCircle, Printer, RefreshCw } from 'lucide-react'
import { ReportView } from './ReportView.tsx'
import { loadReport, writeReport, type SavedReport } from './reports.ts'
import { SiteHeader } from './site/Site.tsx'
import { useAuthFetch } from './site/useAuthFetch.ts'
import './history.css'
import './report.css'

/**
 * The printable safety report for one saved run (`/report?run=<id>`): the one written earlier if
 * there is one, otherwise Gemini writes it now from the run's measured facts.
 */

type State = { state: 'loading' | 'writing' } | { state: 'error'; message: string } | { state: 'ready'; saved: SavedReport }

export default function ReportApp() {
  const authFetch = useAuthFetch()
  const params = new URLSearchParams(window.location.search)
  const runId = params.get('run')
  const metres = params.get('units') === 'm'
  const [state, setState] = useState<State>({ state: 'loading' })

  const show = useCallback(async (rewrite: boolean) => {
    if (!runId) { setState({ state: 'error', message: 'No run was chosen. Open one from Past runs.' }); return }
    try {
      const existing = rewrite ? null : await loadReport(authFetch, runId)
      if (existing) { setState({ state: 'ready', saved: existing }); return }
      setState({ state: 'writing' })
      setState({ state: 'ready', saved: await writeReport(authFetch, runId, metres) })
    } catch (error) {
      setState({ state: 'error', message: error instanceof Error ? error.message : 'something went wrong' })
    }
  }, [authFetch, runId, metres])

  useEffect(() => {
    const timer = window.setTimeout(() => void show(false), 0)
    return () => window.clearTimeout(timer)
  }, [show])

  return (
    <div className="hist-page report-page">
      <SiteHeader />
      <main className="report">
        <div className="report-tools">
          <a className="hist-link report-back" href="/history"><ArrowLeft size={15} aria-hidden="true" /> Past runs</a>
          {state.state === 'ready' && (
            <span className="report-tool-buttons">
              <button type="button" className="hist-refresh" onClick={() => void show(true)}><RefreshCw size={15} aria-hidden="true" /> Write again</button>
              <button type="button" className="hist-button" onClick={() => window.print()}><Printer size={15} aria-hidden="true" /> Print or save as PDF</button>
            </span>
          )}
        </div>
        {(state.state === 'loading' || state.state === 'writing') && (
          <div className="report-sheet report-status" role="status">
            <LoaderCircle size={20} className="hist-spin" aria-hidden="true" />
            {state.state === 'writing'
              ? <><p><strong>Writing your safety report…</strong></p><p>Gemini is reading this run’s measurements. This usually takes 10 to 30 seconds.</p></>
              : <p><strong>Loading the report…</strong></p>}
          </div>
        )}
        {state.state === 'error' && (
          <div className="report-sheet report-status" role="alert">
            <p><strong>Couldn’t show the report</strong></p>
            <p>{state.message}</p>
            <button type="button" className="hist-button" onClick={() => void show(false)}>Try again</button>
          </div>
        )}
        {state.state === 'ready' && <div className="report-sheet"><ReportView {...state.saved} /></div>}
      </main>
    </div>
  )
}
