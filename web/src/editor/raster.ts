/**
 * Shared pixel-grid helpers for the editor. Index = y × width + x throughout.
 */

/**
 * Approximate Euclidean distance (in pixels) from each pixel to the nearest pixel where
 * `target` is set (two-pass chamfer). Target pixels are 0; with no target at all, every
 * pixel is very large.
 */
export function distanceTo(target: Uint8Array, width: number, height: number): Float32Array {
  const far = 1e9
  const d = new Float32Array(width * height)
  for (let i = 0; i < d.length; i++) d[i] = target[i] ? 0 : far
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

/** Calls `visit` for the 4 neighbours of pixel `i` that are inside the image. */
export function forNeighbours(i: number, width: number, size: number, visit: (j: number) => void) {
  const x = i % width
  if (x > 0) visit(i - 1)
  if (x < width - 1) visit(i + 1)
  if (i >= width) visit(i - width)
  if (i < size - width) visit(i + width)
}

/**
 * Connected areas (4-way) of pixels where `inside` is true. Returns a component number per
 * pixel (-1 outside) and, per component, its pixel count and whether it touches the image edge.
 */
export function components(inside: (i: number) => boolean, width: number, height: number) {
  const size = width * height
  const label = new Int32Array(size).fill(-1)
  const area: number[] = []
  const edge: boolean[] = []
  const stack: number[] = []
  for (let start = 0; start < size; start++) {
    if (label[start] !== -1 || !inside(start)) continue
    const id = area.length
    let count = 0, touches = false
    label[start] = id
    stack.push(start)
    while (stack.length > 0) {
      const i = stack.pop()!
      count++
      const x = i % width
      if (x === 0 || x === width - 1 || i < width || i >= size - width) touches = true
      forNeighbours(i, width, size, (j) => {
        if (label[j] === -1 && inside(j)) { label[j] = id; stack.push(j) }
      })
    }
    area.push(count)
    edge.push(touches)
  }
  return { label, area, edge }
}
