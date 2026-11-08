import assert from 'node:assert/strict'
import test from 'node:test'
import { venueAssets } from '../sim/scenario.ts'
import { seedFromSaved } from './fromSaved.ts'
import { checkAndBuild } from './save.ts'

/**
 * Reopening a saved plan and saving it again, untouched, gives the same plan: same ID, rooms,
 * doors, scale and walkable cells.
 */
test('a saved plan reopened for editing and saved again comes back the same', () => {
  for (const map of venueAssets()) {
    const venue = { name: map.id, floor: 'Ground', savedAt: '2026-11-07T00:00:00.000Z', map }
    const k = 3
    const seed = seedFromSaved(venue, k)
    const { grid } = map
    assert.ok(seed.scale, `${map.id} keeps its scale`)
    const metresPerPixel = seed.scale.metres / (seed.scale.b.x - seed.scale.a.x)
    const rebuilt = checkAndBuild({
      source: { assetId: map.id, revision: 'draft', page: 1, mimeType: 'image/png', pixelWidth: seed.width, pixelHeight: seed.height, contentHash: map.id },
      width: seed.width, height: seed.height, kinds: seed.kinds, furnitureBlocks: true, labels: seed.labels, rooms: seed.rooms, doors: seed.doors,
      calibration: { pointsPx: [[seed.scale.a.x, seed.scale.a.y], [seed.scale.b.x, seed.scale.b.y]], distanceMetres: seed.scale.metres, metresPerPixel },
      name: venue.name, floor: venue.floor, revision: 'r1',
    })
    assert.ok(rebuilt.map, `${map.id}: ${rebuilt.problems.map((p) => p.message).join('; ')}`)
    assert.equal(rebuilt.map.id, map.id, 'saving replaces the same plan')
    assert.deepEqual([rebuilt.grid.width, rebuilt.grid.height, rebuilt.grid.cellSize], [grid.width, grid.height, grid.cellSize])
    const zones = (m: typeof map) => m.entities.filter((e) => e.kind === 'zone').map((e) => e.label).sort()
    assert.deepEqual(zones(rebuilt.map), zones(map), `${map.id} rooms`)
    assert.equal(rebuilt.map.entities.filter((e) => e.kind === 'portal').length, map.entities.filter((e) => e.kind === 'portal').length, `${map.id} doors`)
    const open = (g: typeof grid) => g.blocked.filter((b) => b === 0).length
    assert.ok(Math.abs(open(rebuilt.grid) - open(grid)) <= open(grid) * 0.02, `${map.id} walkable cells ${open(rebuilt.grid)} vs ${open(grid)}`)
  }
})
