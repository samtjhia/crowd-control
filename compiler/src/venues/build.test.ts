import assert from 'node:assert/strict'
import test from 'node:test'
import { PreparedMapSchema, type GridData, type PreparedMap, type Result } from '@crowd-control/contract'
import { testVenue } from '../testing.ts'
import { buildPreparedMap, type VenueSpec } from './build.ts'

function value<T>(result: Result<T>): T {
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) throw new Error('unreachable')
  return result.value
}

const count = (grid: GridData, key: 'zoneIndex' | 'portalIndex', id: string) => {
  const index = (key === 'zoneIndex' ? grid.zoneIds : grid.portalIds).indexOf(id)
  return grid[key].filter((i) => i === index).length
}
const code = (result: Result<unknown>) => (result.ok ? null : result.error.code)
const edited = (edit: (spec: VenueSpec) => void) => {
  const spec = testVenue()
  edit(spec)
  return buildPreparedMap(spec)
}

test('a venue becomes a reviewed, metre-scaled 0.25 m grid', () => {
  const map: PreparedMap = value(buildPreparedMap(testVenue()))
  assert.equal(PreparedMapSchema.safeParse(map).success, true)
  assert.deepEqual([map.grid.width, map.grid.height, map.grid.cellSize, map.grid.units], [40, 24, 0.25, 'm'])
  assert.deepEqual(map.source, { mode: 'lookup', assetId: 'test-lobby', revision: 'r1', venue: 'Test Lobby', floor: 'Ground' })
  assert.deepEqual(map.grid.zoneIds, [null, 'lobby', 'cafe'])
  assert.deepEqual(map.grid.portalIds, [null, 'cafe_door'])
})

test('measured geometry is kept exactly: 6 × 5 m lobby, L-shaped cafe, 1 m door', () => {
  const { grid } = value(buildPreparedMap(testVenue()))
  assert.equal(count(grid, 'zoneIndex', 'lobby'), 24 * 20)
  assert.equal(count(grid, 'zoneIndex', 'cafe'), 10 * 8 + 4 * 12)
  assert.equal(count(grid, 'portalIndex', 'cafe_door'), 2 * 4)
  const at = (x: number, y: number) => Math.floor(y / 0.25) * grid.width + Math.floor(x / 0.25)
  assert.equal(grid.blocked[at(8.5, 4)], 1, 'the cut-out corner of the L is wall')
  assert.equal(grid.blocked[at(0.2, 0.2)], 1, 'outside every area is wall')
  assert.equal(grid.blocked[at(6.75, 1.5)], 0, 'the door is open floor')
  assert.equal(grid.traversalCost[at(7.5, 4)], 2, 'the slow stretch costs more')
  assert.equal(grid.traversalCost[at(1, 1)], 1)
})

test('entities carry labels, tags, appearance, bounding boxes and door connections', () => {
  const { entities } = value(buildPreparedMap(testVenue()))
  assert.deepEqual(entities.find((e) => e.id === 'lobby'), {
    id: 'lobby', kind: 'zone', label: 'Lobby', tags: ['indoor'], appearance: { fill: '#DBEAFE' },
    shape: { kind: 'rectangle', x: 0.5, y: 0.5, width: 6, height: 5 },
  })
  assert.deepEqual(entities.find((e) => e.id === 'cafe')?.shape, { kind: 'rectangle', x: 7, y: 0.5, width: 2.5, height: 5 })
  assert.deepEqual(entities.find((e) => e.id === 'cafe_door')?.components, { portal: { connects: ['lobby', 'cafe'], open: true } })
})

test('a door is never resized to fit the grid: off-grid edges fail instead', () => {
  assert.equal(code(edited((spec) => { spec.portals[0]!.rect.height = 0.9 })), 'LAYOUT_CONSTRAINTS_UNSATISFIABLE')
  assert.equal(code(edited((spec) => { spec.portals[0]!.rect.height = 0.875; spec.cellSize = 0.125 })), null, 'a finer grid keeps the measured width')
})

test('broken venues fail with the path of the problem', () => {
  const overlap = edited((spec) => { spec.areas[1]!.rects.push({ x: 6, y: 1, width: 1, height: 1 }) })
  assert.deepEqual(overlap.ok ? null : [overlap.error.code, overlap.error.path], ['LAYOUT_CONSTRAINTS_UNSATISFIABLE', 'venue.areas.1.rects.2'])
  const sealed = edited((spec) => { spec.portals = [] })
  assert.deepEqual(sealed.ok ? null : sealed.error.affectedIds, ['cafe'])
  assert.equal(code(edited((spec) => { spec.portals[0]!.rect = { x: 0.5, y: 5.5, width: 1, height: 0.25 } })), 'LAYOUT_CONSTRAINTS_UNSATISFIABLE')
  assert.equal(code(edited((spec) => { spec.portals[0]!.connects = ['lobby', 'kitchen'] })), 'NOT_FOUND')
  assert.equal(code(edited((spec) => { spec.portals[0]!.id = 'lobby' })), 'INVALID_SCHEMA')
  assert.equal(code(edited((spec) => { spec.areas[0]!.rects[0]!.width = 20 })), 'LAYOUT_CONSTRAINTS_UNSATISFIABLE')
})
