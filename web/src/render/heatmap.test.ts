import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { CompileOutput, ScenarioPlan, WorkerCommand, WorkerMessage } from '@crowd-control/contract'
import { scenarios, startScenario } from '../sim/scenario.ts'
import { MockSimulation } from '../worker/mock/simulation.ts'
import { blurOverFloor, gaussianKernel, heatColor, heatGridFor, peakOf, smoothDensity, splatPositions, walkableMask, type HeatGrid } from './heatmap.ts'
import { zoneAt } from './hitTest.ts'

const fixture = <T>(name: string) => JSON.parse(readFileSync(new URL(`../../../contract/fixtures/${name}.json`, import.meta.url), 'utf8')) as T
const compiled = fixture<CompileOutput>('compile-output')

/** An open 10 × 10 m floor at 0.25 m cells. */
const open: HeatGrid = { width: 40, height: 40, cellSize: 0.25, mask: null }
const at = (field: Float32Array, x: number, y: number) => field[Math.floor(y / 0.25) * 40 + Math.floor(x / 0.25)]!

function glow(points: { x: number; y: number }[]) {
  const people = new Float32Array(open.width * open.height)
  splatPositions(points, open, people)
  return blurOverFloor(people, null, open.width, open.height, gaussianKernel(0.6 / 0.25))
}

test('colours: empty floor is clear, and denser spots move through the indicative bands', () => {
  const metric = { kind: 'metric' as const }
  assert.deepEqual(heatColor(0, metric), [0, 0, 0, 0])
  const [, , , calm] = heatColor(0.5, metric)
  const [, , , busy] = heatColor(2, metric)
  const [r5, g5] = heatColor(5, metric)
  assert.ok(calm < busy, 'denser is more opaque')
  assert.ok(r5 > 200 && g5 < 120, '5 people/m² is in the red-orange range')
  assert.deepEqual(heatColor(20, metric), heatColor(8, metric), 'beyond the last band the colour holds')
  const relative = { kind: 'relative' as const, max: 4 }
  assert.deepEqual(heatColor(4, relative), heatColor(8, { kind: 'relative', max: 8 }), 'relative colours depend on the share of the peak')
  const [rr, , rb] = heatColor(4, relative)
  assert.ok(rb > rr, 'relative mode uses neutral blues and violets, not danger reds')
})

test('one person is a round glow, not a square', () => {
  const field = glow([{ x: 5, y: 5 }])
  const straight = at(field, 5 + 0.75, 5)
  const diagonal = at(field, 5 + 0.53, 5 + 0.53) // also about 0.75 m away
  assert.ok(Math.abs(straight - diagonal) / straight < 0.25, `same distance, similar strength (${straight.toFixed(3)} vs ${diagonal.toFixed(3)})`)
  assert.ok(at(field, 5, 5) > straight && straight > at(field, 6.5, 5), 'fades with distance')
})

test('the glow moves smoothly as a person walks, instead of jumping a cell at a time', () => {
  const before = glow([{ x: 5, y: 5 }])
  const nudged = glow([{ x: 5.05, y: 5 }]) // a fifth of a cell
  let change = 0, total = 0
  for (let i = 0; i < before.length; i++) {
    change += Math.abs(nudged[i]! - before[i]!)
    total += before[i]!
  }
  assert.ok(change / total < 0.25, 'a small step makes a small change')
  assert.ok(at(nudged, 5.4, 5) > at(before, 5.4, 5), 'and the glow shifts the way they walked')
})

test('density is kept: one person over the floor adds up to one person', () => {
  const people = new Float32Array(open.width * open.height)
  splatPositions([{ x: 3.1, y: 7.3 }], open, people)
  const sum = people.reduce((a, b) => a + b, 0) * 0.25 * 0.25
  assert.ok(Math.abs(sum - 1) < 1e-6)
})

test('walls neither dilute a crowd nor glow', () => {
  // A 5 × 3 room whose middle column is a wall, filled evenly at 2 people/m².
  const mask = Uint8Array.from([1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1])
  const even = blurOverFloor(Array(15).fill(2), mask, 5, 3, gaussianKernel(1.5))
  for (let i = 0; i < 15; i++) assert.ok(Math.abs(even[i]! - (mask[i] ? 2 : 0)) < 1e-5, `cell ${i}`)
})

test('coarse plans get a finer heat grid, with walls carried over', () => {
  const grid = heatGridFor(compiled.scene.map, 24, 6, 1.1)
  assert.ok(grid.width > 24 && grid.width % 24 === 0, 'body-wide cells are split for a smooth image')
  assert.equal(grid.mask![0], 0, 'the corner is still wall')
  const split = grid.width / 24
  assert.equal(grid.mask![(1 * split) * grid.width + 1 * split], 1, 'the hall is still floor')
  assert.equal(walkableMask(compiled.scene.map, 10, 10), null, 'a grid of another size is not masked')
})

test('with the concert exits shut, the densest spot is in the foyer by the doors', () => {
  const concert = scenarios(fixture<ScenarioPlan>('scenario-plan'), compiled.resolvedModel).find((s) => s.id === 'concert-floor')!
  const result = startScenario(concert.plan, concert.model)
  if (!result.ok) throw new Error(result.error.message)
  const id = result.value.scene.simulationId
  const sim = new MockSimulation()
  let n = 0
  const send = (body: Record<string, unknown>): WorkerMessage[] => sim.handle({ schemaVersion: 1, simulationId: id, commandId: `c${++n}`, ...body } as WorkerCommand)
  send({ type: 'load', compiled: result.value, history: { historyRevision: 0, records: [], outcomes: [] } })
  send({ type: 'apply_request', request: { schemaVersion: 1, simulationId: id, requestId: 'shut', operations: [{ op: 'set', targets: { ids: ['street_exit_west', 'street_exit_east'] }, values: { components: { portal: { open: false } } } }] } })
  const metrics = send({ type: 'run_to', time: 120 }).filter((m) => m.type === 'metrics').at(-1)
  assert.ok(metrics?.type === 'metrics' && metrics.density)
  const density = metrics.density
  assert.equal(density.units, 'people/m2')
  const smoothed = smoothDensity(density, walkableMask(result.value.scene.map, density.width, density.height))
  const peak = peakOf(smoothed, density)
  assert.equal(zoneAt({ map: result.value.scene.map, entities: [], agents: [] }, peak), 'foyer')
  assert.ok(peak.value > 4, `a packed crowd at a shut exit reads as very crowded (${peak.value.toFixed(1)} people/m²)`)
})
