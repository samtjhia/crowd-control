import { useMemo } from 'react'
import { METRIC_BANDS, RELATIVE_GRADIENT, peakOf, smoothDensity, smoothingRadius, walkableMask } from '../render/heatmap.ts'
import { zoneAt } from '../render/hitTest.ts'
import type { SimulationView } from '../worker/simulationClient.ts'
import { nameOf } from './mapActions.ts'

/** The band a people/m² value falls in. */
function bandFor(value: number) {
  return METRIC_BANDS.find((band) => band.to === null || value < band.to) ?? METRIC_BANDS[METRIC_BANDS.length - 1]!
}

/**
 * The Density section: heatmap switch, where the crowd is densest right now, and a legend.
 * Metre-scaled venues read in people/m² with indicative bands; plans that aren't to scale
 * only say where it is busiest (Technical PRD §15: no people/m² in model units).
 */
export function DensityPanel({ view, on, onToggle }: { view: SimulationView; on: boolean; onToggle: () => void }) {
  const { scene, density } = view
  const metric = density?.units === 'people/m2'
  const peak = useMemo(() => {
    if (!scene || !density) return null
    const smoothed = smoothDensity(density, walkableMask(scene.map, density.width, density.height), smoothingRadius(density))
    const top = peakOf(smoothed, density)
    if (top.value <= 0) return null
    const zone = zoneAt(scene, top)
    return { ...top, zone: zone ? nameOf(scene, zone) : null }
  }, [scene, density])

  return (
    <div className="sim-density">
      <button type="button" role="switch" aria-checked={on} className="sim-switch" onClick={onToggle} aria-keyshortcuts="H">
        <span className="sim-switch-track" aria-hidden="true"><span className="sim-switch-thumb" /></span>
        Show heatmap <kbd>H</kbd>
      </button>

      {peak && (
        <p className="sim-density-peak">
          {metric ? (
            <>
              <span className="sim-density-value">{peak.value.toFixed(1)}</span> people/m² at the densest spot
              {peak.zone ? `, in ${peak.zone}` : ''} · <span className="sim-density-band">{bandFor(peak.value).label}</span>
            </>
          ) : (
            <>Busiest right now{peak.zone ? <>: <strong>{peak.zone}</strong></> : ''}</>
          )}
        </p>
      )}

      {metric ? (
        <>
          <ul className="sim-density-legend">
            {METRIC_BANDS.map((band) => (
              <li key={band.label}>
                <span className="sim-density-swatch" style={{ background: band.color }} aria-hidden="true" />
                <span>{band.label}</span>
                <span className="sim-muted">{band.to === null ? `${band.from}+` : `${band.from}–${band.to}`}</span>
              </li>
            ))}
          </ul>
          <p className="sim-muted sim-density-note">People per m², averaged over about 1 m around each spot. Indicative bands from crowd-safety research, not a safety assessment.</p>
        </>
      ) : (
        <>
          <div className="sim-density-gradient" style={{ background: `linear-gradient(90deg, ${RELATIVE_GRADIENT.join(', ')})` }} aria-hidden="true" />
          <p className="sim-density-scale sim-muted"><span>Fewer people</span><span>More people</span></p>
          <p className="sim-muted sim-density-note">This plan isn’t to scale, so colours are relative to the busiest spot rather than people per m². Metre-scaled venues show real density.</p>
        </>
      )}
    </div>
  )
}
