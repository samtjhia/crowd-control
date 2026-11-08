import assert from 'node:assert/strict'
import test from 'node:test'
import type { Frame } from '@crowd-control/contract'
import { CrowdRenderer } from './renderer.ts'

test('the renderer destroys an existing agent sprite when the worker reports departure', () => {
  let destroyed = 0
  const view = {
    body: { position: { set() {} }, destroy() { destroyed++ } },
    figure: null, badge: null, label: null, state: 'moving', metadata: null,
    pixelsPerUnit: 1, mode: 'markers', last: null, rotates: false,
  }
  const agentViews = new Map([['a1', view]])
  const renderer = Object.assign(Object.create(CrowdRenderer.prototype), {
    atlas: { retain() {} }, agentViews, metadata: new Map(), camera: { pixelsPerUnit: 1, pan: { x: 0, y: 0 } }, drawMode: 'markers',
  })
  const frame: Frame = { streamId: 'run', tick: 1, time: 0.05, topologyVersion: 0, sceneVersion: 1, historyRevision: 0,
    agents: [{ id: 'a1', x: 18.5, y: 2.5, profile: 'person', controller: null, state: 'moving' }] }
  renderer.drawAgents(null, { frame, receivedAt: 100 })
  assert.equal(agentViews.size, 1)
  frame.agents[0]!.state = 'departed'
  renderer.drawAgents(null, { frame, receivedAt: 116 })
  assert.equal(agentViews.size, 0)
  assert.equal(renderer.positions.size, 0)
  assert.equal(destroyed, 1)
  renderer.drawAgents(null, { frame, receivedAt: 132 })
  assert.equal(destroyed, 1, 'retained departure records never recreate sprites')
})

test('crowd stop/start cycles reuse graphics while real annotation changes restyle', () => {
  let restyles = 0
  const view = { body: { position: { set() {} } }, figure: null, badge: null, label: null,
    state: 'moving', metadata: null, pixelsPerUnit: 1, mode: 'markers', last: null, rotates: false }
  const renderer = Object.assign(Object.create(CrowdRenderer.prototype), {
    atlas: { retain() {} }, agentViews: new Map([['a1', view]]), metadata: new Map(),
    camera: { pixelsPerUnit: 1, pan: { x: 0, y: 0 } }, drawMode: 'markers',
    restyleAgent() { restyles++ },
  })
  const frame: Frame = { streamId: 'run', tick: 1, time: .05, topologyVersion: 0, sceneVersion: 1, historyRevision: 0,
    agents: [{ id: 'a1', x: 1, y: 1, profile: 'person', controller: null, state: 'moving' }] }
  for (let tick = 0; tick < 1000; tick++) {
    frame.agents[0]!.state = tick % 2 === 0 ? 'waiting' : 'moving'
    renderer.drawAgents(null, { frame, receivedAt: tick })
  }
  assert.equal(restyles, 0, 'congestion must not regenerate graphics for identical styles')
  frame.agents[0]!.state = 'blocked'
  renderer.drawAgents(null, { frame, receivedAt: 1001 })
  assert.equal(restyles, 1, 'blocked annotation must still appear')
})

test('walking follows engine displacement across goals and waiting states, independent of zoom and paint cadence', (t) => {
  let now = 950
  t.mock.method(performance, 'now', () => now)
  const poses: string[] = []
  const spritePositions: number[][] = []
  const view = { body: { position: { set() {} } }, figure: { visible: true, position: { set(x: number, y: number) { spritePositions.push([x,y]) } }, texture: {} },
    badge: null, label: null, state: 'moving', metadata: null, pixelsPerUnit: 1, mode: 'people',
    fallen: false, rotates: false, pose: 'stand', phase: 0, heading: 0 }
  const renderer = Object.assign(Object.create(CrowdRenderer.prototype), {
    atlas: { retain() {} }, agentViews: new Map([['a1', view]]), metadata: new Map(),
    camera: { pixelsPerUnit: 1, pan: { x: 0, y: 0 } }, drawMode: 'people',
    applyFigure(v: typeof view, pose: string) { poses.push(pose); v.pose = pose },
  })
  const frame: Frame = { streamId: 'run', tick: 10, time: 1, topologyVersion: 0, sceneVersion: 1, historyRevision: 0,
    agents: [{ id: 'a1', x: 1, y: 1, profile: 'person', controller: 'evacuate', state: 'waiting' }] }
  const previous = { frame: structuredClone(frame), receivedAt: 800 }
  previous.frame.tick = 9
  previous.frame.time = 0.9
  frame.time = 1.1
  previous.frame.agents[0]!.controller = 'mingle'
  frame.agents[0]!.x = 1.01 // Less than the old per-paint 0.05 px cutoff.
  const current = { frame, receivedAt: 900 }
  renderer.drawAgents(previous, current)
  assert.ok(view.pose === 'stepA' || view.pose === 'stepB', 'a tick ending in waiting can still contain walking')
  assert.deepEqual(spritePositions.at(-1), [1.005,1])
  now = 1100
  renderer.drawAgents(previous, current)
  assert.equal(new Set(poses).size, 2, 'walking continues across paints even after interpolation reaches its endpoint')
  now = 1200
  renderer.drawAgents(previous, current)
  assert.equal(view.pose, 'stand', 'stale worker frames must not keep walking after pause or a stalled worker')

  now = 1000
  frame.agents[0]!.x = 1
  renderer.camera.pan.x = 10
  renderer.drawAgents(previous, current)
  assert.equal(view.pose, 'stand', 'camera movement must not animate a stationary person')
  frame.agents[0]!.x = 1.01
  renderer.drawAgents({ ...previous, frame: { ...previous.frame, streamId: 'old-run' } }, current)
  assert.equal(view.pose, 'stand', 'rewind and reset jumps must not count as walking')
  previous.frame.time = 0
  frame.time = 0.8
  now = 925
  renderer.drawAgents(previous, current)
  const pose = view.pose
  now = 950
  renderer.drawAgents(previous, current)
  assert.notEqual(view.pose, pose, 'walking cadence must track 8× simulation time, not a slow wall-clock gait')
})
