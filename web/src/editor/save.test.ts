import assert from 'node:assert/strict'
import test from 'node:test'
import { PreparedMapSchema, type Calibration, type WorkerCommand, type WorkerMessage } from '@crowd-control/contract'
import { PEDESTRIAN_PRESET, fittedStarterPlan, startScenario } from '../sim/scenario.ts'
import { MockSimulation } from '../worker/mock/simulation.ts'
import { findOpenings, reconcileDoors } from './doors.ts'
import { RoomLayer, partitionFloor } from './rooms.ts'
import { checkAndBuild, worldPerPixel, type TracedPlan } from './save.ts'
import { FLOOR, WALL } from './walls.ts'

/**
 * A traced plan at 5 cm per pixel (120 × 60 px = 6 × 3 m): two rooms side by side with a 1 m
 * doorway, and below a wall with a 1 m exit, a strip open to the bottom edge of the plan (outside).
 * Walls are 2 px (10 cm) thick unless `thin` makes the middle wall 1 px.
 */
function traced(options: { doorBetweenRooms?: boolean; thin?: boolean; scaled?: boolean } = {}): TracedPlan {
  const { doorBetweenRooms = true, thin = false, scaled = true } = options
  const width = 120, height = 60
  const kinds = new Uint8Array(width * height).fill(FLOOR)
  const wall = (x0: number, y0: number, x1: number, y1: number) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) kinds[y * width + x] = WALL }
  wall(0, 0, 120, 2); wall(0, 0, 2, 60); wall(118, 0, 120, 60) // top, left, right (the bottom is open: outside)
  wall(60, 2, thin ? 61 : 62, 44) // the middle wall …
  if (doorBetweenRooms) for (let y = 20; y < 40; y++) for (let x = 60; x < 62; x++) kinds[y * width + x] = FLOOR // … with a 1 m doorway
  wall(0, 44, 90, 46); wall(110, 44, 120, 46) // the wall to the outside, with a 1 m exit at x 90–110
  const blocked = kinds.map((k) => (k === WALL ? 1 : 0))
  const layer = new RoomLayer(width, height)
  layer.fillAll(partitionFloor(blocked, layer.boundary, width, height, 12), 100) // splits at openings under 24 px (1.2 m)
  let id = 1
  const doors = reconcileDoors([], findOpenings(layer.labels, width, height), [], layer.rooms, () => id++)
  const calibration: Calibration | null = scaled ? { pointsPx: [[0, 0], [100, 0]], distanceMetres: 5, metresPerPixel: 0.05 } : null
  return {
    source: { assetId: 'upload-test', revision: 'draft', page: 1, mimeType: 'image/png', pixelWidth: width, pixelHeight: height, contentHash: 'abc' },
    width, height, kinds, furnitureBlocks: true, labels: layer.labels, rooms: layer.rooms, doors, calibration,
    name: 'Test', floor: 'Ground', revision: 'r1',
  }
}

test('a traced plan becomes a reviewed 0.25 m venue map that passes the contract', () => {
  const plan = traced()
  const result = checkAndBuild(plan)
  assert.deepEqual(result.problems.filter((p) => p.severity === 'error'), [])
  assert.ok(result.map)
  assert.equal(PreparedMapSchema.safeParse(result.map).success, true)
  assert.deepEqual([result.grid.width, result.grid.height, result.grid.cellSize, result.grid.units], [24, 12, 0.25, 'm'])
  assert.deepEqual(result.grid.zoneIds, [null, 'room_1', 'room_2', 'outside'])
  assert.equal(result.map.source.mode, 'upload')
  const exit = result.map.entities.find((e) => e.tags?.includes('exit'))
  assert.ok(exit, 'the door to the outside strip is an exit')
  assert.equal(exit.components?.portal?.connects[1], 'outside', 'leading out')
})

test('doors stay open at their measured width, and thin walls never vanish', () => {
  const result = checkAndBuild(traced({ thin: true }))
  const { grid } = result
  // The 1 px (5 cm) middle wall still blocks the cells it crosses, away from the doorway.
  const at = (x: number, y: number) => y * grid.width + x
  assert.equal(grid.blocked[at(12, 2)], 1, 'a 5 cm wall is still a wall at 25 cm cells')
  // The 1 m doorway (y 1.0–2.0 m, cells 4–7) is open through the wall column.
  const doorCells = [4, 5, 6, 7].filter((y) => grid.blocked[at(12, y)] === 0 && grid.portalIndex[at(12, y)]! > 0)
  assert.ok(doorCells.length >= 3, `the doorway keeps about its 1 m (${doorCells.length} cells)`)
})

test('a room nobody can reach is an error, with where it is', () => {
  const result = checkAndBuild(traced({ doorBetweenRooms: false }))
  const unreachable = result.problems.find((p) => p.severity === 'error' && /Nobody can reach/.test(p.message))
  assert.ok(unreachable, JSON.stringify(result.problems))
  assert.ok(unreachable.at, 'so the editor can point at it')
  assert.equal(result.map, null, 'and the map is not saved')
})

test('a plan without a scale runs in body widths, sized from its doors', () => {
  const plan = traced({ scaled: false })
  assert.ok(Math.abs(worldPerPixel(plan) - 2 / 20) < 0.02, 'a 20 px door is taken as two bodies wide')
  const result = checkAndBuild(plan)
  assert.equal(result.grid.units, 'model')
  assert.ok(result.problems.some((p) => p.severity === 'warning' && /no scale/.test(p.message)))
  assert.ok(result.map)
})

test('the saved venue plays in the simulator with a starter crowd that leaves when the alarm sounds', () => {
  const map = checkAndBuild(traced()).map!
  const venue = { name: 'Test', floor: 'Ground', savedAt: '', map }
  const compiled = startScenario(fittedStarterPlan(venue, PEDESTRIAN_PRESET), PEDESTRIAN_PRESET, {}, [map])
  assert.ok(compiled.ok, JSON.stringify(compiled.ok ? '' : compiled.error))
  const id = compiled.value.scene.simulationId
  const sim = new MockSimulation()
  let n = 0
  const send = (body: Record<string, unknown>): WorkerMessage[] => sim.handle({ schemaVersion: 1, simulationId: id, commandId: `c${++n}`, ...body } as WorkerCommand)
  send({ type: 'load', compiled: compiled.value, history: { historyRevision: 0, records: [], outcomes: [] } })
  const frame = send({ type: 'run_to', time: 90 }).filter((m) => m.type === 'frame').at(-1)
  assert.ok(frame?.type === 'frame')
  assert.ok(frame.frame.agents.length >= 1, "the small test room still gets a crowd that fits")
  assert.ok(frame.frame.agents.every((agent) => agent.state === 'departed'), 'everyone got out through the exit')
})
