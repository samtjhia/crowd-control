import assert from 'node:assert/strict'
import test from 'node:test'
import type { Result } from '@crowd-control/contract'
import { chainLayout, designPopulation, type ChainLayout } from '../layout/chain.ts'
import { workedExample } from '../testing.ts'
import { assignGlyphs, cellCounts, rasterize, unreachable, type GlyphGrid } from './rows.ts'

function value<T>(result: Result<T>): T {
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) throw new Error('unreachable')
  return result.value
}

function workedLayout(): ChainLayout {
  const { plan, model } = workedExample()
  if (plan.layout.mode !== 'generate') throw new Error('worked example should be generated')
  return value(chainLayout(plan.layout.spaces, plan.layout.connections, designPopulation(plan), model))
}

function workedGrid(): GlyphGrid {
  const layout = workedLayout()
  return value(rasterize([...layout.rooms, ...layout.portals], layout.worldWidth, layout.worldHeight, layout.cellSize))
}

test('PRD §8: the worked example rasterizes to the exact six-row map and legend', () => {
  const grid = workedGrid()
  assert.deepEqual(grid.rows, [
    '########################',
    '#HHHHHHHHHH#FFFFF#OOOOO#',
    '#HHHHHHHHHHDFFFFFEOOOOO#',
    '#HHHHHHHHHHDFFFFFEOOOOO#',
    '#HHHHHHHHHH#FFFFF#OOOOO#',
    '########################',
  ])
  assert.deepEqual(grid.legend, { H: 'hall', F: 'foyer', O: 'outside', D: 'hall_door', E: 'exit' })
})

test('PRD §14 rasterization: 40 hall cells, 20 foyer cells, two-cell openings', () => {
  const counts = cellCounts(workedGrid())
  assert.deepEqual(Object.fromEntries(counts), { hall: 40, foyer: 20, outside: 20, hall_door: 2, exit: 2 })
})

test('PRD §14: every room and door connects through the open doors', () => {
  assert.deepEqual(unreachable(workedGrid(), 'hall'), [])
})

test('a room cut off by a wall is reported as unreachable', () => {
  const layout = workedLayout()
  // Same rooms, but the exit opening is left out, so `outside` is sealed off.
  const sealed = value(rasterize([...layout.rooms, layout.portals[0]!], layout.worldWidth, layout.worldHeight, layout.cellSize))
  assert.deepEqual(unreachable(sealed, 'hall'), ['outside'])
})

test('glyphs stay unique when IDs share initials, and never use the wall character', () => {
  const glyphs = value(assignGlyphs(['hall', 'house', 'hall_door', 'hut', 'h']))
  const used = [...glyphs.values()]
  assert.equal(new Set(used).size, used.length)
  assert.ok(!used.includes('#'))
  assert.equal(glyphs.get('hall'), 'H')
  assert.equal(glyphs.get('hall_door'), 'D')
})

test('more areas than single characters fail with a resource limit', () => {
  const ids = Array.from({ length: 70 }, (_, i) => `zone_${i}`)
  const result = assignGlyphs(ids)
  assert.equal(result.ok ? null : result.error.code, 'RESOURCE_LIMIT')
})
