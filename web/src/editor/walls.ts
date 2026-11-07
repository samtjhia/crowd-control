/**
 * Wall tracing (Technical PRD §7 steps 2 and 4). A draft is made automatically from the
 * image's brightness; the person corrects it with brushes. Corrections are stored apart from
 * the draft, so changing the threshold later never erases them.
 *
 * Everything works in source pixels: index = y × width + x.
 */

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

/**
 * The automatic draft: 1 where a pixel is darker than `threshold`. With `ignoreSpecks`, dark
 * blobs smaller than about 2% of the image's shorter side (letters, numbers, dots) are dropped,
 * since text is the most common false wall; long wall lines are kept.
 */
export function draftWalls(pixels: Pixels, threshold: number, ignoreSpecks: boolean): Uint8Array {
  const { width, height } = pixels
  const mask = new Uint8Array(width * height)
  for (let i = 0; i < mask.length; i++) mask[i] = luminance(pixels.data, i) < threshold ? 1 : 0
  if (ignoreSpecks) removeSpecks(mask, width, height, Math.max(3, Math.round(Math.min(width, height) * 0.02)))
  return mask
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

type Change = { index: number; before: number }
export type Stroke = { id: string; walkable: boolean; changes: Change[] }
export type Rect = { left: number; top: number; right: number; bottom: number }

/**
 * The draft plus the person's corrections. `correction` holds -1 (no correction), 0 (floor)
 * or 1 (wall) per pixel; a correction always wins over the draft. Each brush stroke records
 * what it changed, so it can be undone and redone exactly.
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

  isWall(i: number): boolean {
    const c = this.correction[i]!
    return c === -1 ? this.draft[i] === 1 : c === 1
  }

  /** Replaces the automatic draft (a new threshold); corrections are untouched. */
  setDraft(draft: Uint8Array) {
    this.draft = draft
  }

  beginStroke(walkable: boolean) {
    this.current = { stroke: { id: `stroke-${this.nextId++}`, walkable, changes: [] }, touched: new Set() }
  }

  /** Paints a round brush of `radius` px along a segment; returns the area changed, or null. */
  paint(from: { x: number; y: number }, to: { x: number; y: number }, radius: number): Rect | null {
    const active = this.current
    if (!active) return null
    const value = active.stroke.walkable ? 0 : 1
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
        this.correction[i] = value
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
    const value = stroke.walkable ? 0 : 1
    for (const change of stroke.changes) this.correction[change.index] = value
    this.done.push(stroke)
    return this.bounds(stroke)
  }

  /** The corrections in the contract's form (EditorDraft.corrections): one entry per stroke still applied. */
  corrections(): { id: string; cells: number[]; walkable: boolean }[] {
    return this.done.map((stroke) => ({ id: stroke.id, cells: stroke.changes.map((change) => change.index), walkable: stroke.walkable }))
  }

  /** The current wall mask (draft with corrections applied), as 0/1 per pixel. */
  blocked(): Uint8Array {
    const out = new Uint8Array(this.width * this.height)
    for (let i = 0; i < out.length; i++) out[i] = this.isWall(i) ? 1 : 0
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

/** Walls in red over the plan, for an area of the overlay (all of it by default). */
export function paintWalls(mask: WallMask, out: Uint8ClampedArray, area: Rect = { left: 0, top: 0, right: mask.width - 1, bottom: mask.height - 1 }) {
  for (let y = area.top; y <= area.bottom; y++) {
    for (let x = area.left; x <= area.right; x++) {
      const i = y * mask.width + x, o = i * 4
      if (mask.isWall(i)) {
        out[o] = 220; out[o + 1] = 38; out[o + 2] = 38; out[o + 3] = 150
      } else {
        out[o + 3] = 0
      }
    }
  }
}
