import { useRef, useState, type DragEvent } from 'react'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/manrope'
import { ArrowLeft, Check, ImageUp, Maximize2, Minus, Plus } from 'lucide-react'
import { LIMITS } from '../sim/scenario.ts'
import '../sim/simulator.css'
import './editor.css'
import { PlanCanvas, type PlanCanvasHandle } from './PlanCanvas.tsx'
import { loadPlan, type LoadedPlan } from './loadPlan.ts'
import { ACCEPTED_TYPES } from './source.ts'

/** The editor's steps (Technical PRD §7). Later steps unlock as earlier ones are done. */
const STEPS = [
  { id: 'upload', label: 'Upload' },
  { id: 'walls', label: 'Walls' },
  { id: 'scale', label: 'Scale' },
  { id: 'rooms', label: 'Rooms' },
  { id: 'doors', label: 'Doors' },
  { id: 'check', label: 'Check & save' },
] as const
type StepId = (typeof STEPS)[number]['id']

/** Floating layout, in CSS pixels; editor.css uses the same numbers. */
const LAYOUT = { gap: 12, top: 52, panel: 340 }

/**
 * The floor-plan editor at /editor: upload a plan, trace walls, set the scale, name rooms,
 * mark doors, then check and save it as a venue the simulator can load. A person traces and
 * confirms everything; automatic help (wall detection, room fill) only makes drafts.
 */
export default function EditorApp() {
  const [plan, setPlan] = useState<LoadedPlan | null>(null)
  const [step, setStep] = useState<StepId>('upload')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const canvasRef = useRef<PlanCanvasHandle>(null)
  const reached = plan ? 1 : 0 // Steps after Upload arrive one at a time.

  const open = async (file: File | undefined) => {
    if (!file) return
    setLoading(true)
    setError(null)
    const loaded = await loadPlan(file, LIMITS)
    setLoading(false)
    if (!loaded.ok) {
      setError(loaded.error.message)
      return
    }
    setPlan(loaded.value)
    setStep('upload')
  }

  const insets = { top: LAYOUT.gap * 2 + LAYOUT.top, right: LAYOUT.gap * 2 + LAYOUT.panel, bottom: LAYOUT.gap, left: LAYOUT.gap }

  return (
    <div className="sim editor">
      {plan && <PlanCanvas ref={canvasRef} pixels={plan.pixels} insets={insets} />}

      <header className="sim-float sim-topbar editor-topbar">
        <a className="editor-back" href="/sim" title="Back to the simulator"><ArrowLeft size={16} aria-hidden="true" /><span className="visually-hidden">Back to the simulator</span></a>
        <p className="sim-brand">Floor plan editor</p>
        <ol className="editor-steps" aria-label="Steps">
          {STEPS.map(({ id, label }, index) => {
            const available = index <= reached
            const current = id === step
            const done = index < STEPS.findIndex((s) => s.id === step)
            return (
              <li key={id}>
                <button type="button" disabled={!available} aria-current={current ? 'step' : undefined} onClick={() => setStep(id)}>
                  <span className="editor-step-number" aria-hidden="true">{done ? <Check size={12} strokeWidth={3} /> : index + 1}</span>
                  {label}
                </button>
              </li>
            )
          })}
        </ol>
      </header>

      {!plan ? (
        <Dropzone onFile={open} loading={loading} error={error} />
      ) : (
        <>
          <aside className="sim-float editor-panel" aria-label="Step">
            <UploadStep plan={plan} onReplace={open} loading={loading} error={error} />
          </aside>
          <div className="sim-float sim-zoom editor-zoom" role="group" aria-label="Zoom">
            <button type="button" className="sim-icon-btn" aria-label="Zoom in" onClick={() => canvasRef.current?.zoom(1.25)}><Plus size={15} /></button>
            <button type="button" className="sim-icon-btn" aria-label="Zoom out" onClick={() => canvasRef.current?.zoom(1 / 1.25)}><Minus size={15} /></button>
            <button type="button" className="sim-icon-btn" aria-label="Fit plan to view" onClick={() => canvasRef.current?.fit()}><Maximize2 size={14} /></button>
          </div>
        </>
      )}
    </div>
  )
}

/** The empty editor: drop a plan here, or pick one. */
function Dropzone({ onFile, loading, error }: { onFile: (file: File | undefined) => void; loading: boolean; error: string | null }) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const drop = (event: DragEvent) => {
    event.preventDefault()
    setOver(false)
    onFile(event.dataTransfer.files[0])
  }
  return (
    <div className="editor-empty">
      <div className={`sim-float editor-drop${over ? ' is-over' : ''}`}
        onDragOver={(event) => { event.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={drop}>
        <ImageUp size={32} strokeWidth={1.6} aria-hidden="true" />
        <h1>Upload a floor plan</h1>
        <p className="sim-muted">Drop a PNG or JPG here. A clean, top-down plan with dark walls works best: an architect’s drawing, a fire-escape plan or a screenshot.</p>
        <button type="button" className="sim-action" onClick={() => input.current?.click()} disabled={loading}>
          {loading ? 'Reading the image…' : 'Choose an image'}
        </button>
        <input ref={input} type="file" accept={ACCEPTED_TYPES.join(',')} hidden onChange={(event) => onFile(event.target.files?.[0])} />
        {error && <p className="sim-error" role="alert">{error}</p>}
        <p className="sim-muted editor-drop-note">Next you’ll trace walls, set the scale, name rooms and mark doors. Nothing is uploaded anywhere; it stays in your browser.</p>
      </div>
    </div>
  )
}

/** Step 1, once a plan is loaded: what was loaded, and a way to swap it. */
function UploadStep({ plan, onReplace, loading, error }: { plan: LoadedPlan; onReplace: (file: File | undefined) => void; loading: boolean; error: string | null }) {
  const input = useRef<HTMLInputElement>(null)
  const scaled = plan.original.width !== plan.source.pixelWidth
  return (
    <section className="sim-section">
      <h3>1 · Upload</h3>
      <p className="editor-file">{plan.fileName}</p>
      <dl className="sim-facts">
        <div><dt>Size</dt><dd>{plan.source.pixelWidth} × {plan.source.pixelHeight} px</dd></div>
        {scaled && <div><dt>Note</dt><dd>Scaled down from {plan.original.width} × {plan.original.height} px to stay within one million pixels.</dd></div>}
      </dl>
      <p className="sim-muted">Drag to move around the plan and scroll to zoom. Check the walls are clear and dark; next you’ll trace them.</p>
      <div className="sim-actions">
        <button type="button" className="sim-action editor-secondary" onClick={() => input.current?.click()} disabled={loading}>Use another image</button>
        <button type="button" className="sim-action" disabled title="Tracing walls arrives in the next step">Next: walls</button>
      </div>
      <input ref={input} type="file" accept={ACCEPTED_TYPES.join(',')} hidden onChange={(event) => onReplace(event.target.files?.[0])} />
      {error && <p className="sim-error" role="alert">{error}</p>}
    </section>
  )
}
