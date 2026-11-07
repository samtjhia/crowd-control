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
