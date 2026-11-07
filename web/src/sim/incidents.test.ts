import assert from 'node:assert/strict'
import test from 'node:test'
import type { EventRecord } from '@crowd-control/contract'
import { formatClock, tickStep, timelineExtent, timelineMarkers, toIncidents } from './incidents.ts'

const event = (id: number, time: number, name: string, source?: string, data?: EventRecord['data']): EventRecord => ({
  id: `e${id}`, tick: time * 10, time, name, ...(source ? { source } : {}), ...(data === undefined ? {} : { data }),
})

test('events map to safety-sign families with their real-world meaning', () => {
  const incidents = toIncidents([
    event(1, 10, 'spawned', 'foyer', { count: 2 }), event(2, 12, 'fall', 'a1'), event(3, 13, 'portal_closed', 'hall_door'),
    event(4, 15, 'recover', 'a1'), event(5, 30, 'alarm'),
  ])
  assert.deepEqual(incidents.map((i) => [i.sign, i.title, i.detail]), [
    ['instruction', 'Arrivals', '2 people · foyer'], ['warning', 'Fall', 'a1'], ['closed', 'Door closed', 'hall_door'],
    ['exit', 'Helped up', 'a1'], ['closed', 'Alarm', null],
  ])
})

test('tick spacing keeps labels apart on narrow tracks', () => {
  assert.equal(tickStep(60, 900), 10)
  assert.equal(tickStep(60, 350), 15)
  assert.equal(tickStep(600, 350), 120)
})

test('runs of departures collapse into one counted row and stay off the timeline', () => {
  const incidents = toIncidents([event(1, 40, 'departed', 'a2'), event(2, 41, 'departed', 'a3'), event(3, 42, 'departed', 'a4'), event(4, 43, 'fall', 'a5'), event(5, 44, 'departed', 'a6')])
  assert.deepEqual(incidents.map((i) => [i.title, i.count, i.startTime, i.time]), [['Left the venue', 3, 40, 42], ['Fall', 1, 43, 43], ['Left the venue', 1, 44, 44]])
  assert.equal(incidents[0]!.detail, '3 people')
  assert.deepEqual(timelineMarkers(incidents).map((i) => i.title), ['Fall'])
})

test('timeline extent always leaves room ahead of the playhead', () => {
  assert.equal(timelineExtent(0), 60)
  assert.equal(timelineExtent(55), 90)
  assert.ok(timelineExtent(299) >= 309)
  assert.equal(formatClock(134.04), '02:14.0')
  assert.equal(formatClock(134.9, false), '02:14')
})
