import assert from 'node:assert/strict'
import test from 'node:test'
import { describePoint, nextPointId, pointsKeyForLayout, pointsKeyForSource, pointsNote, preparedGeometry } from './points.ts'
import { venueAssets } from './scenario.ts'

const hackathon = venueAssets().find((map) => map.id === 'hackathon-hall')!

test('points are lettered A to Z, then A2, and filling gaps first', () => {
  assert.equal(nextPointId([]), 'A')
  assert.equal(nextPointId([{ id: 'A', x: 0, y: 0 }, { id: 'C', x: 0, y: 0 }]), 'B')
  assert.equal(nextPointId(Array.from({ length: 26 }, (_, i) => ({ id: String.fromCharCode(65 + i), x: 0, y: 0 }))), 'A2')
})

test('a venue has the same points whether it is loaded or chosen for a new scenario', () => {
  const source = hackathon.source
  assert.equal(pointsKeyForSource(source, 'anything'), pointsKeyForLayout({ mode: 'lookup', venue: 'Hackathon Hall', floor: 'Main hall' }))
  assert.equal(pointsKeyForLayout({ mode: 'generate', spaces: [], connections: [] } as never), null)
})

test('a point is described by its area, nearest doors and what it is next to, by real ID', () => {
  const geo = preparedGeometry(hackathon)
  const inLobby = describePoint({ id: 'A', x: 12, y: 7 }, geo)
  assert.equal(inLobby.area?.id, 'lobby')
  assert.deepEqual(inLobby.doors.map((d) => d.item.id), ['checkin_a', 'checkin_b'], 'desk A is nearer than desk B')
  const byTable = describePoint({ id: 'B', x: 22, y: 6.2 }, geo)
  assert.equal(byTable.things[0]?.item.id, 'table_1')
  assert.equal(describePoint({ id: 'C', x: 0.1, y: 0.1 }, geo).area, null, 'a point in a wall is on no floor')

  const note = pointsNote([{ id: 'A', x: 12, y: 7 }], geo)
  assert.match(note, /Point A at \(12, 7\) m, in Lobby \(area lobby\)\./)
  assert.match(note, /Nearest doors: Check-in desk A \(door checkin_a, 3\.2 m away, joins Lobby \(area lobby\) and Hacking hall \(area hall\); the point is on the Lobby side, the other side is Hacking hall \(area hall\)\); Check-in desk B/)
  const byEntrance = pointsNote([{ id: 'B', x: 7, y: 13.5 }], geo)
  assert.match(byEntrance, /Main entrance \(door main_entrance, [\d.]+ m away, joins Lobby \(area lobby\) and Street \(area street, outside\); the point is on the Lobby side, the other side is Street \(area street, outside\)\)/)
  assert.match(byEntrance, /make their FIRST goal reach that door by its ID/)
  assert.equal(pointsNote([], geo), '')
})
