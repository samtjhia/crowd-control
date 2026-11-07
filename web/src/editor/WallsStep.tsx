import { Armchair, Brush, Eraser, Hand, Redo2, Undo2 } from 'lucide-react'
import type { WallEditor, WallTool } from './useWallEditor.ts'

const TOOLS: { id: WallTool; label: string; key: string; Icon: typeof Brush }[] = [
  { id: 'move', label: 'Move', key: 'M', Icon: Hand },
  { id: 'wall', label: 'Wall', key: 'W', Icon: Brush },
  { id: 'object', label: 'Object', key: 'O', Icon: Armchair },
  { id: 'erase', label: 'Erase', key: 'E', Icon: Eraser },
]

/**
 * Step 3: walls and furniture. The draft tells them apart by thickness: thick strokes are
 * walls (red), thin outlines are furniture (amber). The person checks it and fixes it with
 * brushes (Technical PRD §7 steps 2–4). Rooms are filled against walls only.
 */
export function WallsStep({ walls, fade, onFade, onBack, onNext }: { walls: WallEditor; fade: number; onFade: (value: number) => void; onBack: () => void; onNext: () => void }) {
  return (
    <section className="sim-section">
      <h3>3 · Walls and furniture</h3>
      <p className="sim-muted">
        <span className="editor-key editor-key-wall" /> Walls block people and divide rooms. <span className="editor-key editor-key-object" /> Furniture sits inside rooms. Fix anything that’s wrong with the brushes.
      </p>

      <div className="editor-field">
        <label htmlFor="wall-threshold">Darkness cut-off <output htmlFor="wall-threshold">{walls.threshold}</output></label>
        <input id="wall-threshold" type="range" min={10} max={245} value={walls.threshold}
          onChange={(event) => walls.setThreshold(Number(event.target.value))} />
        <p className="editor-hint">Higher catches lighter lines. <button type="button" className="sim-link" onClick={walls.resetThreshold}>Use the suggested value</button></p>
      </div>

      <div className="editor-field">
        {walls.scaled ? (
          <>
            <label htmlFor="wall-thickness">Walls are at least <output htmlFor="wall-thickness">{walls.wallMetres === 0 ? 'any thickness' : `${Math.round(walls.wallMetres * 100)} cm`}</output></label>
            <input id="wall-thickness" type="range" min={0} max={0.4} step={0.01} value={walls.wallMetres} onChange={(event) => walls.setWallMetres(Number(event.target.value))} />
          </>
        ) : (
          <>
            <label htmlFor="wall-thickness">Walls are at least <output htmlFor="wall-thickness">{walls.wallPixels === 0 ? 'any thickness' : `${walls.wallPixels} px`}</output></label>
            <input id="wall-thickness" type="range" min={0} max={20} step={1} value={walls.wallPixels} onChange={(event) => walls.setWallPixels(Number(event.target.value))} />
          </>
        )}
        <p className="editor-hint">Thinner lines count as furniture. Raise it if furniture shows as walls; lower it if thin walls disappear. At “any thickness”, everything dark is wall.</p>
      </div>

      <label className="editor-check">
        <input type="checkbox" checked={walls.ignoreSpecks} onChange={(event) => walls.setIgnoreSpecks(event.target.checked)} />
        Ignore text and small marks
      </label>
      <label className="editor-check">
        <input type="checkbox" checked={walls.furnitureBlocks} onChange={(event) => walls.setFurnitureBlocks(event.target.checked)} />
        Furniture blocks people
      </label>

      <div className="editor-field">
        <span className="editor-label">Brush</span>
        <div className="editor-segmented" role="radiogroup" aria-label="Brush">
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

      <p className="editor-hint">Shift-drag draws a straight line. Hold Space to move the plan with any brush. [ and ] change the brush size.</p>

      <div className="sim-actions editor-step-nav">
        <button type="button" className="sim-action editor-secondary" onClick={onBack}>Back</button>
        <button type="button" className="sim-action" onClick={onNext}>Next: rooms</button>
      </div>
    </section>
  )
}
