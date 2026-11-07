import { components, distanceTo } from './raster.ts'

/**
 * Walls and furniture (Technical PRD §7 steps 2–4). A draft is made automatically from the
 * image; the person corrects it with brushes. Corrections are stored apart from the draft, so
 * changing a setting later never erases them.
 *
 * The draft tells walls from furniture by thickness: walls are drawn as thick strokes (or as
 * two thin lines with a narrow gap between them), furniture as thin outlines. Rooms are filled
 * using walls only, so furniture never cuts a room up; furniture can still block people.
 *
 * Everything works in source pixels: index = y × width + x.
 */

/** What a pixel is: open floor, wall, or furniture. */
export const FLOOR = 0, WALL = 1, OBJECT = 2
export type Kind = typeof FLOOR | typeof WALL | typeof OBJECT

/** Pixels in RGBA order, as in ImageData. */
export type Pixels = { data: ArrayLike<number>; width: number; height: number }

/** Perceived brightness (0–255) of pixel `i`. */
export function luminance(data: ArrayLike<number>, i: number): number {
  return 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!
}

/**
 * A starting threshold that splits dark ink from light paper (Otsu's method: the cut that
 * best separates the two groups of brightness). Clamped so a nearly blank image still works.
 */
export function suggestThreshold(pixels: Pixels): number {
  const histogram = new Array<number>(256).fill(0)
  const count = pixels.width * pixels.height
  for (let i = 0; i < count; i++) histogram[Math.round(luminance(pixels.data, i))]!++
  let total = 0
  for (let v = 0; v < 256; v++) total += v * histogram[v]!
  let best = 128, bestSpread = -1, below = 0, belowSum = 0
  for (let t = 0; t < 256; t++) {
    below += histogram[t]!
    if (below === 0) continue
    const above = count - below
    if (above === 0) break
    belowSum += t * histogram[t]!
    const meanBelow = belowSum / below, meanAbove = (total - belowSum) / above
    const spread = below * above * (meanBelow - meanAbove) ** 2
    if (spread > bestSpread) { bestSpread = spread; best = t + 1 }
  }
  return Math.min(220, Math.max(40, best))
}

/** Clears connected blobs (8-way) whose bounding box is smaller than `maxExtent` in both directions. */
export function removeSpecks(mask: Uint8Array, width: number, height: number, maxExtent: number) {
  const seen = new Uint8Array(mask.length)
  const stack: number[] = []
  const blob: number[] = []
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue
    stack.push(start)
    seen[start] = 1
    blob.length = 0
    let left = width, right = 0, top = height, bottom = 0
    while (stack.length > 0) {
      const i = stack.pop()!
      blob.push(i)
      const x = i % width, y = (i - x) / width
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= width) continue
          const j = yy * width + xx
          if (mask[j] && !seen[j]) { seen[j] = 1; stack.push(j) }
        }
      }
    }
    if (right - left + 1 < maxExtent && bottom - top + 1 < maxExtent) for (const i of blob) mask[i] = 0
  }
}

export type DraftSettings = {
  /** Pixels darker than this are ink (0–255). */
  threshold: number
  /** Drop small dark marks (letters, numbers, dots) before anything else. */
  ignoreSpecks: boolean
  /** Ink at least this thick (px) is wall; thinner ink is furniture or detail. 0 makes all ink wall. */
  wallThickness: number
  /** Closed outlines enclosing up to this much area (px²) are filled in as furniture. */
  maxObjectArea: number
}

/**
 * The automatic draft: FLOOR, WALL or OBJECT per pixel.
 * 1. Ink is anything darker than the threshold (minus small specks such as text).
 * 2. Enclosed gaps thinner than about two wall thicknesses (the inside of a wall drawn as two
 *    lines) are filled, so hollow walls count as solid.
 * 3. Ink that a disc of the wall thickness fits inside is wall (a morphological opening).
 * 4. The remaining ink, plus small closed outlines filled in (table tops, seat rows), is furniture.
 */
export function draftLayers(pixels: Pixels, settings: DraftSettings): Uint8Array {
  const { width, height } = pixels
  const size = width * height
  const ink = new Uint8Array(size)
  for (let i = 0; i < size; i++) ink[i] = luminance(pixels.data, i) < settings.threshold ? 1 : 0
  if (settings.ignoreSpecks) removeSpecks(ink, width, height, Math.max(3, Math.round(Math.min(width, height) * 0.02)))
  const out = new Uint8Array(size)
  const radius = settings.wallThickness / 2
  if (radius <= 0) {
    for (let i = 0; i < size; i++) out[i] = ink[i] ? WALL : FLOOR
    return out
  }

  // 2. Fill thin enclosed gaps: the cavity of a wall drawn as two parallel lines.
  const toInk = distanceTo(ink, width, height)
  const gaps = components((i) => !ink[i], width, height)
  const widest = new Float32Array(gaps.area.length)
  for (let i = 0; i < size; i++) {
    const g = gaps.label[i]!
    if (g >= 0 && toInk[i]! > widest[g]!) widest[g] = toInk[i]!
  }
  const solid = ink.slice()
  for (let i = 0; i < size; i++) {
    const g = gaps.label[i]!
    if (g >= 0 && !gaps.edge[g] && widest[g]! <= settings.wallThickness) solid[i] = 1
  }

  // 3. Wall = ink where a disc of the wall thickness fits, grown back to its full extent.
  const toPaper = distanceTo(solid.map((v) => (v ? 0 : 1)), width, height)
  const core = new Uint8Array(size)
  for (let i = 0; i < size; i++) core[i] = solid[i] && toPaper[i]! >= radius ? 1 : 0
  const toCore = distanceTo(core, width, height)
  for (let i = 0; i < size; i++) if (solid[i] && toCore[i]! <= radius + 0.5) out[i] = WALL

  // 4. Everything else that is ink is furniture; so are small closed outlines' insides,
  // unless they sit against a wall (a cupboard or alcove rather than a table).
  for (let i = 0; i < size; i++) if (ink[i] && out[i] !== WALL) out[i] = OBJECT
  const againstWall = new Uint8Array(gaps.area.length)
  for (let i = 0; i < size; i++) {
    const g = gaps.label[i]!
    if (g < 0 || out[i] !== FLOOR) continue
    const x = i % width
    if ((x > 0 && out[i - 1] === WALL) || (x < width - 1 && out[i + 1] === WALL) || (i >= width && out[i - width] === WALL) || (i < size - width && out[i + width] === WALL)) againstWall[g] = 1
  }
  for (let i = 0; i < size; i++) {
    const g = gaps.label[i]!
    if (g >= 0 && out[i] === FLOOR && !gaps.edge[g] && !againstWall[g] && gaps.area[g]! <= settings.maxObjectArea) out[i] = OBJECT
  }
  return out
}

/** The old single-layer draft (dark = wall), kept for simple plans and tests. */
export function draftWalls(pixels: Pixels, threshold: number, ignoreSpecks: boolean): Uint8Array {
  return draftLayers(pixels, { threshold, ignoreSpecks, wallThickness: 0, maxObjectArea: 0 })
}

type Change = { index: number; before: number }
export type Stroke = { id: string; kind: Kind; changes: Change[] }
export type Rect = { left: number; top: number; right: number; bottom: number }

/**
 * The draft plus the person's corrections. `correction` holds -1 (no correction) or the Kind
 * painted there; a correction always wins over the draft. Each brush stroke records what it
 * changed, so it can be undone and redone exactly.
 */
export class WallMask {
  readonly width: number
  readonly height: number
  draft: Uint8Array
  readonly correction: Int8Array
  private done: Stroke[] = []
  private undone: Stroke[] = []
  private current: { stroke: Stroke; touched: Set<number> } | null = null
  private nextId = 1

  constructor(width: number, height: number, draft: Uint8Array) {
    this.width = width
    this.height = height
    this.draft = draft
    this.correction = new Int8Array(width * height).fill(-1)
  }

  kind(i: number): Kind {
    const c = this.correction[i]!
    return (c === -1 ? this.draft[i]! : c) as Kind
  }

  isWall(i: number): boolean { return this.kind(i) === WALL }
  isObject(i: number): boolean { return this.kind(i) === OBJECT }

  /** Replaces the automatic draft (new settings); corrections are untouched. */
  setDraft(draft: Uint8Array) {
    this.draft = draft
  }

  /** Starts a stroke painting `kind` (FLOOR erases walls and furniture). */
  beginStroke(kind: Kind) {
    this.current = { stroke: { id: `stroke-${this.nextId++}`, kind, changes: [] }, touched: new Set() }
  }

  /** Paints a round brush of `radius` px along a segment; returns the area changed, or null. */
  paint(from: { x: number; y: number }, to: { x: number; y: number }, radius: number): Rect | null {
    const active = this.current
    if (!active) return null
    const r = Math.max(0.5, radius)
    const left = Math.max(0, Math.floor(Math.min(from.x, to.x) - r)), right = Math.min(this.width - 1, Math.ceil(Math.max(from.x, to.x) + r))
    const top = Math.max(0, Math.floor(Math.min(from.y, to.y) - r)), bottom = Math.min(this.height - 1, Math.ceil(Math.max(from.y, to.y) + r))
    if (left > right || top > bottom) return null
    const dx = to.x - from.x, dy = to.y - from.y, length2 = dx * dx + dy * dy
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        // Distance from the pixel centre to the segment.
        const px = x + 0.5, py = y + 0.5
        const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - from.x) * dx + (py - from.y) * dy) / length2))
        const cx = from.x + t * dx - px, cy = from.y + t * dy - py
        if (cx * cx + cy * cy > r * r) continue
        const i = y * this.width + x
        if (active.touched.has(i)) continue
        active.touched.add(i)
        active.stroke.changes.push({ index: i, before: this.correction[i]! })
        this.correction[i] = active.stroke.kind
      }
    }
    return { left, top, right, bottom }
  }

  /** Finishes the stroke; an empty stroke is discarded. Returns whether anything was recorded. */
  endStroke(): boolean {
    const active = this.current
    this.current = null
    if (!active || active.stroke.changes.length === 0) return false
    this.done.push(active.stroke)
    this.undone = []
    return true
  }

  get canUndo() { return this.done.length > 0 }
  get canRedo() { return this.undone.length > 0 }

  /** Reverts the last stroke; returns the area it covered. */
  undo(): Rect | null {
    const stroke = this.done.pop()
    if (!stroke) return null
    for (let k = stroke.changes.length - 1; k >= 0; k--) this.correction[stroke.changes[k]!.index] = stroke.changes[k]!.before
    this.undone.push(stroke)
    return this.bounds(stroke)
  }

  redo(): Rect | null {
    const stroke = this.undone.pop()
    if (!stroke) return null
    for (const change of stroke.changes) this.correction[change.index] = stroke.kind
    this.done.push(stroke)
    return this.bounds(stroke)
  }

  /** The corrections in the contract's form (EditorDraft.corrections): one entry per stroke still applied. */
  corrections(): { id: string; cells: number[]; walkable: boolean }[] {
    return this.done.map((stroke) => ({ id: stroke.id, cells: stroke.changes.map((change) => change.index), walkable: stroke.kind === FLOOR }))
  }

  /** Walls only (0/1 per pixel): what rooms are filled against. */
  blocked(): Uint8Array {
    const out = new Uint8Array(this.width * this.height)
    for (let i = 0; i < out.length; i++) out[i] = this.isWall(i) ? 1 : 0
    return out
  }

  /** Furniture only (0/1 per pixel): obstacles inside rooms when furniture blocks people. */
  objects(): Uint8Array {
    const out = new Uint8Array(this.width * this.height)
    for (let i = 0; i < out.length; i++) out[i] = this.isObject(i) ? 1 : 0
    return out
  }

  private bounds(stroke: Stroke): Rect {
    let left = this.width, right = 0, top = this.height, bottom = 0
    for (const { index } of stroke.changes) {
      const x = index % this.width, y = (index - x) / this.width
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
    }
    return { left, top, right, bottom }
  }
}

/** Walls in red and furniture in amber over the plan, for an area of the overlay (all of it by default). */
export function paintWalls(mask: WallMask, out: Uint8ClampedArray, area: Rect = { left: 0, top: 0, right: mask.width - 1, bottom: mask.height - 1 }, showObjects = true) {
  for (let y = area.top; y <= area.bottom; y++) {
    for (let x = area.left; x <= area.right; x++) {
      const i = y * mask.width + x, o = i * 4
      const kind = mask.kind(i)
      if (kind === WALL) {
        out[o] = 220; out[o + 1] = 38; out[o + 2] = 38; out[o + 3] = 150
      } else if (kind === OBJECT && showObjects) {
        out[o] = 217; out[o + 1] = 119; out[o + 2] = 6; out[o + 3] = 130
      } else {
        out[o + 3] = 0
      }
    }
  }
}
