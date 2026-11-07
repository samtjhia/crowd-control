import { TriangleAlert } from 'lucide-react'
import type { LoadedPlan } from './loadPlan.ts'
import { formatMetres, planSize, scaleWarning } from './scale.ts'
import type { ScaleTool } from './useScaleTool.ts'

/**
 * Step 3: scale. Two points and the real distance between them give metres per pixel
 * (Technical PRD §7 step 6). Skipping is allowed: the plan then has no physical metrics.
 */
export function ScaleStep({ plan, scale, onBack, onNext }: { plan: LoadedPlan; scale: ScaleTool; onBack: () => void; onNext?: () => void }) {
  const { calibration } = scale
  const size = calibration ? planSize(plan.pixels, calibration.metresPerPixel) : null
  const warning = calibration ? scaleWarning(plan.pixels, calibration.metresPerPixel) : null
  return (
    <section className="sim-section">
      <h3>3 · Scale</h3>
      <p className="sim-muted">
        Drag a line between two points you know the real distance between: a whole wall, a doorway, or the plan’s printed scale bar. Longer is more accurate. Drag either end to adjust it.
      </p>

      <div className="editor-field">
        <label htmlFor="scale-distance">Real distance</label>
        <div className="editor-distance">
          <input id="scale-distance" type="number" inputMode="decimal" min={0} step="any" placeholder="e.g. 12.5"
            value={scale.distance} onChange={(event) => scale.setDistance(event.target.value)} disabled={scale.unscaled} />
          <div className="editor-segmented" role="radiogroup" aria-label="Unit">
            {(['m', 'ft'] as const).map((unit) => (
              <button key={unit} type="button" role="radio" aria-checked={scale.unit === unit} onClick={() => scale.setUnit(unit)} disabled={scale.unscaled}>
                {unit === 'm' ? 'metres' : 'feet'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {scale.unscaled ? null : calibration ? (
        <dl className="sim-facts editor-scale-result">
          <div><dt>Scale</dt><dd>1 pixel = {formatMetres(calibration.metresPerPixel)}</dd></div>
          <div><dt>Plan size</dt><dd>about {formatMetres(size!.width)} × {formatMetres(size!.height)}</dd></div>
        </dl>
      ) : (
        <p className="editor-hint">{scale.result.ok ? '' : scale.result.reason}</p>
      )}
      {warning && <p className="editor-warning" role="status"><TriangleAlert size={15} aria-hidden="true" /> {warning}</p>}

      <label className="editor-check">
        <input type="checkbox" checked={scale.unscaled} onChange={(event) => scale.setUnscaled(event.target.checked)} />
        This plan isn’t to scale
      </label>
      {scale.unscaled && (
        <p className="editor-hint">You can still trace it and run people on it, but crowding shows as relative only, with no people per m². You can come back and set the scale later.</p>
      )}

      <div className="sim-actions editor-step-nav">
        <button type="button" className="sim-action editor-secondary" onClick={onBack}>Back</button>
        <button type="button" className="sim-action" onClick={onNext} disabled={!onNext || (!calibration && !scale.unscaled)}
          title={!onNext ? 'Naming rooms arrives in the next step' : !calibration && !scale.unscaled ? 'Set the scale, or say the plan isn’t to scale' : undefined}>
          Next: rooms
        </button>
      </div>
    </section>
  )
}
