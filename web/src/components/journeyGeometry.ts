import { campusFrame, trailEntryX } from './campusFrame'
import type { Point } from './canvas'

type Box = { x: number; y: number; width: number; height: number }
export type Cubic = { start: Point; a: Point; b: Point; end: Point }
export type JourneyGeometry = { width: number; height: number; campus: Box; story: Box; curves: Cubic[]; points: Point[]; distances: number[]; length: number; path: string }

export function buildJourneyGeometry(width: number, height: number, campus: Box, story: Box): JourneyGeometry {
  const frame = campusFrame(campus.width, campus.height)
  const project = (x: number, y: number) => ({ x: campus.x + frame.offsetX + x * frame.scale, y: campus.y + frame.offsetY + (frame.campusY + y * frame.campusScaleY) * frame.scale })
  const seam = { x: trailEntryX(width), y: story.y }
  const handle = Math.min(80, campus.height * .25)
  const curves: Cubic[] = [{ start: project(760, 850), a: project(850, 935), b: { x: seam.x, y: seam.y - handle }, end: seam }]
  const at = (x: number, y: number) => ({ x: story.x + x * story.width, y: story.y + y * story.height })
  const points = width < 700
    ? [seam, at(.87, .32), at(.84, .7), at(.84, .91), at(.5, 1)]
    : [seam, at(.76, .18), at(.66, .30), at(.29, .43), at(.25, .53), at(.32, .64), at(.72, .77), at(.76, .87), at(.5, 1)]
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i], end = points[i + 1]
    const before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 2)]
    curves.push({ start,
      a: i === 0 ? { x: start.x, y: start.y + handle } : { x: start.x + (end.x - before.x) / 6, y: start.y + (end.y - before.y) / 6 },
      b: i === points.length - 2 ? { x: end.x, y: end.y - 55 } : { x: end.x - (after.x - start.x) / 6, y: end.y - (after.y - start.y) / 6 }, end })
  }
  const samples: Point[] = [curves[0].start]
  for (const curve of curves) for (let step = 1; step <= 64; step++) {
    const t = step / 64, u = 1 - t
    samples.push({ x: u ** 3 * curve.start.x + 3 * u * u * t * curve.a.x + 3 * u * t * t * curve.b.x + t ** 3 * curve.end.x,
      y: u ** 3 * curve.start.y + 3 * u * u * t * curve.a.y + 3 * u * t * t * curve.b.y + t ** 3 * curve.end.y })
  }
  const distances = [0]
  for (let i = 1; i < samples.length; i++) distances.push(distances[i - 1] + Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y))
  const path = `M${curves[0].start.x} ${curves[0].start.y} ` + curves.map(c => `C${c.a.x} ${c.a.y} ${c.b.x} ${c.b.y} ${c.end.x} ${c.end.y}`).join(' ')
  return { width, height, campus, story, curves, points: samples, distances, length: distances[distances.length - 1], path }
}

export function journeyPoint(geometry: JourneyGeometry, distance: number) {
  let low = 1, high = geometry.distances.length - 1
  while (low < high) { const mid = (low + high) >> 1; if (geometry.distances[mid] < distance) low = mid + 1; else high = mid }
  const i = low, start = geometry.points[i - 1], end = geometry.points[i]
  const span = geometry.distances[i] - geometry.distances[i - 1]
  const t = span ? (distance - geometry.distances[i - 1]) / span : 0
  return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }
}
