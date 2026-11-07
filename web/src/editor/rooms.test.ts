import assert from 'node:assert/strict'
import test from 'node:test'
import { RoomLayer, distanceToWalls, lineIndices, partitionFloor } from './rooms.ts'

/**
 * A 60 × 30 px test plan: an outer wall, and an inner wall at x = 30 with a 4 px doorway
 * (y 13–16) between a left room and a right room.
 */
function twoRooms(width = 60, height = 30) {
  const blocked = new Uint8Array(width * height)
  for (let x = 0; x < width; x++) { blocked[x] = 1; blocked[(height - 1) * width + x] = 1 }
  for (let y = 0; y < height; y++) {
    blocked[y * width] = 1
    blocked[y * width + width - 1] = 1
    if (y < 13 || y > 16) blocked[y * width + 30] = 1
  }
  return { blocked, width, height, at: (x: number, y: number) => y * width + x }
}

test('distance to walls grows away from them', () => {
  const { blocked, width, height, at } = twoRooms()
  const d = distanceToWalls(blocked, width, height)
  assert.equal(d[at(0, 0)], 0)
  assert.equal(d[at(1, 10)], 1)
  assert.equal(d[at(5, 10)], 5)
  assert.ok(d[at(15, 15)]! > 10)
})

test('a fill stops at a doorway narrower than the gap, and leaks through when the rule is off', () => {
  const { blocked, width, height, at } = twoRooms()
  const none = new Uint8Array(width * height)
  const split = partitionFloor(blocked, none, width, height, 3) // openings under 6 px split
  assert.notEqual(split[at(10, 10)], split[at(50, 10)], 'left and right rooms are separate spaces')
  assert.equal(split[at(28, 15)], split[at(10, 10)], 'the doorway’s left half joins the left room')
  assert.equal(split[at(32, 15)], split[at(50, 10)], 'and its right half the right room')
  const plain = partitionFloor(blocked, none, width, height, 0)
  assert.equal(plain[at(10, 10)], plain[at(50, 10)], 'with the rule off, the doorway joins them')
  assert.equal(split[at(30, 5)], -1, 'walls belong to no space')
})

test('a corridor wider than the gap stays its own space', () => {
  // Two rooms joined by a 10 px wide corridor through the middle wall.
  const { blocked, width, height, at } = twoRooms()
  for (let y = 10; y < 20; y++) blocked[at(30, y)] = 0
  const split = partitionFloor(blocked, new Uint8Array(width * height), width, height, 3)
  assert.equal(split[at(10, 10)], split[at(50, 10)], 'a 10 px opening is wider than 6 px, so it does not split')
})

test('a split line divides a space without becoming a wall', () => {
  const { blocked, width, height, at } = twoRooms()
  const layer = new RoomLayer(width, height)
  layer.split(lineIndices({ x: 15, y: 0 }, { x: 15, y: 30 }, 1, width, height))
  assert.equal(blocked[at(15, 10)], 0, 'still floor')
  const spaces = partitionFloor(blocked, layer.boundary, width, height, 0)
  assert.notEqual(spaces[at(5, 10)], spaces[at(25, 10)])
  const left = layer.fill(at(5, 10), spaces)!
  const right = layer.fill(at(25, 10), spaces)!
  assert.notEqual(left.id, right.id)
  const onLine = [...layer.boundary.keys()].filter((i) => layer.boundary[i] && !blocked[i])
  assert.ok(onLine.every((i) => layer.labels[i] !== 0), 'the split line’s floor is shared out, so the rooms meet without a gap')
})

test('filling, selecting by clicking a room, adding to it, tags and removing', () => {
  const { blocked, width, height, at } = twoRooms()
  const layer = new RoomLayer(width, height)
  const spaces = partitionFloor(blocked, layer.boundary, width, height, 3)
  const hall = layer.fill(at(10, 10), spaces)!
  assert.equal(hall.label, 'Room 1')
  assert.equal(layer.roomAt(at(12, 20))?.id, hall.id, 'the whole space is the room')
  assert.equal(layer.roomAt(at(50, 10)), null)
  assert.equal(layer.fill(at(12, 20), spaces), null, 'filling an existing room does nothing (it is selected instead)')
  layer.fill(at(50, 10), spaces, hall.id)
  assert.equal(layer.roomAt(at(50, 10))?.id, hall.id, 'Shift-fill adds the other space to the same room')
  assert.equal(layer.rooms.length, 1)
  layer.toggleTag(hall.id, 'outside')
  assert.deepEqual(layer.rooms[0]!.tags, ['outside'])
  layer.remove(hall.id)
  assert.equal(layer.roomAt(at(10, 10)), null)
  assert.equal(layer.rooms.length, 0)
})

test('undo and redo cover fills, split lines, tags and removals, but not typing a name', () => {
  const { blocked, width, height, at } = twoRooms()
  const layer = new RoomLayer(width, height)
  const spaces = partitionFloor(blocked, layer.boundary, width, height, 3)
  const room = layer.fill(at(10, 10), spaces)!
  layer.rename(room.id, 'Gym')
  layer.toggleTag(room.id, 'assembly')
  layer.undo()
  assert.deepEqual(layer.rooms[0]!.tags, [])
  assert.equal(layer.rooms[0]!.label, 'Gym', 'the name typed is kept')
  layer.undo()
  assert.equal(layer.roomAt(at(10, 10)), null)
  assert.equal(layer.rooms.length, 0)
  assert.equal(layer.canUndo, false)
  layer.redo()
  assert.equal(layer.roomAt(at(10, 10))?.id, room.id)
  layer.redo()
  assert.deepEqual(layer.rooms[0]!.tags, ['assembly'])
})

test('splitting a million-pixel plan into spaces is fast enough to feel instant', () => {
  const width = 1155, height = 866
  const blocked = new Uint8Array(width * height)
  for (let k = 0; k < 10; k++) {
    for (let x = 0; x < width; x++) for (let t = 0; t < 4; t++) blocked[(40 + k * 80 + t) * width + x] = 1
    for (let y = 0; y < height; y++) for (let t = 0; t < 4; t++) blocked[y * width + 40 + k * 110 + t] = 1
  }
  partitionFloor(blocked, new Uint8Array(width * height), width, height, 15)
  const start = performance.now()
  partitionFloor(blocked, new Uint8Array(width * height), width, height, 15)
  const ms = performance.now() - start
  assert.ok(ms < 400, `${ms.toFixed(0)} ms`)
})
