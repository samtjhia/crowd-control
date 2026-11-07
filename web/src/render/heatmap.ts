import type { CompiledMap, DensityGrid } from '@crowd-control/contract'

/**
 * Density heatmap maths, kept free of PixiJS so it can be tested (Technical PRD §12, Product
 * PRD "Density heatmap"). The worker reports people per cell area; this smooths it into a
 * local density, then colours it.
 *
 * On metre-scaled maps, colours follow indicative bands in people/m² drawn from crowd-safety
 * research, labelled as indicative rather than a safety assessment (Product PRD open question
 * "Danger color bands"). Plans that are not to scale only show relative density, in a neutral
 * colour, because people/m² would be meaningless (Technical PRD §15).
 */

export type DensityBand = { from: number; to: number | null; label: string; color: string }

/** Indicative bands in people/m², for the legend and the colour ramp. */
export const METRIC_BANDS: readonly DensityBand[] = [
  { from: 0, to: 1, label: 'Free-flowing', color: '#4ADE80' },
  { from: 1, to: 2, label: 'Busy', color: '#FACC15' },
  { from: 2, to: 4, label: 'Crowded', color: '#F97316' },
  { from: 4, to: 6, label: 'Very crowded', color: '#DC2626' },
  { from: 6, to: null, label: 'Extreme', color: '#7F1D1D' },
]

type Stop = { at: number; rgb: [number, number, number]; alpha: number }

const hex = (color: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)) as [number, number, number]

/** People/m² → colour. Low density fades out, so a calm crowd leaves the floor visible. */
const METRIC_STOPS: Stop[] = [
  { at: 0, rgb: hex('#4ADE80'), alpha: 0 },
  { at: 0.5, rgb: hex('#4ADE80'), alpha: 0.14 },
  { at: 1, rgb: hex('#4ADE80'), alpha: 0.3 },
  { at: 2, rgb: hex('#FACC15'), alpha: 0.46 },
  { at: 4, rgb: hex('#F97316'), alpha: 0.6 },
  { at: 6, rgb: hex('#DC2626'), alpha: 0.7 },
  { at: 8, rgb: hex('#7F1D1D'), alpha: 0.8 },
]

/** Share of the busiest spot → colour, in blues and violets that carry no danger meaning. */
const RELATIVE_STOPS: Stop[] = [
  { at: 0, rgb: hex('#60A5FA'), alpha: 0 },
  { at: 0.15, rgb: hex('#60A5FA'), alpha: 0.18 },
  { at: 0.5, rgb: hex('#6366F1'), alpha: 0.42 },
  { at: 1, rgb: hex('#4C1D95'), alpha: 0.66 },
]

export const RELATIVE_GRADIENT = RELATIVE_STOPS.map((stop) => `rgb(${stop.rgb.join(' ')} / ${Math.max(stop.alpha, 0.12)})`)

export type HeatScale = { kind: 'metric' } | { kind: 'relative'; max: number }

/** RGBA (0–255) for a smoothed density value. */
export function heatColor(value: number, scale: HeatScale): [number, number, number, number] {
  const stops = scale.kind === 'metric' ? METRIC_STOPS : RELATIVE_STOPS
  const v = scale.kind === 'metric' ? value : scale.max > 0 ? value / scale.max : 0
  if (v <= 0) return [0, 0, 0, 0]
  let i = 1
  while (i < stops.length - 1 && v > stops[i]!.at) i++
  const a = stops[i - 1]!, b = stops[i]!
  const t = Math.min(1, Math.max(0, (v - a.at) / (b.at - a.at)))
  const mix = (x: number, y: number) => x + (y - x) * t
  return [Math.round(mix(a.rgb[0], b.rgb[0])), Math.round(mix(a.rgb[1], b.rgb[1])), Math.round(mix(a.rgb[2], b.rgb[2])), Math.round(mix(a.alpha, b.alpha) * 255)]
}

/** 1 where people can stand, 0 for walls and furniture, matching the density grid's cells; null if the sizes differ. */
export function walkableMask(map: CompiledMap, width: number, height: number): Uint8Array | null {
  const mask = new Uint8Array(width * height)
  if ('grid' in map && map.grid) {
    if (map.grid.width !== width || map.grid.height !== height) return null
    for (let i = 0; i < mask.length; i++) mask[i] = map.grid.blocked[i] === 0 ? 1 : 0
    return mask
  }
  const rows = (map as Extract<CompiledMap, { rows: string[] }>).rows
  if (rows.length !== height || rows.some((row) => row.length !== width)) return null
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) mask[y * width + x] = rows[y]![x] === '#' ? 0 : 1
  return mask
}

/**
 * Local density: the average over a square window `radius` cells each way, counting only
 * walkable cells, so people next to a wall aren't diluted by the wall. Walls read 0.
 * Separable sums keep it linear in the number of cells.
 */
export function smoothDensity(grid: DensityGrid, mask: Uint8Array | null, radius: number): Float32Array {
  const { width, height, values } = grid
  const walk = (i: number) => (mask ? mask[i]! : 1)
  const rowValue = new Float32Array(width * height)
  const rowArea = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 0, area = 0
      for (let dx = -radius; dx <= radius; dx++) {
        const xx = x + dx
        if (xx < 0 || xx >= width) continue
        const i = y * width + xx
        value += values[i]! * walk(i)
        area += walk(i)
      }
      rowValue[y * width + x] = value
      rowArea[y * width + x] = area
    }
  }
  const out = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!walk(i)) continue
      let value = 0, area = 0
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= height) continue
        value += rowValue[yy * width + x]!
        area += rowArea[yy * width + x]!
      }
      out[i] = area > 0 ? value / area : 0
    }
  }
  return out
}

/** Smoothing radius in cells: about 0.75 m each way on metre maps (a ~3 m² window), one body width otherwise. */
export function smoothingRadius(grid: DensityGrid): number {
  return grid.units === 'people/m2' ? Math.max(1, Math.round(0.75 / grid.cellSize)) : 1
}

/** The densest spot: its smoothed value and the world position of its cell centre. */
export function peakOf(smoothed: Float32Array, grid: DensityGrid): { value: number; x: number; y: number } {
  let best = 0
  for (let i = 1; i < smoothed.length; i++) if (smoothed[i]! > smoothed[best]!) best = i
  return {
    value: smoothed[best] ?? 0,
    x: grid.origin.x + ((best % grid.width) + 0.5) * grid.cellSize,
    y: grid.origin.y + (Math.floor(best / grid.width) + 0.5) * grid.cellSize,
  }
}

/** Fills an RGBA pixel buffer (one pixel per cell) with the heatmap colours. */
export function paintHeatmap(smoothed: Float32Array, scale: HeatScale, out: Uint8ClampedArray) {
  for (let i = 0; i < smoothed.length; i++) {
    const [r, g, b, a] = heatColor(smoothed[i]!, scale)
    out[i * 4] = r
    out[i * 4 + 1] = g
    out[i * 4 + 2] = b
    out[i * 4 + 3] = a
  }
}
