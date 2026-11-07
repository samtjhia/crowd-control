import { journeyPoint, type JourneyGeometry } from './journeyGeometry'

const GAPS = [48, 73, 39, 86, 57, 65, 43, 91, 54, 76, 46, 62]
const COUNTS = [2, 1, 3, 1, 2, 2, 1, 3, 2, 1, 2, 1]
const PREFIX = GAPS.map((_, index) => GAPS.slice(0, index).reduce((sum, gap) => sum + gap, 0))
const CYCLE = GAPS.reduce((sum, gap) => sum + gap, 0)
const MEAN = CYCLE / GAPS.length
export type JourneyPerson = { key: number; x: number; y: number; size: number; identity: number; pace: number; distance: number }

/** Deterministic social groups share the same clock across the campus/story seam.
 * Small speed differences, uneven gaps and tangent-relative lanes keep people
 * inside the paved strip without turning the crowd into a single-file queue. */
export function journeyPeopleAt(geometry: JourneyGeometry, time: number, overflow = 0): JourneyPerson[] {
  const mobile = geometry.width < 700
  const people: JourneyPerson[] = []
  const first = Math.floor(-time * 14 / MEAN) - GAPS.length
  const last = Math.ceil((geometry.length + overflow - time * 12) / MEAN) + GAPS.length
  for (let group = first; group <= last; group++) {
    const seed = ((group % GAPS.length) + GAPS.length) % GAPS.length
    const frequency = .12 + seed % 3 * .015
    const variation = 4 + seed % 4
    const speed = 13 + Math.cos(time * frequency + seed) * frequency * variation
    const base = Math.floor(group / GAPS.length) * CYCLE + PREFIX[seed]
    const center = base + time * 13 + Math.sin(time * frequency + seed) * variation
    const count = COUNTS[seed]
    for (let member = 0; member < count; member++) {
      const distance = center + (member === 2 ? -14 : member * 5)
      if (distance < 0 || distance > geometry.length + overflow) continue
      const routeDistance = Math.min(geometry.length, distance)
      const point = journeyPoint(geometry, routeDistance)
      const before = journeyPoint(geometry, Math.max(0, routeDistance - 2)), after = journeyPoint(geometry, Math.min(geometry.length, routeDistance + 2))
      const dx = after.x - before.x, dy = after.y - before.y, length = Math.hypot(dx, dy) || 1
      const lane = count === 1 ? Math.sin(seed * 2.1) * (mobile ? 6 : 13) : (member === 0 ? -1 : member === 1 ? 1 : -.3) * (mobile ? 5.5 : 9)
      const identity = (((group * 3 + member) % 120) + 120) % 120
      people.push({ key: group * 3 + member, x: point.x + dy / length * lane, y: point.y - dx / length * lane, identity, size: (mobile ? .68 : .92) * (.94 + seed % 4 * .035), pace: speed / 13, distance })
    }
  }
  return people
}
