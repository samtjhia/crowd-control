import assert from 'node:assert/strict'
import test from 'node:test'
import { FLOOR, OBJECT, WALL, WallMask, draftLayers, draftWalls, paintWalls, removeSpecks, suggestThreshold, type Pixels } from './walls.ts'

/** A test plan: white paper, a dark wall line across row 10, and a small dark "letter" blob. */
function plan(width = 100, height = 40): Pixels {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  const ink = (x: number, y: number, shade = 30) => {
    const i = (y * width + x) * 4
    data[i] = data[i + 1] = data[i + 2] = shade
  }
  for (let x = 5; x < 95; x++) for (let y = 9; y <= 11; y++) ink(x, y) // a long wall, 3 px thick
  for (let x = 40; x < 42; x++) for (let y = 25; y < 27; y++) ink(x, y) // a small letter (the cut-off on a 40 px tall plan is 3 px)
  for (let x = 70; x < 75; x++) ink(x, 30, 180) // a faint grey line
  return { data, width, height }
}
const at = (mask: Uint8Array, x: number, y: number, width = 100) => mask[y * width + x]

test('the suggested threshold separates dark ink from light paper', () => {
  const t = suggestThreshold(plan())
  assert.ok(t > 30 && t < 250, `${t}`)
  const walls = draftWalls(plan(), t, false)
  assert.equal(at(walls, 50, 10), 1, 'the wall is wall')
  assert.equal(at(walls, 50, 20), 0, 'the paper is not')
})

test('the threshold decides how light a line can be and still count as wall', () => {
  assert.equal(at(draftWalls(plan(), 128, false), 72, 30), 0, 'a faint grey line is ignored at a low cut-off')
  assert.equal(at(draftWalls(plan(), 200, false), 72, 30), 1, 'and caught at a higher one')
})

test('"ignore text and small marks" drops small blobs but keeps long walls', () => {
  const kept = draftWalls(plan(), 128, false)
  const cleaned = draftWalls(plan(), 128, true)
  assert.equal(at(kept, 41, 26), 1)
  assert.equal(at(cleaned, 41, 26), 0, 'the letter is gone')
  assert.equal(at(cleaned, 50, 10), 1, 'the wall stays')
  // A lone dot, a blank row, then a long line: the dot goes, the line stays.
  const mask = Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1])
  removeSpecks(mask, 5, 3, 3)
  assert.deepEqual([...mask], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1], 'size is measured by extent, not pixel count')
})

test('brushes paint walls and floor; corrections win over the draft', () => {
  const mask = new WallMask(100, 40, draftWalls(plan(), 128, false))
  mask.beginStroke(FLOOR) // erase: cut a doorway in the wall
  mask.paint({ x: 50, y: 10 }, { x: 50, y: 10 }, 2)
  mask.endStroke()
  assert.equal(mask.isWall(10 * 100 + 50), false, 'the doorway is open')
  mask.beginStroke(WALL) // draw a new wall
  mask.paint({ x: 20, y: 30 }, { x: 30, y: 30 }, 1)
  mask.endStroke()
  assert.equal(mask.isWall(30 * 100 + 25), true, 'the segment between the points is painted')
  mask.setDraft(draftWalls(plan(), 250, false)) // a new threshold
  assert.equal(mask.isWall(10 * 100 + 50), false, 'changing the threshold never erases a correction')
  assert.deepEqual(mask.corrections().map((c) => c.walkable), [true, false], 'corrections are stored in the contract form')
})

test('undo and redo replay strokes exactly', () => {
  const mask = new WallMask(100, 40, new Uint8Array(4000))
  mask.beginStroke(WALL)
  mask.paint({ x: 10, y: 10 }, { x: 10, y: 10 }, 3)
  mask.endStroke()
  mask.beginStroke(FLOOR)
  mask.paint({ x: 10, y: 10 }, { x: 10, y: 10 }, 1)
  mask.endStroke()
  const centre = 10 * 100 + 10, edge = 10 * 100 + 12
  assert.deepEqual([mask.isWall(centre), mask.isWall(edge)], [false, true])
  mask.undo()
  assert.deepEqual([mask.isWall(centre), mask.isWall(edge)], [true, true])
  mask.undo()
  assert.deepEqual([mask.isWall(centre), mask.isWall(edge)], [false, false])
  assert.equal(mask.canUndo, false)
  mask.redo()
  mask.redo()
  assert.deepEqual([mask.isWall(centre), mask.isWall(edge)], [false, true])
  mask.undo()
  mask.beginStroke(WALL)
  mask.paint({ x: 50, y: 30 }, { x: 50, y: 30 }, 1)
  mask.endStroke()
  assert.equal(mask.canRedo, false, 'a new stroke clears redo')
})

test('an empty stroke (a click off the plan) is not recorded', () => {
  const mask = new WallMask(10, 10, new Uint8Array(100))
  mask.beginStroke(WALL)
  assert.equal(mask.paint({ x: -50, y: -50 }, { x: -40, y: -50 }, 2), null)
  assert.equal(mask.endStroke(), false)
  assert.equal(mask.canUndo, false)
})

test('the overlay shows walls in red and everything else clear', () => {
  const mask = new WallMask(100, 40, draftWalls(plan(), 128, true))
  const out = new Uint8ClampedArray(100 * 40 * 4)
  paintWalls(mask, out)
  const pixel = (x: number, y: number) => [...out.slice((y * 100 + x) * 4, (y * 100 + x) * 4 + 4)]
  assert.equal(pixel(50, 10)[0], 220)
  assert.ok(pixel(50, 10)[3]! > 0)
  assert.equal(pixel(50, 20)[3], 0)
})

/**
 * A 120 × 80 px plan like the one in the screenshot: a thick (6 px) wall box, a wall drawn as
 * two thin lines with a gap (a hollow wall), a table drawn as a thin outline, and a row of
 * thin seat marks.
 */
function furnishedPlan() {
  const width = 120, height = 80
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  const ink = (x: number, y: number) => { const i = (y * width + x) * 4; data[i] = data[i + 1] = data[i + 2] = 40 }
  const box = (x0: number, y0: number, x1: number, y1: number) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) ink(x, y) }
  box(0, 0, 120, 6); box(0, 74, 120, 80); box(0, 0, 6, 80); box(114, 0, 120, 80) // thick outer walls
  box(60, 6, 61, 74); box(64, 6, 65, 74) // a hollow wall: two 1 px lines, 3 px apart
  box(20, 20, 40, 21); box(20, 35, 40, 36); box(20, 20, 21, 36); box(39, 20, 40, 36) // a table outline
  for (let x = 80; x < 104; x += 4) box(x, 50, x + 2, 52) // seat marks
  const pixels: Pixels = { data, width, height }
  return { pixels, at: (x: number, y: number) => y * width + x }
}

const settings = { threshold: 128, ignoreSpecks: false, wallThickness: 4, maxObjectArea: 600 }

test('thick strokes are walls; thin outlines are furniture, not walls', () => {
  const { pixels, at } = furnishedPlan()
  const kinds = draftLayers(pixels, settings)
  assert.equal(kinds[at(3, 40)], WALL, 'the 6 px outer wall')
  assert.equal(kinds[at(30, 20)], OBJECT, 'the table’s 1 px outline')
  assert.equal(kinds[at(81, 51)], OBJECT, 'a seat mark')
  assert.equal(kinds[at(50, 60)], FLOOR, 'open floor')
})

test('a wall drawn as two thin lines with a narrow gap counts as one solid wall', () => {
  const { pixels, at } = furnishedPlan()
  const kinds = draftLayers(pixels, settings)
  assert.equal(kinds[at(60, 40)], WALL)
  assert.equal(kinds[at(62, 40)], WALL, 'the gap between the lines is filled')
  assert.equal(kinds[at(64, 40)], WALL)
})

test('a small closed outline is filled in as furniture, so people go around the whole table', () => {
  const { pixels, at } = furnishedPlan()
  const kinds = draftLayers(pixels, settings)
  assert.equal(kinds[at(30, 28)], OBJECT, 'the inside of the table')
  assert.equal(draftLayers(pixels, { ...settings, maxObjectArea: 100 })[at(30, 28)], FLOOR, 'unless it is bigger than the furniture size limit')
})

test('at “any thickness”, everything dark is wall, as before', () => {
  const { pixels, at } = furnishedPlan()
  const kinds = draftLayers(pixels, { ...settings, wallThickness: 0 })
  assert.equal(kinds[at(30, 20)], WALL)
  assert.equal(kinds[at(30, 28)], FLOOR)
})

test('rooms see only walls; furniture is reported separately', () => {
  const { pixels, at } = furnishedPlan()
  const mask = new WallMask(120, 80, draftLayers(pixels, settings))
  assert.equal(mask.blocked()[at(30, 20)], 0, 'furniture never cuts a room up')
  assert.equal(mask.objects()[at(30, 20)], 1)
  mask.beginStroke(OBJECT)
  mask.paint({ x: 50, y: 60 }, { x: 50, y: 60 }, 1)
  mask.endStroke()
  assert.equal(mask.isObject(at(50, 60)), true, 'the Object brush marks furniture by hand')
  assert.equal(mask.corrections().at(-1)?.walkable, false)
})
