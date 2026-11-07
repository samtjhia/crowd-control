import assert from 'node:assert/strict'
import test from 'node:test'
import { CompileOutputSchema, type CompileOutput, type Result } from '@crowd-control/contract'
import { compile } from '../compile.ts'
import { lookupExample, workedExample } from '../testing.ts'

function value<T>(result: Result<T>): T {
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) throw new Error('unreachable')
  return result.value
}
const code = (result: Result<unknown>) => (result.ok ? null : result.error.code)

test('a lookup plan compiles to a grid map with room and door records', () => {
  const output: CompileOutput = value(compile(lookupExample()))
  assert.equal(CompileOutputSchema.safeParse(output).success, true)
  const { map } = output.scene
  assert.ok('grid' in map)
  assert.deepEqual([map.width, map.height, map.cellSize, map.units], [10, 6, 0.25, 'm'])
  assert.deepEqual(map.source, { mode: 'lookup', assetId: 'test-lobby', revision: 'r1', venue: 'Test Lobby', floor: 'Ground' })
  assert.deepEqual(map.rooms.map(({ id, x, y, width, height }) => [id, x, y, width, height]), [['lobby', 0.5, 0.5, 6, 5], ['cafe', 7, 0.5, 2.5, 5]])
  assert.deepEqual(map.rooms[0]!.label, 'Lobby')
  assert.deepEqual(map.portals, [{ id: 'cafe_door', x: 6.5, y: 1, width: 0.5, height: 1, connects: ['lobby', 'cafe'], open: true, label: 'Cafe door', tags: ['door'] }])
  assert.equal(map.entities, undefined, 'the engine loads rooms and portals, not general entities')
  assert.deepEqual(output.inventory.map((item) => item.id).slice(0, 3), ['lobby', 'cafe', 'cafe_door'])
  assert.deepEqual(Object.keys(output.scene.controllers), ['wander-lobby', 'reach-cafe'])
})

test('engine rules hold: every zone and door cell lies inside its record', () => {
  const { map } = value(compile(lookupExample())).scene
  if (!('grid' in map)) throw new Error('expected a grid map')
  const { grid } = map
  for (let i = 0; i < grid.zoneIndex.length; i++) {
    const x = (i % grid.width) * grid.cellSize, y = Math.floor(i / grid.width) * grid.cellSize
    const inside = (r: { x: number; y: number; width: number; height: number }) => x >= r.x && y >= r.y && x + grid.cellSize <= r.x + r.width && y + grid.cellSize <= r.y + r.height
    const zone = grid.zoneIds[grid.zoneIndex[i]!]
    if (zone) assert.ok(inside(map.rooms.find((room) => room.id === zone)!), `zone cell ${i}`)
    const portal = grid.portalIds[grid.portalIndex[i]!]
    if (portal) assert.ok(inside(map.portals.find((p) => p.id === portal)!), `portal cell ${i}`)
  }
})

test('the starting crowd sits on a 1 m lattice inside the measured lobby, clear of walls', () => {
  const { agents, map } = value(compile(lookupExample(30))).scene
  if (!('grid' in map)) throw new Error('expected a grid map')
  assert.equal(agents.length, 30)
  assert.deepEqual(agents.slice(0, 2).map(({ x, y }) => [x, y]), [[0.75, 0.75], [1.75, 0.75]])
  for (const agent of agents) {
    for (const [dx, dy] of [[-0.25, -0.25], [0.2499, -0.25], [-0.25, 0.2499], [0.2499, 0.2499]] as const) {
      const i: number = Math.floor((agent.y + dy) / 0.25) * map.grid.width + Math.floor((agent.x + dx) / 0.25)
      assert.equal(map.grid.blocked[i], 0)
      assert.equal(map.grid.zoneIds[map.grid.zoneIndex[i]!], 'lobby')
    }
  }
})

test('people spawned in an L-shaped zone stay out of its missing corner', () => {
  const input = lookupExample()
  const spawn = input.plan.initialOperations[0]!
  if (spawn.op !== 'spawn') throw new Error('fixture changed')
  spawn.placement = { inside: { ids: ['cafe'] } }
  spawn.count = 5
  input.plan.initialOperations[1] = { op: 'assign_goal', targets: { tags: ['guest'] }, goal: { kind: 'wander', inside: { ids: ['cafe'] } } }
  const { agents } = value(compile(input)).scene
  assert.ok(agents.every((agent) => agent.x < 8 || agent.y < 2.5), JSON.stringify(agents.map(({ x, y }) => [x, y])))
})

test('a measured venue is never resized: too many people fail with NO_WALKABLE_SPACE', () => {
  assert.equal(code(compile(lookupExample(31))), 'NO_WALKABLE_SPACE')
})

test('venue lookup ignores case and spacing, and reports what exists when nothing matches', () => {
  const loose = lookupExample()
  loose.plan.layout = { mode: 'lookup', venue: ' test lobby ', floor: 'GROUND' }
  assert.equal(compile(loose).ok, true)
  const missing = lookupExample()
  missing.plan.layout = { mode: 'lookup', venue: 'Town Hall', floor: 'Ground' }
  const result = compile(missing)
  assert.equal(code(result), 'MAP_NOT_FOUND')
  assert.match(result.ok ? '' : result.error.message, /available: Test Lobby \(Ground\)/)
})

test('a metric venue with a model-unit preset is refused rather than mis-scaled', () => {
  assert.equal(code(compile({ ...lookupExample(), model: workedExample().model })), 'UNSUPPORTED_CAPABILITY')
})

test('map objects people can use reach the compiled map; barriers still fail clearly', () => {
  const input = lookupExample()
  const desk = { id: 'desk_1', kind: 'object' as const, components: { interaction: { duration: 4, slots: 1 } }, shape: { kind: 'rectangle' as const, x: 1, y: 1, width: 1, height: 0.5 } }
  input.assets[0]!.entities.push(desk)
  const result = compile(input)
  assert.deepEqual(result.ok ? result.value.scene.map.entities : result.error, [desk])
  input.assets[0]!.entities.push({ id: 'rail', kind: 'barrier', shape: { kind: 'rectangle', x: 1, y: 2, width: 1, height: 0.5 } })
  const refused = compile(input)
  assert.deepEqual(refused.ok ? null : [refused.error.code, refused.error.affectedIds], ['UNSUPPORTED_CAPABILITY', ['rail']])
})

/** The test venue as if saved by the floor-plan editor: an upload source with or without a scale. */
function uploadExample(scaled: boolean) {
  const input = lookupExample()
  const asset = input.assets[0]!
  input.assets = [{
    ...asset,
    source: {
      mode: 'upload', assetId: 'upload-abc123', revision: 'r1', page: 1,
      calibration: scaled ? { pointsPx: [[0, 0], [100, 0]], distanceMetres: 4, metresPerPixel: 0.04 } : null,
      sourceToWorld: [0.04, 0, 0, 0.04, 0, 0],
    },
  }]
  input.plan.layout = { mode: 'upload', assetId: 'upload-abc123', page: 1 }
  return input
}

test('a floor plan saved by the editor compiles like a prepared venue, and keeps its upload source', () => {
  const output = value(compile(uploadExample(true)))
  assert.equal(output.scene.map.source?.mode, 'upload')
  assert.deepEqual(output.scene.map.rooms.map((room) => room.id), ['lobby', 'cafe'])
  assert.equal(output.scene.agents.length, 10)
})

test('an unscaled floor plan cannot be run in metres', () => {
  assert.equal(code(compile(uploadExample(false))), 'SCALE_CALIBRATION_REQUIRED')
  const wrongPage = uploadExample(true)
  wrongPage.plan.layout = { mode: 'upload', assetId: 'upload-abc123', page: 2 }
  assert.equal(code(compile(wrongPage)), 'MAP_NOT_FOUND')
})

test('room capacities match what placement allows, so a crowd of that size always fits', async () => {
  const { spawnCapacities } = await import('./capacity.ts')
  const input = lookupExample()
  const capacities = spawnCapacities(input.assets[0]!, input.model)
  assert.equal(capacities.lobby, 30, 'the 6 × 5 m lobby holds 30 at 1 m spacing')
  assert.ok(capacities.cafe! > 0)
  assert.equal(code(compile(lookupExample(capacities.lobby))), null, 'exactly the capacity fits')
  assert.equal(code(compile(lookupExample(capacities.lobby! + 1))), 'NO_WALKABLE_SPACE', 'one more does not')
})
