import { journeyPoint, type JourneyGeometry } from './journeyGeometry'

export const CYCLIST_SCALE = .56
const cyclists = new WeakMap<JourneyGeometry, number>()

export function setCyclistDistance(geometry: JourneyGeometry, distance?: number) {
  if (distance === undefined) cyclists.delete(geometry)
  else cyclists.set(geometry, distance)
}

/** The bike and walkers share the same centerline, but use separate unmarked
 * lanes. Offsets remain comfortably inside both desktop and mobile paving. */
export function cyclistPoint(geometry: JourneyGeometry, distance: number) {
  const point = journeyPoint(geometry, distance)
  const before = journeyPoint(geometry, Math.max(0, distance - 3))
  const after = journeyPoint(geometry, Math.min(geometry.length, distance + 3))
  const dx = after.x - before.x, dy = after.y - before.y
  const length = Math.hypot(dx, dy) || 1
  const lane = geometry.width < 700 ? -10 : -16
  return { x: point.x + dy / length * lane, y: point.y - dx / length * lane }
}

export function pedestrianLane(geometry: JourneyGeometry, distance: number, spread: number) {
  const mobile = geometry.width < 700
  const rider = cyclists.get(geometry)
  const proximity = rider === undefined ? 0 : Math.max(0, 1 - Math.abs(distance - rider) / 90)
  // Smooth spatial yielding avoids snapping or making people disappear.
  const yieldAmount = proximity * proximity * (3 - 2 * proximity) * (mobile ? 2 : 3)
  return (mobile ? 12 : 20) + spread + yieldAmount
}
