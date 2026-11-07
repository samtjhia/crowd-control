import { CalibrationSchema, type Calibration } from '@crowd-control/contract'

/**
 * Setting a plan's scale (Technical PRD §7 step 6): two clicked points and the real distance
 * between them. Image size and DPI say nothing about building size, so this is the only way
 * a plan gets metres. Without it, the plan can still be previewed, but with no physical metrics.
 */

export type Point = { x: number; y: number }
export type LengthUnit = 'm' | 'ft'

export const FEET_TO_METRES = 0.3048

export function pixelDistance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/**
 * The calibration for two points and a typed distance, or why it can't be made. The result is
 * checked against the contract (its scale must match its points and distance).
 */
export function calibrate(a: Point | null, b: Point | null, distance: number, unit: LengthUnit): { ok: true; value: Calibration } | { ok: false; reason: string } {
  if (!a || !b) return { ok: false, reason: 'Drag a line between two points you know the distance between.' }
  const pixels = pixelDistance(a, b)
  if (pixels < 10) return { ok: false, reason: 'The line is too short to measure accurately; use a longer distance.' }
  if (!Number.isFinite(distance) || distance <= 0) return { ok: false, reason: 'Type the real distance between the two points.' }
  const distanceMetres = unit === 'ft' ? distance * FEET_TO_METRES : distance
  const calibration = { pointsPx: [[a.x, a.y], [b.x, b.y]] as [[number, number], [number, number]], distanceMetres, metresPerPixel: distanceMetres / pixels }
  const checked = CalibrationSchema.safeParse(calibration)
  if (!checked.success) return { ok: false, reason: 'Those points and that distance don’t make a valid scale.' }
  return { ok: true, value: checked.data }
}

/** The whole plan's size in metres at a given scale. */
export function planSize(image: { width: number; height: number }, metresPerPixel: number) {
  return { width: image.width * metresPerPixel, height: image.height * metresPerPixel }
}

/**
 * A gentle warning when the scale looks implausible for a building floor (a typo, or feet
 * typed as metres), or null when it looks reasonable. It never blocks saving.
 */
export function scaleWarning(image: { width: number; height: number }, metresPerPixel: number): string | null {
  const { width, height } = planSize(image, metresPerPixel)
  const longest = Math.max(width, height)
  if (longest < 5) return `That makes the whole plan ${formatMetres(longest)} across, smaller than a room. Check the distance and its unit.`
  if (longest > 2000) return `That makes the whole plan ${formatMetres(longest)} across. Check the distance and its unit.`
  // Venues are traced at 0.25 m cells; coarser pixels than that lose narrow doors.
  if (metresPerPixel > 0.25) return `Each image pixel is ${formatMetres(metresPerPixel)}, coarser than the 0.25 m the simulation uses, so narrow doors may be lost. A sharper image (or a crop) would help.`
  return null
}

/** "42.3 m", "8.5 m", "75 cm". */
export function formatMetres(metres: number): string {
  if (metres < 1) return `${Math.round(metres * 100)} cm`
  if (metres < 10) return `${metres.toFixed(1)} m`
  if (metres < 1000) return `${Math.round(metres * 10) / 10} m`
  return `${(metres / 1000).toFixed(1)} km`
}

/** A round scale-bar length (1, 2 or 5 × a power of ten metres) about `targetPx` screen pixels long. */
export function scaleBar(metresPerScreenPixel: number, targetPx = 120): { metres: number; pixels: number } {
  const ideal = metresPerScreenPixel * targetPx
  const power = 10 ** Math.floor(Math.log10(ideal))
  const metres = [1, 2, 5, 10].map((step) => step * power).reduce((best, option) => (Math.abs(option - ideal) < Math.abs(best - ideal) ? option : best))
  return { metres, pixels: metres / metresPerScreenPixel }
}
