import assert from 'node:assert/strict'
import test from 'node:test'
import { CompileOutputSchema, PreparedMapSchema, type CompiledMap, type Goal, type PreparedMap, type Result } from '@crowd-control/contract'
import { compile } from '../compile.ts'
import { capabilities, limits, metricModel } from '../testing.ts'
import { buildPreparedMap } from './build.ts'
import { CONCERT_FLOOR, HACKATHON_HALL, HILLSIDE_ALLEY, preparedVenues, SCHOOL_WING, VENUES } from './catalog.ts'

function value<T>(result: Result<T>): T {
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) throw new Error('unreachable')
  return result.value
}

const maps = value(preparedVenues())
const map = (id: string): PreparedMap => maps.find((m) => m.id === id)!
const cells = (m: PreparedMap, id: string) => m.grid.zoneIndex.filter((i) => i === m.grid.zoneIds.indexOf(id)).length
const portal = (m: PreparedMap, id: string) => m.entities.find((e) => e.id === id)!

/** Compiles "N people in `zone` do `goal`; at 30 s an alarm sends everyone to the exits". */
function crowd(venue: PreparedMap, zone: string, count: number, goal: Goal) {
  if (venue.source.mode !== 'lookup') throw new Error('expected a lookup venue')
  return compile({
    plan: {
      schemaVersion: 1, simulationId: `${venue.id}-demo`, seed: 42,
      layout: { mode: 'lookup', venue: venue.source.venue, floor: venue.source.floor },
      initialOperations: [
        { op: 'spawn', template: { kind: 'agent', tags: ['crowd'] }, count, placement: { inside: { ids: [zone] } } },
        { op: 'assign_goal', targets: { tags: ['crowd'] }, goal },
      ],
      timeline: [{ op: 'schedule', id: 'alarm', at: 30, operations: [{ op: 'emit', event: { name: 'alarm' } }] }],
      rules: [{ op: 'define_rule', id: 'evacuate', when: { kind: 'event', name: 'alarm' }, once: true, operations: [{ op: 'assign_goal', targets: { tags: ['crowd'] }, goal: { kind: 'reach', target: { tags: ['outside'] }, selection: 'lowest-cost' } }] }],
    },
    assets: maps, model: metricModel, capabilities, limits,
  })
}

/** Conrad's engine requires every zone and door cell to lie inside its room or portal record. */
function assertEngineShape(m: CompiledMap) {
  if (!('grid' in m)) throw new Error('expected a grid map')
  const { grid } = m
  for (let i = 0; i < grid.zoneIndex.length; i++) {
    const x = (i % grid.width) * grid.cellSize, y = Math.floor(i / grid.width) * grid.cellSize
    const inside = (r: { x: number; y: number; width: number; height: number }) => x >= r.x && y >= r.y && x + grid.cellSize <= r.x + r.width && y + grid.cellSize <= r.y + r.height
    const zone = grid.zoneIds[grid.zoneIndex[i]!]
    if (zone) assert.ok(inside(m.rooms.find((r) => r.id === zone)!), `${zone} cell ${i}`)
    const door = grid.portalIds[grid.portalIndex[i]!]
    if (door) assert.ok(inside(m.portals.find((p) => p.id === door)!), `${door} cell ${i}`)
  }
}

test('all four venues build into reviewed, metre-scaled maps within the cell budget', () => {
  assert.deepEqual(VENUES.map((v) => v.id), ['hillside-alley', 'school-wing', 'concert-floor', 'hackathon-hall'])
  for (const m of maps) {
    assert.equal(PreparedMapSchema.safeParse(m).success, true, m.id)
    assert.equal(m.grid.units, 'm')
    assert.equal(m.grid.cellSize, 0.25)
    assert.ok(m.grid.width * m.grid.height <= limits.maxGridCells)
  }
})

test('alley: 4 m wide and 45 m long, uphill from the station to the bar street', () => {
  const alley = map(HILLSIDE_ALLEY.id)
  assert.equal(cells(alley, 'alley'), (45 / 0.25) * (4 / 0.25))
  const at = (x: number, y: number) => Math.floor(y / 0.25) * alley.grid.width + Math.floor(x / 0.25)
  assert.equal(alley.grid.traversalCost[at(30, 6)], 1.25, 'the slope costs more to walk')
  assert.equal(alley.grid.traversalCost[at(4, 6)], 1, 'the plaza is level')
  const tags = (id: string) => alley.entities.find((e) => e.id === id)!.tags
  assert.ok(tags('station_plaza')!.includes('downhill') && tags('bar_street')!.includes('uphill'))
})

test('school wing: eight classrooms off one corridor, and more than one exit', () => {
  const school = map(SCHOOL_WING.id)
  const classrooms = school.entities.filter((e) => e.kind === 'zone' && e.tags?.includes('classroom'))
  assert.equal(classrooms.length, 8)
  for (const room of classrooms) {
    assert.ok(school.entities.some((e) => e.kind === 'portal' && e.components?.portal?.connects.includes(room.id) && e.components.portal.connects.includes('corridor')), room.id)
  }
  assert.deepEqual(school.entities.filter((e) => e.tags?.includes('exit')).map((e) => e.id), ['west_exit', 'east_exit'])
})

test('concert floor: a stage, a 40 × 25 m standing floor, a bar and two street exits', () => {
  const concert = map(CONCERT_FLOOR.id)
  assert.equal(cells(concert, 'stage'), 80 * 24)
  assert.equal(cells(concert, 'floor'), 160 * 100)
  assert.equal(concert.entities.filter((e) => e.tags?.includes('exit')).length, 2)
})

test('hackathon hall: two four-second check-in desks, and 24 tables and a snack table people use and walk around', () => {
  const hall = map(HACKATHON_HALL.id)
  for (const id of ['checkin_a', 'checkin_b']) assert.deepEqual(portal(hall, id).components?.portal, { connects: ['lobby', 'hall'], open: true, traversalTime: 4 })
  assert.equal(cells(hall, 'hall'), 160 * 120 - 24 * 24 * 3 - 16 * 4, 'table cells are not floor')
  const objects = hall.entities.filter((e) => e.kind === 'object')
  assert.equal(objects.length, 25)
  assert.deepEqual(portal(hall, 'table_1').components, { interaction: { duration: 120, slots: 6 } })
  assert.deepEqual(portal(hall, 'snacks').components, { interaction: { duration: 8, slots: 3 } })
})

test('objects must stand on floor and keep doorways clear', () => {
  const base = { ...HACKATHON_HALL, objects: [] }
  const outside = buildPreparedMap({ ...base, objects: [{ id: 'kiosk', rect: { x: 0, y: 0, width: 0.5, height: 0.5 } }] })
  assert.equal(outside.ok ? null : outside.error.code, 'LAYOUT_CONSTRAINTS_UNSATISFIABLE')
  const door = buildPreparedMap({ ...base, objects: [{ id: 'kiosk', rect: { x: 5, y: 14.5, width: 1, height: 0.5 } }] })
  assert.match(door.ok ? '' : door.error.message, /blocks a doorway/)
  const twice = buildPreparedMap({ ...base, objects: [{ id: 'lobby', rect: { x: 2, y: 2, width: 1, height: 1 } }] })
  assert.equal(twice.ok ? null : twice.error.code, 'INVALID_SCHEMA')
})

test('every venue compiles a realistic crowd plan that the engine can load', () => {
  const plans = [
    crowd(map(HILLSIDE_ALLEY.id), 'bar_street', 200, { kind: 'reach', target: { ids: ['station_plaza'] } }),
    crowd(map(SCHOOL_WING.id), 'room_101', 30, { kind: 'wait', duration: 20, inside: { ids: ['room_101'] } }),
    crowd(map(CONCERT_FLOOR.id), 'floor', 600, { kind: 'wander', inside: { ids: ['floor'] } }),
    crowd(map(HACKATHON_HALL.id), 'lobby', 60, { kind: 'queue', target: { ids: ['checkin_a'] } }),
    crowd(map(HACKATHON_HALL.id), 'hall', 60, { kind: 'sequence', goals: [{ kind: 'interact', target: { ids: ['snacks'] } }, { kind: 'reach', target: { tags: ['table'] }, selection: 'nearest' }] }),
    crowd(map(CONCERT_FLOOR.id), 'bar', 30, { kind: 'interact', target: { ids: ['bar_counter'] } }),
  ]
  for (const result of plans) {
    const output = value(result)
    assert.equal(CompileOutputSchema.safeParse(output).success, true, output.scene.simulationId)
    assertEngineShape(output.scene.map)
    assert.ok(output.scene.agents.length >= 30)
  }
  const [alley, , , hackathon] = plans.map((result) => value(result).scene)
  assert.deepEqual(alley!.controllers['reach-station_plaza'], { kind: 'reach', targetZone: 'station_plaza' })
  assert.deepEqual(hackathon!.controllers['queue-checkin_a'], { kind: 'queue', targetEntityId: 'checkin_a' })
  const evacuate = alley!.rules[0]
  assert.ok(evacuate && 'controller' in evacuate)
  assert.deepEqual(alley!.controllers[evacuate.controller], { kind: 'reach', targetIds: ['station_plaza', 'bar_street'], selection: 'lowest-cost' })
})

test('measured venues refuse crowds that do not fit instead of growing', () => {
  const result = crowd(map(SCHOOL_WING.id), 'room_101', 100, { kind: 'wander', inside: { ids: ['room_101'] } })
  assert.equal(result.ok ? null : result.error.code, 'NO_WALKABLE_SPACE')
})
