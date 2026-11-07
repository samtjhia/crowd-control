import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { CompileOutput, DensityGrid, ScenarioPlan, WorkerCommand, WorkerMessage } from '@crowd-control/contract'
import { scenarios, startScenario } from '../sim/scenario.ts'
import { MockSimulation } from '../worker/mock/simulation.ts'
import { heatColor, peakOf, smoothDensity, smoothingRadius, walkableMask } from './heatmap.ts'
import { zoneAt } from './hitTest.ts'

const fixture = <T>(name: string) => JSON.parse(readFileSync(new URL(`../../../contract/fixtures/${name}.json`, import.meta.url), 'utf8')) as T
const compiled = fixture<CompileOutput>('compile-output')

const grid = (width: number, height: number, values: number[], units: DensityGrid['units'] = 'people/m2', cellSize = 0.25): DensityGrid =>
  ({ width, height, cellSize, origin: { x: 0, y: 0 }, units, values })

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

test('smoothing averages over walkable cells only, so walls neither dilute nor glow', () => {
  // A 5 × 3 room whose middle column is a wall, filled evenly at 2 people/m².
  const mask = Uint8Array.from([1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1])
  const even = smoothDensity(grid(5, 3, Array(15).fill(2)), mask, 1)
  for (let i = 0; i < 15; i++) assert.equal(even[i], mask[i] ? 2 : 0, `cell ${i}`)
  // One busy cell spreads into its neighbours and the peak stays where it was.
  const spot = Array(15).fill(0)
  spot[6] = 9
  const smoothed = smoothDensity(grid(5, 3, spot), mask, 1)
  assert.ok(smoothed[6]! > 0 && smoothed[6]! < 9 && smoothed[5]! > 0)
  assert.equal(smoothed[7], 0, 'the wall stays clear')
  const peak = peakOf(smoothed, grid(5, 3, spot))
  // Cell (1, 1) is centred at 0.375 m; next to walls there is less floor to average over, so the peak may sit one cell over.
  assert.ok(Math.abs(peak.x - 0.375) <= 0.25 && Math.abs(peak.y - 0.375) <= 0.25, 'the peak is at or beside the busy cell')
})

test('the smoothing window is about 1.5 m across on metre maps and one body width otherwise', () => {
  assert.equal(smoothingRadius(grid(1, 1, [0])), 3)
  assert.equal(smoothingRadius(grid(1, 1, [0], 'people/model-unit2', 1)), 1)
})

test('walls come from the map: # on generated plans, blocked cells on venues', () => {
  const mask = walkableMask(compiled.scene.map, 24, 6)!
  assert.equal(mask[0], 0)
  assert.equal(mask[1 * 24 + 1], 1)
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
  const smoothed = smoothDensity(density, walkableMask(result.value.scene.map, density.width, density.height), smoothingRadius(density))
  const peak = peakOf(smoothed, density)
  const scene = { map: result.value.scene.map, entities: [], agents: [] }
  assert.equal(zoneAt(scene, peak), 'foyer')
  assert.ok(peak.value > 4, `a packed crowd at a shut exit reads as very crowded (${peak.value.toFixed(1)} people/m²)`)
})
