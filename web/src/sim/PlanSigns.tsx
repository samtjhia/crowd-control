import { Siren } from 'lucide-react'
import type { Camera, Frame, RenderScene } from '@crowd-control/contract'
import { worldToScreen } from '../render/camera.ts'
import { StatusIcon } from './StatusIcon.tsx'
import { formatClock, type Incident } from './incidents.ts'
import { planSigns } from './planSigns.ts'

/** The map's world extent, from its rasterized grid. */
function worldSize(scene: RenderScene): { width: number; height: number } {
  const { map } = scene
  if ('grid' in map && map.grid) return { width: map.grid.width * map.cellSize, height: map.grid.height * map.cellSize }
  const rows = 'rows' in map && map.rows ? map.rows : []
  return { width: (rows[0]?.length ?? 0) * map.cellSize, height: rows.length * map.cellSize }
}

/**
 * Status badges pinned to the map (exit doors, closed doors, anyone down, recent zone
 * events), positioned through the renderer's camera. Venue-wide events such as the alarm
 * have no place on the plan: they pulse around the whole map once when they happen, then
 * stay as a badge on its top-left corner. Decorative for assistive tech: the event log
 * carries the same information as text.
 */
export function PlanSigns({ scene, frame, camera, incidents, now }: {
  scene: RenderScene | null; frame: Frame | null; camera: Camera | null; incidents: Incident[]; now: number
}) {
  if (!scene || !camera) return null
  const { signs, notices } = planSigns(scene, frame, incidents, now)
  // Scales with the map so a badge never dwarfs the doorway or person it marks.
  const size = Math.round(Math.min(22, Math.max(12, camera.pixelsPerUnit * 0.8)))
  const world = worldSize(scene)
  const topLeft = worldToScreen(camera, { x: 0, y: 0 })
  const bottomRight = worldToScreen(camera, { x: world.width, y: world.height })
  return (
    <div className="map-markers" aria-hidden="true">
      {notices.map((notice) => (
        // Keyed by event, so the pulse plays once when the event first appears.
        <span key={`pulse-${notice.id}`} className={`map-pulse status-ring-${notice.kind}`} style={{
          left: topLeft.x, top: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y,
        }} />
      ))}
      {notices.length > 0 && (
        <ul className="map-notices" style={{ left: topLeft.x, top: topLeft.y }}>
          {notices.map((notice) => (
            <li key={notice.id} className={`map-notice status-${notice.kind}`}>
              {notice.title === 'Alarm' ? <Siren size={12} strokeWidth={2.5} /> : <StatusIcon kind={notice.kind} size={14} />}
              {notice.title} · {formatClock(notice.time, false)}
            </li>
          ))}
        </ul>
      )}
      {signs.map((sign) => {
        const p = worldToScreen(camera, { x: sign.x, y: sign.y - sign.lift })
        return (
          <span key={sign.id} className={`map-marker${sign.lift > 0 ? ' map-marker-above' : ''}`} style={{ left: p.x, top: p.y }}>
            <StatusIcon kind={sign.kind} size={size} />
          </span>
        )
      })}
    </div>
  )
}
