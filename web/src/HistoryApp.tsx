import { GEMINI_ENABLED } from './features.ts'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckSquare, FileText, LoaderCircle, MessageSquareText, Plus, Printer, RefreshCw, RotateCcw, Trash2, Upload } from 'lucide-react'
import { RunSummariesSchema, type RunSummary } from '@crowd-control/contract'
import { ReportView } from './ReportView.tsx'
import { loadReport, writeReport, type SavedReport } from './reports.ts'
import { SiteHeader } from './site/Site.tsx'
import { useAuthFetch } from './site/useAuthFetch.ts'
import { runIdentity } from './sim/runNames.ts'
import './history.css'

/**
 * Past runs, the home page: the signed-in person's saved runs, newest first, and the way to
 * start a new one. Choosing a run shows its safety report (written in the simulator's Analysis
 * tab, or here), with Replay and Delete.
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

/** A run's name: the title it was saved with, else what its simulation ID is known as here. */
const titleOf = (run: RunSummary) => run.title?.replace(/^Assistant: /, '') ?? runIdentity(run.simulationId).title

/** Runs saved with their scenario replay anywhere; older ones only if the scenario is known here. */
const replayable = (run: RunSummary) => run.title !== undefined || runIdentity(run.simulationId).scenario !== null

/** The two ways to start: trace your own venue, or describe the scenario to the assistant. */
function NewSimulation() {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [open])
  return (
    <div className="hist-new" ref={root}>
      <button type="button" className="hist-button" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((value) => !value)}>
        <Plus size={16} aria-hidden="true" /> New simulation
      </button>
      {open && (
        <div className="hist-new-menu" role="menu" aria-label="New simulation">
          <a href="/editor" role="menuitem">
            <Upload size={18} aria-hidden="true" />
            <span><strong>Upload a floor plan</strong><span>Trace your venue’s walls, rooms and doors, then run crowds on it.</span></span>
          </a>
          {!GEMINI_ENABLED && <a href="/sim" role="menuitem"><Plus size={18} aria-hidden="true" /><span><strong>Sample simulation</strong><span>Run one of the prepared scenarios.</span></span></a>}
          {GEMINI_ENABLED && <a href="/sim?new" role="menuitem">
            <MessageSquareText size={18} aria-hidden="true" />
            <span><strong>Just describe it</strong><span>Tell the assistant what happens; it uses one of our venues or makes up a building.</span></span>
          </a>}
        </div>
      )}
    </div>
  )
}

export default function HistoryApp() {
  const authFetch = useAuthFetch()
  const [runs, setRuns] = useState<Load<RunSummary[]>>({ state: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [selected, setSelected] = useState<RunSummary | null>(null)
  const hasRuns = runs.state === 'ready' && runs.value.length > 0

  const loadRuns = useCallback(async () => {
    setRefreshing(true)
    try {
      const response = await authFetch('/api/runs')
      const payload = await response.json().catch(() => null) as { runs?: unknown; error?: string } | null
      if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`)
      const parsed = RunSummariesSchema.safeParse(payload?.runs)
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

  /** Deletes a run for good; returns why not, or null when it's gone. */
  const remove = async (run: RunSummary): Promise<string | null> => {
    try {
      const response = await authFetch(`/api/runs/${run.runId}`, { method: 'DELETE' })
      if (!response.ok && response.status !== 404) {
        const payload = await response.json().catch(() => null) as { error?: string } | null
        return payload?.error ?? `HTTP ${response.status}`
      }
    } catch {
      return 'the server can’t be reached'
    }
    setRuns((current) => (current.state === 'ready' ? { state: 'ready', value: current.value.filter((r) => r.runId !== run.runId) } : current))
    setSelected(null)
    return null
  }
  /** A report was written here: the list shows it has one. */
  const reported = (run: RunSummary) => setRuns((current) => (current.state === 'ready'
    ? { state: 'ready', value: current.value.map((r) => (r.runId === run.runId ? { ...r, hasReport: true } : r)) }
    : current))

  return (
    <div className="hist-page">
      <SiteHeader />
      <main className="hist">
        <div className="hist-head">
          <div>
            <h1>Past runs</h1>
            <p>{GEMINI_ENABLED ? 'Every simulation you’ve played, newest first, with its safety report. Start a new one from your own floor plan or just by describing it.' : 'Every simulation you’ve played, newest first. Start a simulation from your own floor plan.'}</p>
          </div>
          <div className="hist-head-actions">
            <button type="button" className="hist-refresh" onClick={() => void loadRuns()} disabled={refreshing} aria-label="Refresh the list" title="Refresh the list">
              <RefreshCw size={15} className={refreshing ? 'hist-spin' : undefined} aria-hidden="true" />
            </button>
            <NewSimulation />
          </div>
        </div>

        {/* The details column only appears once there are runs to choose from. */}
        <div className={`hist-body${hasRuns ? '' : ' is-single'}`}>
          <section className="hist-list" aria-label="Your runs">
            <RunList runs={runs} selected={selected} onOpen={setSelected} onRetry={() => void loadRuns()} onDelete={remove} />
          </section>
          {hasRuns && (
            <section className="hist-detail" aria-live="polite" aria-label="Run details">
              <Details key={selected?.runId ?? 'none'} run={selected} onDelete={remove} onReported={reported} />
            </section>
          )}
        </div>
      </main>
    </div>
  )
}

/**
 * The list of runs. Each row opens the run, replays it, or deletes it (confirmed in the row).
 * "Select" switches to ticking several runs and deleting them together.
 */
function RunList({ runs, selected, onOpen, onRetry, onDelete }: {
  runs: Load<RunSummary[]>; selected: RunSummary | null; onOpen: (run: RunSummary) => void; onRetry: () => void
  onDelete: (run: RunSummary) => Promise<string | null>
}) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [confirmBulk, setConfirmBulk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

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
        <p>Press <strong>New simulation</strong> to start one. Every run saves here as it plays, with the changes you make.</p>
      </div>
    )
  }

  const all = runs.value
  const toggle = (id: string) => setPicked((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const stopSelecting = () => { setSelecting(false); setPicked(new Set()); setConfirmBulk(false); setProblem(null) }
  /** Deletes one run, or every picked run in turn; a failure stops and says why. */
  const remove = async (targets: RunSummary[]) => {
    setBusy(true)
    setProblem(null)
    for (const run of targets) {
      const error = await onDelete(run)
      if (error) { setProblem(`Couldn’t delete “${titleOf(run)}”: ${error}`); break }
    }
    setBusy(false)
    setConfirming(null)
    setConfirmBulk(false)
    setPicked(new Set())
  }
  const chosen = all.filter((run) => picked.has(run.runId))

  return (
    <>
      <div className="hist-list-bar">
        {selecting ? (
          <>
            <label className="hist-check">
              <input type="checkbox" checked={picked.size === all.length} ref={(box) => { if (box) box.indeterminate = picked.size > 0 && picked.size < all.length }}
                onChange={() => setPicked(picked.size === all.length ? new Set() : new Set(all.map((run) => run.runId)))} />
              <span>{picked.size > 0 ? `${picked.size} selected` : 'Select all'}</span>
            </label>
            {confirmBulk ? (
              <span className="hist-confirm" role="group" aria-label="Confirm delete">
                <span>Delete {plural(chosen.length, 'run', 'runs')} and their reports?</span>
                <button type="button" className="hist-danger" disabled={busy} onClick={() => void remove(chosen)}>{busy ? 'Deleting…' : 'Delete'}</button>
                <button type="button" className="hist-link" disabled={busy} onClick={() => setConfirmBulk(false)}>Cancel</button>
              </span>
            ) : (
              <span className="hist-list-bar-actions">
                <button type="button" className="hist-danger" disabled={picked.size === 0} onClick={() => setConfirmBulk(true)}>
                  <Trash2 size={14} aria-hidden="true" /> Delete{picked.size > 0 ? ` ${picked.size}` : ''}
                </button>
                <button type="button" className="hist-link" onClick={stopSelecting}>Done</button>
              </span>
            )}
          </>
        ) : (
          <>
            <span className="hist-list-count">{plural(all.length, 'run', 'runs')}</span>
            <button type="button" className="hist-quiet" onClick={() => { setSelecting(true); setConfirming(null) }}>
              <CheckSquare size={14} aria-hidden="true" /> Select
            </button>
          </>
        )}
      </div>
      {problem && <p className="hist-problem hist-list-problem" role="alert">{problem}</p>}
      <ol className="hist-runs">
        {all.map((run) => {
          const current = selected?.runId === run.runId
          const ticked = picked.has(run.runId)
          return (
            <li key={run.runId} className={[current && !selecting ? 'is-current' : '', ticked ? 'is-picked' : ''].filter(Boolean).join(' ') || undefined}>
              {selecting && (
                <input type="checkbox" className="hist-row-check" checked={ticked} onChange={() => toggle(run.runId)} aria-label={`Select ${titleOf(run)}, ${when(run.startedAt)}`} />
              )}
              <button type="button" className="hist-run" aria-pressed={selecting ? ticked : current} onClick={() => (selecting ? toggle(run.runId) : onOpen(run))}>
                <span className="hist-run-name">{titleOf(run)}</span>
                <span className="hist-run-when">{when(run.startedAt)}</span>
                <span className="hist-run-meta">
                  {plural(run.interventionCount, 'change', 'changes')}
                  {GEMINI_ENABLED && run.hasReport && <span className="hist-has-report"><FileText size={12} aria-hidden="true" /> Report</span>}
                </span>
              </button>
              {!selecting && (confirming === run.runId ? (
                <span className="hist-confirm hist-row-confirm" role="group" aria-label={`Confirm deleting ${titleOf(run)}`}>
                  <span>Delete?</span>
                  <button type="button" className="hist-danger" disabled={busy} onClick={() => void remove([run])}>{busy ? 'Deleting…' : 'Delete'}</button>
                  <button type="button" className="hist-link" disabled={busy} onClick={() => setConfirming(null)}>Cancel</button>
                </span>
              ) : (
                <span className="hist-row-actions">
                  {replayable(run) && (
                    <a className="hist-open" href={`/sim?replay=${encodeURIComponent(run.runId)}`}
                      title={run.interventionCount > 0 ? `Run ${titleOf(run)} again, with your ${plural(run.interventionCount, 'change', 'changes')} at the same moments` : `Run ${titleOf(run)} again`}>
                      <RotateCcw size={14} aria-hidden="true" /> Replay
                    </a>
                  )}
                  <button type="button" className="hist-row-delete" onClick={() => setConfirming(run.runId)}
                    aria-label={`Delete ${titleOf(run)}, ${when(run.startedAt)}`} title="Delete this run">
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </li>
          )
        })}
      </ol>
    </>
  )
}

type ReportState = { state: 'loading' | 'writing' | 'none' } | { state: 'error'; message: string } | { state: 'ready'; saved: SavedReport }

/** The chosen run: its report (or a way to write one), Replay, Print and Delete. */
function Details({ run, onDelete, onReported }: { run: RunSummary | null; onDelete: (run: RunSummary) => Promise<string | null>; onReported: (run: RunSummary) => void }) {
  const authFetch = useAuthFetch()
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null })
  const [report, setReport] = useState<ReportState>({ state: 'loading' })
  const metres = run ? runIdentity(run.simulationId).metres === true : false

  useEffect(() => {
    if (!run || !GEMINI_ENABLED) return
    let cancelled = false
    void loadReport(authFetch, run.runId)
      .then((saved) => { if (!cancelled) setReport(saved ? { state: 'ready', saved } : { state: 'none' }) })
      .catch((error: unknown) => { if (!cancelled) setReport({ state: 'error', message: error instanceof Error ? error.message : 'something went wrong' }) })
    return () => { cancelled = true }
  }, [authFetch, run])

  if (!run) return <p className="hist-placeholder">{GEMINI_ENABLED ? 'Choose a run to read its safety report, replay it, or delete it.' : 'Choose a run to replay or delete it.'}</p>

  const write = async () => {
    setReport({ state: 'writing' })
    try {
      const saved = await writeReport(authFetch, run.runId, metres)
      setReport({ state: 'ready', saved })
      onReported(run)
    } catch (error) {
      setReport({ state: 'error', message: error instanceof Error ? error.message : 'something went wrong' })
    }
  }
  const reallyDelete = async () => {
    setDeleting({ busy: true, error: null })
    const error = await onDelete(run)
    if (error) setDeleting({ busy: false, error })
  }
  const printable = `/report?run=${encodeURIComponent(run.runId)}${metres ? '&units=m' : ''}`

  return (
    <>
      <header className="hist-detail-head">
        <h2>{titleOf(run)}</h2>
        <p>{when(run.startedAt)} · {plural(run.interventionCount, 'change', 'changes')}</p>
        <div className="hist-detail-actions">
          {replayable(run) && <a className="hist-button" href={`/sim?replay=${encodeURIComponent(run.runId)}`}><RotateCcw size={15} aria-hidden="true" /> Replay</a>}
          {GEMINI_ENABLED && report.state === 'ready' && <a className="hist-quiet" href={printable}><Printer size={14} aria-hidden="true" /> Print</a>}
          {confirming ? (
            <span className="hist-confirm" role="group" aria-label="Confirm delete">
              <span>Delete this run and its report for good?</span>
              <button type="button" className="hist-danger" onClick={() => void reallyDelete()} disabled={deleting.busy}>{deleting.busy ? 'Deleting…' : 'Delete'}</button>
              <button type="button" className="hist-link" onClick={() => setConfirming(false)} disabled={deleting.busy}>Cancel</button>
            </span>
          ) : (
            <button type="button" className="hist-quiet" onClick={() => setConfirming(true)}><Trash2 size={14} aria-hidden="true" /> Delete</button>
          )}
        </div>
        {deleting.error && <p className="hist-problem" role="alert">Couldn’t delete it: {deleting.error}</p>}
      </header>

      {GEMINI_ENABLED && <>
      {report.state === 'loading' && <p className="hist-note" role="status"><LoaderCircle size={16} className="hist-spin" aria-hidden="true" /> Loading the report…</p>}
      {report.state === 'writing' && <p className="hist-note" role="status"><LoaderCircle size={16} className="hist-spin" aria-hidden="true" /> Writing the safety report… this usually takes 10 to 30 seconds.</p>}
      {report.state === 'none' && (
        <div className="hist-report-empty">
          <p>No safety report for this run yet. Write one from what was measured while it played.</p>
          <button type="button" className="hist-button" onClick={() => void write()}><FileText size={15} aria-hidden="true" /> Write the report</button>
        </div>
      )}
      {report.state === 'error' && (
        <div role="alert" className="hist-problem">
          <p>Couldn’t show the report: {report.message}</p>
          <button type="button" className="hist-link" onClick={() => void write()}>Write it again</button>
        </div>
      )}
      {report.state === 'ready' && <ReportView {...report.saved} compact />}
      </>}
    </>
  )
}
