/**
 * Doors (Technical PRD §7 step 4: portal marking). After the Rooms step every floor pixel
 * belongs to a room. Wherever pixels of two different rooms touch directly, people can pass
 * between them: there is no wall in the way. Each continuous stretch of such contact is one
 * opening, and its length is the opening's width. Short ones are doorways; long ones are open
 * boundaries (two areas of one hall meeting along a split line). Both become portals.
 *
 * Everything works in source pixels: index = y × width + x.
 */

export type PixelRect = { x: number; y: number; width: number; height: number }

/** Where two rooms touch: the rooms (lower ID first), the contact's bounding box and its length. */
export type Opening = { a: number; b: number; rect: PixelRect; length: number }

/**
 * Every opening between rooms in a room-label image (0 = not a room). Contact pixels are those
 * with a 4-neighbour in another room; contacts between the same two rooms that touch (8-way)
 * form one opening. Openings shorter than `minLength` pixels (stray corners) are dropped.
 */
export function findOpenings(labels: Uint16Array, width: number, height: number, minLength = 2): Opening[] {
  const size = width * height
  // For each contact pixel, the other room it touches (first found).
  const other = new Uint16Array(size)
  for (let i = 0; i < size; i++) {
    const id = labels[i]!
    if (!id) continue
    const x = i % width
    const check = (j: number) => { const o = labels[j]!; if (o && o !== id && !other[i]) other[i] = o }
    if (x > 0) check(i - 1)
    if (x < width - 1) check(i + 1)
    if (i >= width) check(i - width)
    if (i < size - width) check(i + width)
  }
  const key = (i: number) => {
    const a = labels[i]!, b = other[i]!
    return a < b ? a * 65536 + b : b * 65536 + a
  }
  const seen = new Uint8Array(size)
  const openings: Opening[] = []
  const stack: number[] = []
  for (let start = 0; start < size; start++) {
    if (!other[start] || seen[start]) continue
    const pair = key(start)
    seen[start] = 1
    stack.push(start)
    let left = width, right = 0, top = height, bottom = 0
    while (stack.length > 0) {
      const i = stack.pop()!
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
          if (!seen[j] && other[j] && key(j) === pair) { seen[j] = 1; stack.push(j) }
        }
      }
    }
    const rect = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
    const length = Math.max(rect.width, rect.height)
    if (length < minLength) continue
    openings.push({ a: Math.floor(pair / 65536), b: pair % 65536, rect, length })
  }
  return openings
}

export type Door = {
  id: number
  /** The rooms joined. For a one-way door, people may only go from `from` to `to`. */
  from: number
  to: number
  rect: PixelRect
  /** Width of the opening, in pixels. */
  length: number
  /** Found by detection (true) or added by the person (false). */
  detected: boolean
  exit: boolean
  oneWay: boolean
  open: boolean
}

/** How much two rectangles overlap, as a share of the smaller one (0–1). */
function overlap(p: PixelRect, q: PixelRect): number {
  const w = Math.min(p.x + p.width, q.x + q.width) - Math.max(p.x, q.x)
  const h = Math.min(p.y + p.height, q.y + q.height) - Math.max(p.y, q.y)
  if (w <= 0 || h <= 0) return 0
  return (w * h) / Math.min(p.width * p.height, q.width * q.height)
}

const samePair = (d: { from: number; to: number }, o: { a: number; b: number }) => (d.from === o.a && d.to === o.b) || (d.from === o.b && d.to === o.a)

/**
 * Merges fresh detection into the current doors: a detected opening that matches an existing
 * door (same rooms, overlapping) keeps that door's settings; a new one becomes a door, an exit
 * if it leads to an `outside` room (inside room first, as the simulator expects); doors the
 * person deleted stay deleted; detected doors whose opening is gone are dropped; added doors
 * are kept while both their rooms exist.
 */
export function reconcileDoors(current: Door[], openings: Opening[], dismissed: PixelRect[], rooms: { id: number; tags: string[] }[], nextId: () => number): Door[] {
  const exists = new Set(rooms.map((room) => room.id))
  const outside = new Set(rooms.filter((room) => room.tags.includes('outside')).map((room) => room.id))
  const result: Door[] = []
  const used = new Set<Door>()
  for (const opening of openings) {
    if (dismissed.some((rect) => overlap(rect, opening.rect) > 0.5)) continue
    const match = current.find((door) => door.detected && !used.has(door) && samePair(door, opening) && overlap(door.rect, opening.rect) > 0.3)
    if (match) {
      used.add(match)
      result.push({ ...match, rect: opening.rect, length: opening.length })
      continue
    }
    // The inside room comes first, so an exit leads out.
    const [from, to] = outside.has(opening.a) && !outside.has(opening.b) ? [opening.b, opening.a] : [opening.a, opening.b]
    result.push({ id: nextId(), from, to, rect: opening.rect, length: opening.length, detected: true, exit: outside.has(to) && !outside.has(from), oneWay: false, open: true })
  }
  for (const door of current) if (!door.detected && exists.has(door.from) && exists.has(door.to)) result.push(door)
  return result
}

/** Rooms with no door at all: people could never get in or out. */
export function roomsWithoutDoors(rooms: { id: number }[], doors: Door[]): number[] {
  const linked = new Set(doors.flatMap((door) => [door.from, door.to]))
  return rooms.length < 2 ? [] : rooms.filter((room) => !linked.has(room.id)).map((room) => room.id)
}

/**
 * A door added by hand across a dragged line: snapped to the line's main direction and
 * `thickness` px thick. It joins the two rooms found along the line, cutting through any wall
 * between them. Returns null unless exactly two rooms are touched.
 */
export function doorAcross(from: { x: number; y: number }, to: { x: number; y: number }, thickness: number, labels: Uint16Array, width: number, height: number): { rect: PixelRect; rooms: [number, number] } | null {
  const horizontal = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)
  const half = Math.max(1, thickness / 2)
  const rect = horizontal
    ? { x: Math.min(from.x, to.x), y: from.y - half, width: Math.abs(to.x - from.x), height: half * 2 }
    : { x: from.x - half, y: Math.min(from.y, to.y), width: half * 2, height: Math.abs(to.y - from.y) }
  const r = {
    x: Math.max(0, Math.floor(rect.x)), y: Math.max(0, Math.floor(rect.y)),
    width: 0, height: 0,
  }
  r.width = Math.min(width, Math.ceil(rect.x + rect.width)) - r.x
  r.height = Math.min(height, Math.ceil(rect.y + rect.height)) - r.y
  if (r.width < 1 || r.height < 1) return null
  const found = new Set<number>()
  for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) { const id = labels[y * width + x]!; if (id) found.add(id) }
  if (found.size !== 2) return null
  const [a, b] = [...found] as [number, number]
  return { rect: r, rooms: [a, b] }
}
