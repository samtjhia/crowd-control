import type { PreparedMap, Result } from '@crowd-control/contract'
import { fail, ok } from '../result.ts'
import { buildPreparedMap, type MetreRect, type VenueSpec } from './build.ts'

/**
 * The four prepared venues (Role B §2). Measurements are in metres at 0.25 m cells, origin
 * top-left. They are plausible, deliberately simple floor plans written for the demo, not
 * surveys of real buildings. Walls are 0.5 m unless a door opening sits in them.
 */

const rect = (x: number, y: number, width: number, height: number): MetreRect => ({ x, y, width, height })

const OUTSIDE = { fill: '#DCFCE7' }
const INDOOR = { fill: '#DBEAFE' }
const CIRCULATION = { fill: '#F1F5F9' }
const STREET = { fill: '#FEF3C7' }
const FEATURE = { fill: '#FDE68A' }
const SOCIAL = { fill: '#FCE7F3' }
const EXIT = { fill: '#86EFAC' }

/**
 * Hero demo: a narrow, sloped alley about 4 m wide and 45 m long, running uphill from a
 * station plaza (west, downhill) to a busy bar street (east, uphill). The whole alley costs
 * more to walk than level ground, so routes prefer not to climb it without reason.
 */
export const HILLSIDE_ALLEY: VenueSpec = {
  id: 'hillside-alley', revision: 'v1', venue: 'Hillside Alley', floor: 'Street level',
  cellSize: 0.25, width: 74.5, height: 13,
  areas: [
    { id: 'station_plaza', label: 'Station plaza', tags: ['station', 'downhill', 'outside'], appearance: OUTSIDE, rects: [rect(0.5, 0.5, 8, 12)] },
    { id: 'alley', label: 'Alley', tags: ['alley', 'slope'], appearance: STREET, rects: [rect(8.75, 4.5, 45, 4)], cost: 1.25 },
    { id: 'bar_street', label: 'Bar street', tags: ['bars', 'uphill', 'outside'], appearance: SOCIAL, rects: [rect(54, 0.5, 20, 12)] },
  ],
  portals: [
    { id: 'alley_foot', label: 'Alley foot', tags: ['alley-end', 'downhill'], rect: rect(8.5, 4.5, 0.25, 4), connects: ['station_plaza', 'alley'] },
    { id: 'alley_head', label: 'Alley head', tags: ['alley-end', 'uphill'], rect: rect(53.75, 4.5, 0.25, 4), connects: ['alley', 'bar_street'] },
  ],
}

/**
 * Fire drill: a 40 m school corridor with four classrooms either side, each with a 1 m door,
 * and 2 m exits at both ends onto assembly yards.
 */
export const SCHOOL_WING: VenueSpec = (() => {
  const columns = [7, 17, 27, 37]
  const classrooms = columns.flatMap((x, i) => [
    { id: `room_${101 + i}`, label: `Room ${101 + i}`, tags: ['classroom', 'north'], appearance: INDOOR, rects: [rect(x, 0.5, 9.5, 7)] },
    { id: `room_${105 + i}`, label: `Room ${105 + i}`, tags: ['classroom', 'south'], appearance: INDOOR, rects: [rect(x, 11.5, 9.5, 7)] },
  ])
  const doors = columns.flatMap((x, i) => [
    { id: `door_${101 + i}`, label: `Room ${101 + i} door`, tags: ['classroom-door'], rect: rect(x + 7.5, 7.5, 1, 0.5), connects: [`room_${101 + i}`, 'corridor'] as [string, string] },
    { id: `door_${105 + i}`, label: `Room ${105 + i} door`, tags: ['classroom-door'], rect: rect(x + 7.5, 11, 1, 0.5), connects: [`room_${105 + i}`, 'corridor'] as [string, string] },
  ])
  return {
    id: 'school-wing', revision: 'v1', venue: 'Riverside School', floor: 'East wing',
    cellSize: 0.25, width: 54, height: 19,
    areas: [
      { id: 'west_yard', label: 'West yard', tags: ['outside', 'assembly'], appearance: OUTSIDE, rects: [rect(0.5, 0.5, 6, 18)] },
      { id: 'corridor', label: 'Corridor', tags: ['corridor'], appearance: CIRCULATION, rects: [rect(7, 8, 40, 3)] },
      ...classrooms,
      { id: 'east_yard', label: 'East yard', tags: ['outside', 'assembly'], appearance: OUTSIDE, rects: [rect(47.5, 0.5, 6, 18)] },
    ],
    portals: [
      { id: 'west_exit', label: 'West exit', tags: ['exit'], appearance: EXIT, rect: rect(6.5, 8.5, 0.5, 2), connects: ['corridor', 'west_yard'] },
      ...doors,
      { id: 'east_exit', label: 'East exit', tags: ['exit'], appearance: EXIT, rect: rect(47, 8.5, 0.5, 2), connects: ['corridor', 'east_yard'] },
    ],
  }
})()

/**
 * Breadth: a 40 × 25 m standing floor in front of a 20 m stage, a side bar, and a foyer with
 * three 3 m doors that lead to two 3 m street exits.
 */
export const CONCERT_FLOOR: VenueSpec = {
  id: 'concert-floor', revision: 'v1', venue: 'Harbour Concert Hall', floor: 'Main floor',
  cellSize: 0.25, width: 47.5, height: 44.5,
  areas: [
    { id: 'stage', label: 'Stage', tags: ['stage'], appearance: FEATURE, rects: [rect(10.5, 0.5, 20, 6)] },
    { id: 'floor', label: 'Standing floor', tags: ['audience'], appearance: INDOOR, rects: [rect(0.5, 7, 40, 25)] },
    { id: 'bar', label: 'Bar', tags: ['bar'], appearance: SOCIAL, rects: [rect(41, 7, 6, 13)] },
    { id: 'foyer', label: 'Foyer', tags: ['foyer'], appearance: CIRCULATION, rects: [rect(0.5, 33, 40, 6)] },
    { id: 'street', label: 'Street', tags: ['outside'], appearance: OUTSIDE, rects: [rect(0.5, 40, 40, 4)] },
  ],
  portals: [
    { id: 'stage_steps', label: 'Stage steps', tags: ['stage-access'], rect: rect(29.5, 6.5, 1, 0.5), connects: ['stage', 'floor'] },
    { id: 'bar_opening', label: 'Bar opening', rect: rect(40.5, 10, 0.5, 6), connects: ['floor', 'bar'] },
    { id: 'floor_door_west', label: 'West floor door', tags: ['floor-door'], rect: rect(5, 32, 3, 1), connects: ['floor', 'foyer'] },
    { id: 'floor_door_centre', label: 'Centre floor door', tags: ['floor-door'], rect: rect(18.5, 32, 3, 1), connects: ['floor', 'foyer'] },
    { id: 'floor_door_east', label: 'East floor door', tags: ['floor-door'], rect: rect(32, 32, 3, 1), connects: ['floor', 'foyer'] },
    { id: 'street_exit_west', label: 'West street exit', tags: ['exit'], appearance: EXIT, rect: rect(10, 39, 3, 1), connects: ['foyer', 'street'] },
    { id: 'street_exit_east', label: 'East street exit', tags: ['exit'], appearance: EXIT, rect: rect(27, 39, 3, 1), connects: ['foyer', 'street'] },
  ],
}

/**
 * Check-in queue: a lobby off the street, two 1 m check-in desks that take four seconds per
 * person, and a 40 × 30 m hacking hall with 24 tables and two fire exits to the car park.
 * Queue at a desk with `{ kind: "queue", target: { ids: ["checkin_a"] } }`.
 */
export const HACKATHON_HALL: VenueSpec = (() => {
  const tables = [5, 9, 13, 17, 21, 25].flatMap((y) => [19, 28, 37, 46].map((x) => ({ label: 'Table', rect: rect(x, y, 6, 0.75) })))
  return {
    id: 'hackathon-hall', revision: 'v1', venue: 'Hackathon Hall', floor: 'Main hall',
    cellSize: 0.25, width: 62.5, height: 31,
    areas: [
      { id: 'street', label: 'Street', tags: ['outside'], appearance: OUTSIDE, rects: [rect(0.5, 15, 14, 5)] },
      { id: 'lobby', label: 'Lobby', tags: ['lobby'], appearance: CIRCULATION, rects: [rect(0.5, 0.5, 14, 14)] },
      { id: 'hall', label: 'Hacking hall', tags: ['hall'], appearance: INDOOR, rects: [rect(15.5, 0.5, 40, 30)] },
      { id: 'car_park', label: 'Car park', tags: ['outside', 'assembly'], appearance: OUTSIDE, rects: [rect(56, 0.5, 6, 30)] },
    ],
    portals: [
      { id: 'main_entrance', label: 'Main entrance', tags: ['entrance', 'exit'], appearance: EXIT, rect: rect(5, 14.5, 4, 0.5), connects: ['street', 'lobby'] },
      { id: 'checkin_a', label: 'Check-in desk A', tags: ['check-in'], appearance: FEATURE, rect: rect(14.5, 4, 1, 1), connects: ['lobby', 'hall'], traversalTime: 4 },
      { id: 'checkin_b', label: 'Check-in desk B', tags: ['check-in'], appearance: FEATURE, rect: rect(14.5, 10, 1, 1), connects: ['lobby', 'hall'], traversalTime: 4 },
      { id: 'fire_exit_north', label: 'North fire exit', tags: ['exit', 'fire-exit'], appearance: EXIT, rect: rect(55.5, 5, 0.5, 2), connects: ['hall', 'car_park'] },
      { id: 'fire_exit_south', label: 'South fire exit', tags: ['exit', 'fire-exit'], appearance: EXIT, rect: rect(55.5, 24, 0.5, 2), connects: ['hall', 'car_park'] },
    ],
    obstacles: tables,
  }
})()

export const VENUES: readonly VenueSpec[] = [HILLSIDE_ALLEY, SCHOOL_WING, CONCERT_FLOOR, HACKATHON_HALL]

/** Every prepared venue as a reviewed map, ready to pass to `compile` as `assets`. */
export function preparedVenues(): Result<PreparedMap[]> {
  const maps: PreparedMap[] = []
  for (const venue of VENUES) {
    const built = buildPreparedMap(venue)
    if (!built.ok) return fail(built.error.code, `${venue.venue}: ${built.error.message}`, { ...(built.error.path !== undefined && { path: built.error.path }) })
    maps.push(built.value)
  }
  return ok(maps)
}
