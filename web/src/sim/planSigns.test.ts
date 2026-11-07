import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { CompileOutput, EventRecord, Frame, RenderScene } from '@crowd-control/contract'
import { toIncidents } from './incidents.ts'
import { ZONE_SIGN_SECONDS, planSigns } from './planSigns.ts'

const compiled = JSON.parse(readFileSync(new URL('../../../contract/fixtures/compile-output.json', import.meta.url), 'utf8')) as CompileOutput
const scene: RenderScene = { map: compiled.scene.map, entities: [], agents: compiled.scene.agents.map((a) => ({ id: a.id, radius: 0.5, appearance: {} })) }
const event = (id: number, time: number, name: string, source?: string): EventRecord => ({ id: `e${id}`, tick: time * 10, time, name, ...(source ? { source } : {}) })
const frame = (state: 'moving' | 'immobile'): Frame => ({
  streamId: 's', tick: 0, time: 0, topologyVersion: 0, sceneVersion: 1, historyRevision: 0,
  agents: [{ id: 'a1', x: 3, y: 2, profile: 'person', controller: null, state }],
})

test('every event wears its sign on the plan: zones briefly, venue-wide events as standing notices', () => {
  const incidents = toIncidents([event(1, 10, 'spawned', 'foyer'), event(2, 30, 'alarm'), event(3, 31, 'fall', 'a1')])
  const at12 = planSigns(scene, frame('moving'), incidents, 12)
  assert.ok(at12.signs.some((s) => s.kind === 'instruction' && s.x > 12 && s.x < 17), 'arrival sign posted inside the foyer')
  assert.equal(planSigns(scene, frame('moving'), incidents, 10 + ZONE_SIGN_SECONDS + 1).signs.filter((s) => s.kind === 'instruction').length, 0)
  const at40 = planSigns(scene, frame('immobile'), incidents, 40)
  assert.deepEqual(at40.notices.map((n) => [n.kind, n.title, n.time]), [['closed', 'Alarm', 30]])
  assert.equal(at40.signs.filter((s) => s.kind === 'warning').length, 1, 'fall shown once, by live state')
  assert.equal(at40.signs.find((s) => s.kind === 'warning')?.lift, 0.5)
})

test('exit doors are signed green, and red when closed', () => {
  assert.deepEqual(planSigns(scene, null, [], 0).signs.map((s) => [s.id, s.kind]), [['portal-exit', 'exit']])
  const closed = { ...scene, map: { ...scene.map, portals: scene.map.portals.map((p) => ({ ...p, open: false })) } }
  assert.deepEqual(planSigns(closed, null, [], 0).signs.map((s) => [s.id, s.kind]), [['portal-hall_door', 'closed'], ['portal-exit', 'closed']])
})
