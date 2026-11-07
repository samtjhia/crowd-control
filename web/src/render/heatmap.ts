import type { CompiledMap, DensityGrid, Vec2 } from '@crowd-control/contract'

/**
 * Density heatmap maths, kept free of PixiJS so it can be tested (Technical PRD §12, Product
 * PRD "Density heatmap").
 *
 * Density is smoothed with a Gaussian (a soft, round falloff), not a square window, so each
 * person reads as a round glow and groups merge into smooth blobs. Walls are left out of the
 * average (normalized convolution), so a crowd against a wall isn't diluted by it.
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

/** 1 where people can stand, 0 for walls and furniture, matching the map's cells; null if the sizes differ. */
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

/** How far each person's glow spreads (one standard deviation), in world units. */
export function smoothingSigma(units: 'm' | 'model'): number {
  // About 0.6 m on metre maps: density is read over roughly a 1 m radius.
  // On body-relative plans, a little over one body width.
  return units === 'm' ? 0.6 : 1.1
}

/** Normalized Gaussian weights out to three standard deviations. */
export function gaussianKernel(sigmaCells: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigmaCells * 3))
  const kernel = new Float32Array(radius * 2 + 1)
  let sum = 0
  for (let i = -radius; i <= radius; i++) sum += kernel[i + radius] = Math.exp(-(i * i) / (2 * sigmaCells * sigmaCells))
  for (let i = 0; i < kernel.length; i++) kernel[i]! /= sum
  return kernel
}

/**
 * Gaussian blur over walkable cells only (normalized convolution): each cell becomes the
 * weighted average density of the floor around it. Walls read 0 and don't dilute neighbours.
 */
export function blurOverFloor(values: ArrayLike<number>, mask: Uint8Array | null, width: number, height: number, kernel: Float32Array): Float32Array {
  const radius = (kernel.length - 1) / 2
  const walk = (i: number) => (mask ? mask[i]! : 1)
  const rowValue = new Float32Array(width * height)
  const rowArea = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      let value = 0, area = 0
      const from = Math.max(0, x - radius), to = Math.min(width - 1, x + radius)
      for (let xx = from; xx <= to; xx++) {
        const w = kernel[xx - x + radius]! * walk(row + xx)
        value += values[row + xx]! * w
        area += w
      }
      rowValue[row + x] = value
      rowArea[row + x] = area
    }
  }
  const out = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    const from = Math.max(0, y - radius), to = Math.min(height - 1, y + radius)
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!walk(i)) continue
      let value = 0, area = 0
      for (let yy = from; yy <= to; yy++) {
        const w = kernel[yy - y + radius]!
        value += rowValue[yy * width + x]! * w
        area += rowArea[yy * width + x]! * w
      }
      out[i] = area > 1e-9 ? value / area : 0
    }
  }
  return out
}

/** Smooths a worker density grid with the same Gaussian the heatmap uses (for readouts). */
export function smoothDensity(grid: DensityGrid, mask: Uint8Array | null): Float32Array {
  const sigma = smoothingSigma(grid.units === 'people/m2' ? 'm' : 'model') / grid.cellSize
  return blurOverFloor(grid.values, mask, grid.width, grid.height, gaussianKernel(sigma))
}

/**
 * A grid fine enough for a smooth heatmap: the map's own cells, split further when they are
 * coarse (a generated plan's cells are a whole body wide). Each sub-cell inherits its map
 * cell's walls.
 */
export type HeatGrid = { width: number; height: number; cellSize: number; mask: Uint8Array | null }

export function heatGridFor(map: CompiledMap, columns: number, rows: number, sigma: number): HeatGrid {
  const base = walkableMask(map, columns, rows)
  const split = Math.max(1, Math.round(map.cellSize / (sigma / 2.5)))
  const width = columns * split, height = rows * split
  if (!base) return { width, height, cellSize: map.cellSize / split, mask: null }
  if (split === 1) return { width, height, cellSize: map.cellSize, mask: base }
  const mask = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) mask[y * width + x] = base[Math.floor(y / split) * columns + Math.floor(x / split)]!
  }
  return { width, height, cellSize: map.cellSize / split, mask }
}

/**
 * People per unit area on the heat grid from continuous positions. Each person is shared
 * between the four nearest cells by distance (bilinear), so the heatmap glides as they walk
 * instead of jumping a whole cell at a time.
 */
export function splatPositions(points: Iterable<Vec2>, grid: HeatGrid, out: Float32Array) {
  out.fill(0)
  const { width, height, cellSize } = grid
  const perPerson = 1 / (cellSize * cellSize)
  for (const p of points) {
    const fx = p.x / cellSize - 0.5, fy = p.y / cellSize - 0.5
    const x0 = Math.floor(fx), y0 = Math.floor(fy)
    const tx = fx - x0, ty = fy - y0
    for (const [dx, dy, w] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]] as const) {
      const x = x0 + dx, y = y0 + dy
      if (x < 0 || y < 0 || x >= width || y >= height || w === 0) continue
      out[y * width + x]! += w * perPerson
    }
  }
}

/** The densest spot: its smoothed value and the world position of its cell centre. */
export function peakOf(smoothed: Float32Array, grid: { width: number; cellSize: number; origin?: Vec2 }): { value: number; x: number; y: number } {
  let best = 0
  for (let i = 1; i < smoothed.length; i++) if (smoothed[i]! > smoothed[best]!) best = i
  const origin = grid.origin ?? { x: 0, y: 0 }
  return {
    value: smoothed[best] ?? 0,
    x: origin.x + ((best % grid.width) + 0.5) * grid.cellSize,
    y: origin.y + (Math.floor(best / grid.width) + 0.5) * grid.cellSize,
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
