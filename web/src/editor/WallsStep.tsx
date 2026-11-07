import { Brush, Eraser, Hand, Redo2, Undo2 } from 'lucide-react'
import type { WallEditor, WallTool } from './useWallEditor.ts'

const TOOLS: { id: WallTool; label: string; key: string; Icon: typeof Brush }[] = [
  { id: 'move', label: 'Move', key: 'M', Icon: Hand },
  { id: 'wall', label: 'Wall', key: 'W', Icon: Brush },
  { id: 'erase', label: 'Erase', key: 'E', Icon: Eraser },
]

/**
 * Step 2: walls. The draft comes from how dark each pixel is; the person checks it and fixes
 * it with brushes (Technical PRD §7 steps 2–4). Red is what people will treat as solid wall.
 */
export function WallsStep({ walls, fade, onFade, onBack, onNext }: { walls: WallEditor; fade: number; onFade: (value: number) => void; onBack: () => void; onNext: () => void }) {
  return (
    <section className="sim-section">
      <h3>2 · Walls</h3>
      <p className="sim-muted">
        Red is what people will treat as solid wall. Fix anything wrong: room names and door symbols often show up as walls, and gaps in a wall let people walk through it.
      </p>

      <div className="editor-field">
        <label htmlFor="wall-threshold">Darkness cut-off <output htmlFor="wall-threshold">{walls.threshold}</output></label>
        <input id="wall-threshold" type="range" min={10} max={245} value={walls.threshold}
          onChange={(event) => walls.setThreshold(Number(event.target.value))} />
        <p className="editor-hint">Higher catches lighter lines as walls. <button type="button" className="sim-link" onClick={walls.resetThreshold}>Use the suggested value</button></p>
      </div>

      <label className="editor-check">
        <input type="checkbox" checked={walls.ignoreSpecks} onChange={(event) => walls.setIgnoreSpecks(event.target.checked)} />
        Ignore text and small marks
      </label>

      <div className="editor-field">
        <span className="editor-label">Brush</span>
        <div className="editor-segmented" role="radiogroup" aria-label="Wall tool">
          {TOOLS.map(({ id, label, key, Icon }) => (
            <button key={id} type="button" role="radio" aria-checked={walls.tool === id} onClick={() => walls.setTool(id)}
              aria-keyshortcuts={key} title={`${label} (${key})`}>
              <Icon size={15} aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="editor-field">
        <label htmlFor="wall-brush">Brush size <output htmlFor="wall-brush">{walls.brush} px</output></label>
        <input id="wall-brush" type="range" min={1} max={40} value={walls.brush} onChange={(event) => walls.setBrush(Number(event.target.value))} />
      </div>

      <div className="sim-actions">
        <button type="button" className="sim-action editor-secondary" onClick={walls.undo} disabled={!walls.canUndo} aria-keyshortcuts="Control+Z">
          <Undo2 size={14} aria-hidden="true" /> Undo
        </button>
        <button type="button" className="sim-action editor-secondary" onClick={walls.redo} disabled={!walls.canRedo} aria-keyshortcuts="Control+Shift+Z">
          <Redo2 size={14} aria-hidden="true" /> Redo
        </button>
      </div>

      <div className="editor-field">
        <label htmlFor="plan-fade">Plan visibility</label>
        <input id="plan-fade" type="range" min={0.1} max={1} step={0.05} value={fade} onChange={(event) => onFade(Number(event.target.value))} />
      </div>

      <p className="editor-hint">Shift-drag draws a straight wall. Hold Space to move the plan with any brush. [ and ] change the brush size.</p>

      <div className="sim-actions editor-step-nav">
        <button type="button" className="sim-action editor-secondary" onClick={onBack}>Back</button>
        <button type="button" className="sim-action" onClick={onNext}>Next: scale</button>
      </div>
    </section>
  )
}
