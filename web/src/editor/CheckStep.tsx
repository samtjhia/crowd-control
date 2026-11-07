import { CircleAlert, CircleCheck, ExternalLink, Save, TriangleAlert } from 'lucide-react'
import { formatMetres } from './scale.ts'
import type { Check } from './useCheck.ts'

/** Step 6: the result of turning the tracing into the simulation grid, problems to fix, and saving. */
export function CheckStep({ check, onBack }: { check: Check; onBack: () => void }) {
  const { result } = check
  if (!result) return <section className="sim-section"><h3>6 · Check &amp; save</h3><p className="sim-muted">Checking…</p></section>
  const errors = result.problems.filter((p) => p.severity === 'error')
  const warnings = result.problems.filter((p) => p.severity === 'warning')
  const { grid } = result
  const rooms = grid.zoneIds.length - 1, doors = grid.portalIds.length - 1
  const cell = grid.units === 'm' ? formatMetres(grid.cellSize) : 'half a body'
  return (
    <section className="sim-section">
      <h3>6 · Check &amp; save</h3>
      <p className="sim-muted">This is how the simulation will see your plan: {grid.width} × {grid.height} cells of {cell}, {rooms} {rooms === 1 ? 'room' : 'rooms'} and {doors} {doors === 1 ? 'door' : 'doors'}.</p>

      <label className="editor-check">
        <input type="checkbox" checked={check.preview} onChange={(event) => check.setPreview(event.target.checked)} />
        Show the simulation grid
      </label>

      {errors.length === 0 ? (
        <p className="editor-ok" role="status"><CircleCheck size={15} aria-hidden="true" /> Every room can be reached. Ready to save.</p>
      ) : (
        <p className="editor-warning editor-error" role="status"><CircleAlert size={15} aria-hidden="true" /> {errors.length} {errors.length === 1 ? 'problem needs' : 'problems need'} fixing before saving.</p>
      )}
      {result.problems.length > 0 && (
        <ul className="editor-problems">
          {[...errors, ...warnings].map((problem, k) => (
            <li key={k}>
              <button type="button" className={`editor-problem is-${problem.severity}${check.focus === problem ? ' is-focused' : ''}`}
                onClick={() => check.setFocus(check.focus === problem ? null : problem)} disabled={!problem.at}>
                {problem.severity === 'error' ? <CircleAlert size={14} aria-hidden="true" /> : <TriangleAlert size={14} aria-hidden="true" />}
                <span>{problem.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="sim-link" onClick={check.run}>Check again</button>

      <div className="editor-field">
        <label htmlFor="venue-name">Venue name</label>
        <input id="venue-name" className="editor-text" value={check.name} maxLength={80} onChange={(event) => check.setName(event.target.value)} />
      </div>
      <div className="editor-field">
        <label htmlFor="venue-floor">Floor</label>
        <input id="venue-floor" className="editor-text" value={check.floor} maxLength={60} onChange={(event) => check.setFloor(event.target.value)} />
      </div>

      {check.saveError && <p className="sim-error" role="alert">{check.saveError}</p>}
      {check.saved ? (
        <div className="editor-saved">
          <p className="editor-ok" role="status"><CircleCheck size={15} aria-hidden="true" /> Saved in this browser.</p>
          <a className="sim-action" href={`/sim?scenario=${encodeURIComponent(check.saved.scenario)}`}>
            <ExternalLink size={14} aria-hidden="true" /> Open in the simulator
          </a>
        </div>
      ) : null}
      <p className="editor-hint">Saved venues stay in this browser for now; signing in to keep them across devices comes later.</p>

      <div className="sim-actions editor-step-nav">
        <button type="button" className="sim-action editor-secondary" onClick={onBack}>Back</button>
        <button type="button" className="sim-action" onClick={check.save} disabled={!result.map}><Save size={14} aria-hidden="true" /> {check.saved ? 'Save again' : 'Save venue'}</button>
      </div>
    </section>
  )
}
