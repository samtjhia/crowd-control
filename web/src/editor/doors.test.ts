import assert from 'node:assert/strict'
import test from 'node:test'
import { doorAcross, findOpenings, reconcileDoors, roomsWithoutDoors, type Door } from './doors.ts'
import { RoomLayer, partitionFloor } from './rooms.ts'

/**
 * Three rooms in a row, 90 × 30 px: walls at x = 30 and x = 60. The first wall has a 4 px
 * doorway (y 13–16); the second has none. A third area below y = 22 in the right room is split
 * off along an open boundary (no wall), like the stage end of a hall.
 */
function plan() {
  const width = 90, height = 30
  const blocked = new Uint8Array(width * height)
  const at = (x: number, y: number) => y * width + x
  for (let x = 0; x < width; x++) { blocked[at(x, 0)] = 1; blocked[at(x, height - 1)] = 1 }
  for (let y = 0; y < height; y++) {
    blocked[at(0, y)] = 1; blocked[at(width - 1, y)] = 1
    if (y < 13 || y > 16) blocked[at(30, y)] = 1
    blocked[at(60, y)] = 1
  }
  const layer = new RoomLayer(width, height)
  layer.split(Array.from({ length: 28 }, (_, k) => at(61 + k, 22)))
  const spaces = partitionFloor(blocked, layer.boundary, width, height, 3)
  const [left, middle, right, lower] = layer.fillAll(spaces, 20)
  return { width, height, at, layer, blocked, left: left!, middle: middle!, right: right!, lower: lower! }
}

test('a doorway between two rooms is found, about as wide as the gap in the wall', () => {
  const { layer, width, height, left, middle } = plan()
  const openings = findOpenings(layer.labels, width, height)
  const door = openings.find((o) => (o.a === left.id && o.b === middle.id) || (o.a === middle.id && o.b === left.id))
  assert.ok(door, 'left and middle rooms are joined')
  assert.ok(door.length >= 3 && door.length <= 6, `width ${door.length} px for a 4 px doorway`)
  assert.ok(door.rect.x >= 27 && door.rect.x <= 33, 'it sits in the wall’s gap')
})

test('rooms separated by a solid wall are not joined; an open boundary is', () => {
  const { layer, width, height, middle, right, lower } = plan()
  const openings = findOpenings(layer.labels, width, height)
  const joins = (p: number, q: number) => openings.some((o) => (o.a === p && o.b === q) || (o.a === q && o.b === p))
  assert.equal(joins(middle.id, right.id), false, 'no gap in the wall at x = 60')
  assert.ok(joins(right.id, lower.id), 'the split line is crossable')
  const boundary = openings.find((o) => (o.a === right.id && o.b === lower.id) || (o.a === lower.id && o.b === right.id))!
  assert.ok(boundary.length > 20, 'and as wide as the whole boundary')
})

test('detected openings become doors; exits lead outside; deleted doors stay deleted; settings survive re-detection', () => {
  const rooms = [{ id: 1, tags: [] }, { id: 2, tags: [] }, { id: 3, tags: ['outside'] }]
  const openings = [
    { a: 1, b: 2, rect: { x: 10, y: 0, width: 2, height: 4 }, length: 4 },
    { a: 2, b: 3, rect: { x: 20, y: 0, width: 2, height: 4 }, length: 4 },
  ]
  let id = 1
  const next = () => id++
  const doors = reconcileDoors([], openings, [], rooms, next)
  assert.equal(doors.length, 2)
  const exit = doors.find((d) => d.to === 3 || d.from === 3)!
  assert.deepEqual([exit.from, exit.to, exit.exit], [2, 3, true], 'inside room first, marked as an exit')
  assert.equal(doors.find((d) => d.from === 1)!.exit, false)

  const edited: Door[] = doors.map((d) => (d.from === 1 ? { ...d, oneWay: true } : d))
  const again = reconcileDoors(edited, openings, [], rooms, next)
  assert.equal(again.find((d) => d.from === 1)!.oneWay, true, 'a door’s settings are kept')
  assert.equal(again.find((d) => d.from === 1)!.id, doors.find((d) => d.from === 1)!.id)

  const dismissed = reconcileDoors(again, openings, [openings[0]!.rect], rooms, next)
  assert.equal(dismissed.length, 1, 'a deleted door is not found again')
})

test('a door can be added across a wall between two rooms; anything else is refused', () => {
  const { layer, width, height, middle, right } = plan()
  const added = doorAcross({ x: 55, y: 8 }, { x: 65, y: 8 }, 4, layer.labels, width, height)
  assert.ok(added)
  assert.deepEqual(new Set(added.rooms), new Set([middle.id, right.id]))
  assert.equal(added.rect.height, 4, 'snapped to a horizontal opening, 4 px thick')
  assert.equal(doorAcross({ x: 40, y: 8 }, { x: 50, y: 8 }, 4, layer.labels, width, height), null, 'a line inside one room is not a door')
})

test('a room with no doors is flagged, since nobody could get in or out', () => {
  const doors: Door[] = [{ id: 1, from: 1, to: 2, rect: { x: 0, y: 0, width: 1, height: 1 }, length: 1, detected: true, exit: false, oneWay: false, open: true }]
  assert.deepEqual(roomsWithoutDoors([{ id: 1 }, { id: 2 }, { id: 3 }], doors), [3])
  assert.deepEqual(roomsWithoutDoors([{ id: 1 }], []), [], 'a single room needs no doors')
})
