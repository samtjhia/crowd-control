import type { Camera } from '@crowd-control/contract'
import { worldToScreen } from '../render/camera.ts'
import type { MapPoint } from './points.ts'

/**
 * The points marked on this venue, as lettered pins on the map, positioned through the
 * renderer's camera. Clicking a pin selects it (its details and Remove are in the panel).
 */
export function PointPins({ points, camera, selected, onSelect }: {
  points: readonly MapPoint[]; camera: Camera | null; selected: string | null; onSelect: (id: string) => void
}) {
  if (!camera || points.length === 0) return null
  return (
    <div className="map-points">
      {points.map((point) => {
        const p = worldToScreen(camera, point)
        return (
          <button key={point.id} type="button" className={`map-point${selected === point.id ? ' is-selected' : ''}`}
            style={{ left: p.x, top: p.y }} aria-pressed={selected === point.id} aria-label={`Point ${point.id}`}
            onClick={(event) => { event.stopPropagation(); onSelect(point.id) }}>
            <span>{point.id}</span>
          </button>
        )
      })}
    </div>
  )
}
