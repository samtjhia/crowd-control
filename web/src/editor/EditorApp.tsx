import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/manrope'
import { ArrowLeft, Check, Crop, ImageUp, Maximize2, Minus, Plus } from 'lucide-react'
import { LIMITS } from '../sim/scenario.ts'
import '../sim/simulator.css'
import './editor.css'
import { PlanCanvas, type PlanCanvasHandle } from './PlanCanvas.tsx'
import { cropPlan, loadPlan, type LoadedPlan } from './loadPlan.ts'
import { ACCEPTED_TYPES } from './source.ts'
import { useCropTool, type CropTool } from './useCropTool.ts'
import { useScaleTool } from './useScaleTool.ts'
import { useRoomEditor } from './useRoomEditor.ts'
import { RoomsStep } from './RoomsStep.tsx'
import { useDoorEditor } from './useDoorEditor.ts'
import { DoorsStep } from './DoorsStep.tsx'
import { useWallEditor } from './useWallEditor.ts'
import { ScaleStep } from './ScaleStep.tsx'
import type { PlanCamera } from './planView.ts'
import { WallsStep } from './WallsStep.tsx'

/** The editor's steps (Technical PRD §7). Later steps unlock as earlier ones are done. */
const STEPS = [
  { id: 'upload', label: 'Upload' },
  { id: 'scale', label: 'Scale' },
  { id: 'walls', label: 'Walls' },
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
  const reached = plan ? 4 : 0 // Up to Doors (index 4); Check & save arrives next.
  const [fade, setFade] = useState(0.55)
  const redraw = useCallback(() => canvasRef.current?.redraw(), [])
  const crop = useCropTool(plan, redraw)
  const cameraOf = useCallback(() => canvasRef.current?.camera() ?? null, [])
  const scale = useScaleTool(plan, redraw, cameraOf)
  const metresPerPixel = scale.calibration?.metresPerPixel ?? null
  const walls = useWallEditor(plan, metresPerPixel, redraw)
  const measuring = step === 'scale'
  const rooms = useRoomEditor(plan, step === 'rooms', walls.readBlocked, metresPerPixel, redraw)
  const stepIndex = STEPS.findIndex((s) => s.id === step)
  const roomTool = step === 'rooms' && rooms.tool !== 'move'
  const doors = useDoorEditor(plan, step === 'doors', rooms.layer, metresPerPixel, redraw, cameraOf)
  const doorTool = step === 'doors' && doors.tool !== 'move'
  const tracing = stepIndex >= 2 // walls onward: fade the plan under the tracing
  const cropping = step === 'upload' && crop.active

  /** Everything traced so far, over the plan: walls, then the measuring line and scale bar. */
  const traced = useCallback((context: CanvasRenderingContext2D, camera: PlanCamera) => {
    if (stepIndex >= 3) rooms.drawOverlay(context, camera)
    if (stepIndex >= 2) walls.drawOverlay(context, camera, { brush: step === 'walls' })
    if (stepIndex >= 4) doors.drawOverlay(context, camera)
    scale.drawOverlay(context, camera, { measuring, metresPerPixel })
  }, [rooms, walls, doors, scale, step, stepIndex, measuring, metresPerPixel])

  /** Applies the crop box (or goes back to the whole image). Wall tracing starts again on the new image. */
  const applyCrop = async (box: Parameters<typeof cropPlan>[1]) => {
    if (!plan) return
    if (walls.canUndo && !window.confirm('Cropping changes the image, so your wall corrections will be cleared. Crop anyway?')) return
    setLoading(true)
    const next = await cropPlan(plan, box, LIMITS)
    setLoading(false)
    crop.cancel()
    setPlan(next)
  }

  // Walls shortcuts: tools, undo/redo and brush size. Typing in a field never triggers them.
  useEffect(() => {
    if (step !== 'walls') return
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest('input, textarea, select')) return
      const key = event.key.toLowerCase()
      const command = event.ctrlKey || event.metaKey
      if (command && key === 'z') { if (event.shiftKey) walls.redo(); else walls.undo() }
      else if (command && key === 'y') walls.redo()
      else if (command || event.altKey) return
      else if (key === 'm') walls.setTool('move')
      else if (key === 'w') walls.setTool('wall')
      else if (key === 'e') walls.setTool('erase')
      else if (key === 'o') walls.setTool('object')
      else if (key === '[') walls.setBrush(Math.max(1, walls.brush - 1))
      else if (key === ']') walls.setBrush(Math.min(40, walls.brush + 1))
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, walls])

  useEffect(() => {
    if (step !== 'rooms') return
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest('input, textarea, select')) return
      const key = event.key.toLowerCase()
      const command = event.ctrlKey || event.metaKey
      if (command && key === 'z') { if (event.shiftKey) rooms.redo(); else rooms.undo() }
      else if (command && key === 'y') rooms.redo()
      else if (command || event.altKey) return
      else if (key === 'f') rooms.setTool('fill')
      else if (key === 'l') rooms.setTool('split')
      else if (key === 'm') rooms.setTool('move')
      else if (key === 'escape') rooms.setSelected(null)
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, rooms])

  useEffect(() => {
    if (step !== 'doors') return
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest('input, textarea, select')) return
      const key = event.key.toLowerCase()
      const command = event.ctrlKey || event.metaKey
      if (command && key === 'z') { if (event.shiftKey) doors.redo(); else doors.undo() }
      else if (command && key === 'y') doors.redo()
      else if (command || event.altKey) return
      else if (key === 'v') doors.setTool('select')
      else if (key === 'd') doors.setTool('add')
      else if (key === 'm') doors.setTool('move')
      else if ((key === 'delete' || key === 'backspace') && doors.selected !== null) doors.remove(doors.selected)
      else if (key === 'escape') doors.setSelected(null)
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, doors])

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
      {plan && (
        <PlanCanvas ref={canvasRef} pixels={plan.pixels} insets={insets}
          imageOpacity={tracing ? fade : 1} drawOverlay={cropping ? crop.drawOverlay : stepIndex >= 1 ? traced : undefined}
          mode={cropping || measuring || roomTool || doorTool || (step === 'walls' && walls.tool !== 'move') ? 'draw' : 'pan'}
          drawCursor={step === 'doors' && doors.tool === 'select' ? 'pointer' : cropping || measuring || roomTool || doorTool ? 'crosshair' : 'none'}
          stroke={cropping ? crop.stroke : measuring ? scale.stroke : step === 'rooms' ? rooms.stroke : step === 'doors' ? doors.stroke : walls.stroke}
          onHover={step === 'walls' ? walls.onHover : undefined} />
      )}

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
            {step === 'upload' && <UploadStep plan={plan} onReplace={open} loading={loading} error={error} crop={crop} onApplyCrop={applyCrop} onNext={() => { crop.cancel(); setStep('scale') }} />}
            {step === 'scale' && <ScaleStep plan={plan} scale={scale} onBack={() => setStep('upload')} onNext={() => setStep('walls')} />}
            {step === 'walls' && <WallsStep walls={walls} fade={fade} onFade={setFade} onBack={() => setStep('scale')} onNext={() => setStep('rooms')} />}
            {step === 'rooms' && <RoomsStep rooms={rooms} onBack={() => setStep('walls')} onNext={() => setStep('doors')} />}
            {step === 'doors' && <DoorsStep doors={doors} onBack={() => setStep('rooms')} />}
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

/** Step 1, once a plan is loaded: what was loaded, cropping, and a way to swap it. */
function UploadStep({ plan, onReplace, loading, error, crop, onApplyCrop, onNext }: {
  plan: LoadedPlan; onReplace: (file: File | undefined) => void; loading: boolean; error: string | null
  crop: CropTool; onApplyCrop: (box: CropTool['box']) => void; onNext: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const area = plan.crop ?? plan.original
  const scaled = area.width !== plan.source.pixelWidth
  return (
    <section className="sim-section">
      <h3>1 · Upload</h3>
      <p className="editor-file">{plan.fileName}</p>
      <dl className="sim-facts">
        <div><dt>Size</dt><dd>{plan.source.pixelWidth} × {plan.source.pixelHeight} px</dd></div>
        {plan.crop && <div><dt>Cropped</dt><dd>to part of the {plan.original.width} × {plan.original.height} px image</dd></div>}
        {scaled && <div><dt>Note</dt><dd>Scaled down from {area.width} × {area.height} px to stay within one million pixels.</dd></div>}
      </dl>

      {crop.active ? (
        <div className="editor-crop">
          <p className="sim-muted">Drag a box around the building. Leave out title blocks, legends and empty margins. Drag again to redo it.</p>
          <div className="sim-actions">
            <button type="button" className="sim-action editor-secondary" onClick={crop.cancel}>Cancel</button>
            <button type="button" className="sim-action" onClick={() => onApplyCrop(crop.box)} disabled={!crop.box || loading}>Apply crop</button>
          </div>
        </div>
      ) : (
        <>
          <p className="sim-muted">Drag to move around the plan and scroll to zoom. Crop away anything that isn’t the building, except a legend that names the rooms. Next you’ll set the scale.</p>
          <div className="sim-actions">
            <button type="button" className="sim-action editor-secondary" onClick={crop.start} disabled={loading}><Crop size={14} aria-hidden="true" /> Crop</button>
            {plan.crop && <button type="button" className="sim-action editor-secondary" onClick={() => onApplyCrop(null)} disabled={loading}>Use the whole image</button>}
            <button type="button" className="sim-action editor-secondary" onClick={() => input.current?.click()} disabled={loading}>Use another image</button>
          </div>
        </>
      )}

      <div className="sim-actions editor-step-nav">
        <span />
        <button type="button" className="sim-action" onClick={onNext} disabled={crop.active}>Next: scale</button>
      </div>
      <input ref={input} type="file" accept={ACCEPTED_TYPES.join(',')} hidden onChange={(event) => onReplace(event.target.files?.[0])} />
      {error && <p className="sim-error" role="alert">{error}</p>}
    </section>
  )
}
