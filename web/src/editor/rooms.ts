/**
 * Rooms (Technical PRD §7 step 5): named regions of floor. Filling picks one "space" of the
 * floor, where spaces are separated by walls, by split lines the person draws, and (optionally)
 * by openings narrower than a set width, so a fill stops at doorways instead of leaking through.
 *
 * How spaces are found: every floor pixel's distance to the nearest wall is measured. Pixels at
 * least `gap` from any wall form "cores"; a doorway narrower than 2 × gap has no core, so the
 * rooms either side have separate cores. Each remaining floor pixel then joins the core it is
 * nearest to, walking around walls, which splits a doorway down its middle. Split lines block
 * that walk but never become walls: they classify space only.
 *
 * Everything works in source pixels: index = y × width + x.
 */

/** Approximate Euclidean distance (in pixels) from each pixel to the nearest wall (two-pass chamfer). */
export function distanceToWalls(blocked: Uint8Array, width: number, height: number): Float32Array {
  const far = 1e9
  const d = new Float32Array(width * height)
  for (let i = 0; i < d.length; i++) d[i] = blocked[i] ? 0 : far
  const straight = 1, diagonal = Math.SQRT2
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (d[i] === 0) continue
      let v = d[i]!
      if (x > 0) v = Math.min(v, d[i - 1]! + straight)
      if (y > 0) {
        v = Math.min(v, d[i - width]! + straight)
        if (x > 0) v = Math.min(v, d[i - width - 1]! + diagonal)
        if (x < width - 1) v = Math.min(v, d[i - width + 1]! + diagonal)
      }
      d[i] = v
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x
      if (d[i] === 0) continue
      let v = d[i]!
      if (x < width - 1) v = Math.min(v, d[i + 1]! + straight)
      if (y < height - 1) {
        v = Math.min(v, d[i + width]! + straight)
        if (x < width - 1) v = Math.min(v, d[i + width + 1]! + diagonal)
        if (x > 0) v = Math.min(v, d[i + width - 1]! + diagonal)
      }
      d[i] = v
    }
  }
  return d
}

/**
 * Splits the floor into spaces. Returns the space number for each pixel (-1 for walls, split
 * lines and pockets too cramped to reach any core). With `gap` 0, spaces are simply the floor
 * areas enclosed by walls and split lines.
 */
export function partitionFloor(blocked: Uint8Array, boundary: Uint8Array, width: number, height: number, gap: number): Int32Array {
  const size = width * height
  const space = new Int32Array(size).fill(-1)
  const free = (i: number) => !blocked[i] && !boundary[i]
  const distance = gap > 0 ? distanceToWalls(blocked, width, height) : null
  const isCore = (i: number) => free(i) && (!distance || distance[i]! >= gap)
  const neighbours = (i: number, visit: (j: number) => void) => {
    const x = i % width
    if (x > 0) visit(i - 1)
    if (x < width - 1) visit(i + 1)
    if (i >= width) visit(i - width)
    if (i < size - width) visit(i + width)
  }

  // 1. Number the cores: connected areas of floor far enough from walls.
  let count = 0
  const stack: number[] = []
  for (let start = 0; start < size; start++) {
    if (space[start] !== -1 || !isCore(start)) continue
    space[start] = count
    stack.push(start)
    while (stack.length > 0) {
      neighbours(stack.pop()!, (j) => {
        if (space[j] === -1 && isCore(j)) { space[j] = count; stack.push(j) }
      })
    }
    count++
  }
  if (!distance) return space

  // 2. Every other floor pixel joins the nearest core, growing outward from all cores at once.
  let frontier: number[] = []
  for (let i = 0; i < size; i++) if (space[i] !== -1) frontier.push(i)
  while (frontier.length > 0) {
    const next: number[] = []
    for (const i of frontier) {
      neighbours(i, (j) => {
        if (space[j] === -1 && free(j)) { space[j] = space[i]!; next.push(j) }
      })
    }
    frontier = next
  }
  return space
}

/** Paints a round brush of `radius` px along a segment into a 0/1 mask; returns the indices set. */
export function lineIndices(from: { x: number; y: number }, to: { x: number; y: number }, radius: number, width: number, height: number): number[] {
  const r = Math.max(0.5, radius)
  const left = Math.max(0, Math.floor(Math.min(from.x, to.x) - r)), right = Math.min(width - 1, Math.ceil(Math.max(from.x, to.x) + r))
  const top = Math.max(0, Math.floor(Math.min(from.y, to.y) - r)), bottom = Math.min(height - 1, Math.ceil(Math.max(from.y, to.y) + r))
  const dx = to.x - from.x, dy = to.y - from.y, length2 = dx * dx + dy * dy
  const out: number[] = []
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const px = x + 0.5, py = y + 0.5
      const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - from.x) * dx + (py - from.y) * dy) / length2))
      const cx = from.x + t * dx - px, cy = from.y + t * dy - py
      if (cx * cx + cy * cy <= r * r) out.push(y * width + x)
    }
  }
  return out
}

export type Room = { id: number; label: string; tags: string[]; color: string }

/** Soft, distinct room colours, cycled. */
export const ROOM_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1', '#14B8A6']

/** Suggested tags. "outside" marks where people go to leave; the others help the planner. */
export const ROOM_TAGS = ['outside', 'assembly', 'entrance', 'corridor', 'stage', 'bar', 'stairs'] as const

type Edit = { labels: [number, number][]; boundary: [number, number][]; rooms: Room[] }

/**
 * The traced rooms: a room number per pixel (0 = not a room), split lines, room names and tags,
 * and undo/redo of every change.
 */
export class RoomLayer {
  readonly width: number
  readonly height: number
  readonly labels: Uint16Array
  readonly boundary: Uint8Array
  rooms: Room[] = []
  private done: Edit[] = []
  private undone: Edit[] = []
  private nextId = 1

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.labels = new Uint16Array(width * height)
    this.boundary = new Uint8Array(width * height)
  }

  roomAt(i: number): Room | null {
    const id = this.labels[i]!
    return id === 0 ? null : (this.rooms.find((room) => room.id === id) ?? null)
  }

  /**
   * Fills the space containing pixel `seed` (from `partitionFloor`) as a new room, or adds it to
   * `into`. Pixels already in another room are left alone. Split-line pixels touching the filled
   * space join it, so rooms meet without a seam. Returns the room, or null if there was nothing to fill.
   */
  fill(seed: number, space: Int32Array, into: number | null = null): Room | null {
    const target = space[seed]!
    if (target < 0) return null
    const room = into === null ? null : this.rooms.find((r) => r.id === into) ?? null
    const id = room?.id ?? this.nextId
    const changes: [number, number][] = []
    for (let i = 0; i < space.length; i++) {
      if (space[i] === target && this.labels[i] === 0) changes.push([i, 0])
    }
    if (changes.length === 0) return null
    const roomsBefore = this.rooms.map((r) => ({ ...r, tags: [...r.tags] }))
    for (const [i] of changes) this.labels[i] = id
    // Split-line pixels next to the new room become part of it.
    for (let i = 0; i < this.boundary.length; i++) {
      if (!this.boundary[i] || this.labels[i] !== 0) continue
      const x = i % this.width
      const touches = (x > 0 && this.labels[i - 1] === id) || (x < this.width - 1 && this.labels[i + 1] === id)
        || (i >= this.width && this.labels[i - this.width] === id) || (i < this.labels.length - this.width && this.labels[i + this.width] === id)
      if (touches) { this.labels[i] = id; changes.push([i, 0]) }
    }
    let result = room
    if (!result) {
      result = { id, label: `Room ${this.rooms.length + 1}`, tags: [], color: ROOM_COLORS[(id - 1) % ROOM_COLORS.length]! }
      this.rooms = [...this.rooms, result]
      this.nextId++
    }
    this.record({ labels: changes, boundary: [], rooms: roomsBefore })
    return result
  }

  /** Draws a split line: it separates spaces for filling but is never a wall. */
  split(indices: number[]): boolean {
    const changes: [number, number][] = []
    for (const i of indices) if (!this.boundary[i]) { changes.push([i, 0]); this.boundary[i] = 1 }
    if (changes.length === 0) return false
    this.record({ labels: [], boundary: changes, rooms: this.rooms.map((r) => ({ ...r, tags: [...r.tags] })) })
    return true
  }

  /** Renaming is not an undo step: typing would otherwise fill the history letter by letter. */
  rename(id: number, label: string) {
    this.rooms = this.rooms.map((r) => (r.id === id ? { ...r, label } : r))
  }

  toggleTag(id: number, tag: string) {
    const room = this.rooms.find((r) => r.id === id)
    if (room) this.updateRoom(id, { tags: room.tags.includes(tag) ? room.tags.filter((t) => t !== tag) : [...room.tags, tag] })
  }

  /** Removes a room: its pixels go back to unassigned floor. */
  remove(id: number) {
    const changes: [number, number][] = []
    for (let i = 0; i < this.labels.length; i++) if (this.labels[i] === id) { changes.push([i, id]); this.labels[i] = 0 }
    const before = this.rooms.map((r) => ({ ...r, tags: [...r.tags] }))
    this.rooms = this.rooms.filter((r) => r.id !== id)
    this.record({ labels: changes, boundary: [], rooms: before })
  }

  /** Number of pixels in each room. */
  sizes(): Map<number, number> {
    const sizes = new Map<number, number>()
    for (const id of this.labels) if (id) sizes.set(id, (sizes.get(id) ?? 0) + 1)
    return sizes
  }

  get canUndo() { return this.done.length > 0 }
  get canRedo() { return this.undone.length > 0 }

  undo(): boolean { return this.swap(this.done, this.undone) }
  redo(): boolean { return this.swap(this.undone, this.done) }

  private updateRoom(id: number, patch: Partial<Room>) {
    const before = this.rooms.map((r) => ({ ...r, tags: [...r.tags] }))
    this.rooms = this.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r))
    this.record({ labels: [], boundary: [], rooms: before })
  }

  private record(edit: Edit) {
    this.done.push(edit)
    this.undone = []
  }

  /** Applies an edit's "before" state and stores the current state for the other direction. */
  private swap(from: Edit[], to: Edit[]): boolean {
    const edit = from.pop()
    if (!edit) return false
    const back: Edit = {
      labels: edit.labels.map(([i, value]) => { const now = this.labels[i]!; this.labels[i] = value; return [i, now] }),
      boundary: edit.boundary.map(([i, value]) => { const now = this.boundary[i]!; this.boundary[i] = value; return [i, now] }),
      rooms: this.rooms,
    }
    this.rooms = edit.rooms
    to.push(back)
    return true
  }
}

/**
 * Room colours over the plan (walls stay as the walls overlay draws them), split lines in dark
 * blue, and the selected room a little stronger.
 */
export function paintRooms(layer: RoomLayer, blocked: Uint8Array, selected: number | null, out: Uint8ClampedArray) {
  const rgb = new Map(layer.rooms.map((room) => [room.id, [1, 3, 5].map((k) => parseInt(room.color.slice(k, k + 2), 16))]))
  for (let i = 0; i < layer.labels.length; i++) {
    const o = i * 4
    const id = layer.labels[i]!
    if (layer.boundary[i] && !blocked[i]) {
      out[o] = 30; out[o + 1] = 58; out[o + 2] = 138; out[o + 3] = 200
    } else if (id && !blocked[i]) {
      const [r, g, b] = rgb.get(id) ?? [120, 120, 120]
      out[o] = r!; out[o + 1] = g!; out[o + 2] = b!; out[o + 3] = id === selected ? 120 : 75
    } else {
      out[o + 3] = 0
    }
  }
}
