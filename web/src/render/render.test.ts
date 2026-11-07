import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { CompileOutput, Frame, GridData } from '@crowd-control/contract'
import { GROUP_PALETTE, groupColor, markerShape, resolveAgentStyle, stableIndex, stateAnnotation } from './agentStyle.ts'
import { fitCamera, panBy, screenToWorld, worldToScreen, zoomAt } from './camera.ts'
import { displayPositions } from './interpolate.ts'
import { COLORS, layoutMap } from './mapLayout.ts'

const compiled = JSON.parse(readFileSync(new URL('../../../contract/fixtures/compile-output.json', import.meta.url), 'utf8')) as CompileOutput
const scene = compiled.scene
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`)

test('PRD §14 renderer acceptance: 480×120 viewport, a1 triangle centred at (30,30) with a 10 px radius', () => {
  const layout = layoutMap(scene.map)
  const camera = fitCamera({ width: layout.worldWidth, height: layout.worldHeight }, { width: 480, height: 120 })
  assert.equal(camera.pixelsPerUnit, 20)
  assert.deepEqual(camera.pan, { x: 0, y: 0 })
  assert.deepEqual([layout.worldWidth * camera.pixelsPerUnit, layout.worldHeight * camera.pixelsPerUnit], [480, 120])

  const a1 = scene.agents[0]!
  const centre = worldToScreen(camera, { x: a1.x, y: a1.y })
  assert.deepEqual(centre, { x: 30, y: 30 })
  const radiusPx = scene.profiles.person!.radius * camera.pixelsPerUnit
  assert.equal(radiusPx, 10)
  const marker = markerShape(resolveAgentStyle({ ...scene.profiles.person!.appearance, ...a1.appearance }, 'moving'), radiusPx)
  assert.equal(marker.kind, 'triangle')
  if (marker.kind !== 'triangle') return
  const [x1, y1, x2, y2, x3, y3] = marker.points
  close((x1 + x2 + x3) / 3, 0)
  close((y1 + y2 + y3) / 3, 0)
  for (let i = 0; i < 6; i += 2) close(Math.hypot(marker.points[i]!, marker.points[i + 1]!), 10)
})

test('late arrivals render as purple squares and every marker fits inside the body', () => {
  const late = scene.jobs[0]!.operations[0]!
  assert.ok('appearance' in late && late.appearance)
  const style = resolveAgentStyle({ ...scene.profiles.person!.appearance, ...late.appearance }, 'moving')
  assert.deepEqual([style.symbol, style.fill], ['square', '#7C3AED'])
  for (const symbol of ['circle', 'square', 'triangle'] as const) {
    for (const pose of ['upright', 'fallen'] as const) {
      const marker = markerShape({ symbol, pose }, 10)
      const extent = marker.kind === 'circle' ? marker.radius
        : marker.kind === 'square' ? Math.hypot(marker.side / 2, marker.side / 2)
        : marker.kind === 'ellipse' ? Math.max(marker.radiusX, marker.radiusY)
        : Math.max(...[0, 2, 4].map((i) => Math.hypot(marker.points[i]!, marker.points[i + 1]!)))
      assert.ok(extent <= 10 + 1e-9, `${symbol}/${pose} exceeds the body radius`)
    }
  }
})

test('state never relies on colour alone and never replaces an explicit group fill', () => {
  for (const state of ['blocked', 'failed', 'queueing', 'interacting', 'departed', 'immobile'] as const) {
    assert.ok(stateAnnotation(state, 'upright').badge, `${state} needs a text badge`)
  }
  assert.equal(stateAnnotation('immobile', 'fallen').badge, 'down')
  assert.equal(stateAnnotation('moving', 'fallen').badge, 'down', 'a pose-only fall is still marked')
  assert.equal(stateAnnotation('moving', 'upright').badge, null)
  assert.equal(resolveAgentStyle({ fill: '#7C3AED' }, 'blocked').fill, '#7C3AED')
  assert.equal(resolveAgentStyle({ fill: '#7C3AED' }, 'departed').fill, '#7C3AED')
  assert.equal(resolveAgentStyle({}, 'departed').fill, '#94A3B8')
  assert.ok(resolveAgentStyle({}, 'departed').opacity < 1)
})

test('worked-example map layout: 24×6 grid, 40 hall cells, walls, labelled zones and portal rectangles', () => {
  const layout = layoutMap(scene.map)
  assert.deepEqual([layout.columns, layout.rows], [24, 6])
  const cells = (fill: string) => layout.runs.filter((r) => r.fill === fill).reduce((sum, r) => sum + r.end - r.start, 0)
  assert.equal(cells('#DBEAFE'), 40)
  assert.equal(cells('#FEF3C7'), 20)
  assert.equal(layout.runs.filter((r) => r.kind === 'wall').reduce((sum, r) => sum + r.end - r.start, 0), 24 * 6 - 40 - 20 - 20 - 4)
  assert.equal(cells(COLORS.floor), 4, 'door cells are plain floor; the portal layer draws the opening')
  assert.deepEqual(layout.portals.map((p) => [p.id, p.x, p.y, p.width, p.height, p.open]), [['hall_door', 11, 2, 1, 2, true], ['exit', 17, 2, 1, 2, true]])
  assert.deepEqual(layout.labels.map((l) => l.text), ['Hall', 'Foyer', 'Outside'])
})

test('grid maps are laid out from cell membership, independent of how width is counted', () => {
  const grid: GridData = {
    width: 4, height: 2, cellSize: 0.5, units: 'm',
    blocked: [1, 0, 0, 1, 1, 0, 0, 1], traversalCost: [1, 1, 1, 1, 1, 1, 1, 1],
    zoneIndex: [0, 1, 1, 0, 0, 1, 0, 0], portalIndex: [0, 0, 0, 0, 0, 0, 1, 0],
    zoneIds: [null, 'alley'], portalIds: [null, 'gate'],
  }
  const layout = layoutMap({ width: 2, height: 1, cellSize: 0.5, units: 'm', rooms: [], portals: [], grid })
  assert.deepEqual([layout.columns, layout.rows, layout.worldWidth, layout.worldHeight], [4, 2, 2, 1])
  assert.deepEqual(layout.runs.filter((r) => r.kind === 'portal').map((r) => [r.row, r.start, r.portalId]), [[1, 2, 'gate']])
})

test('group colours move onto the landing palette without merging groups', () => {
  assert.equal(groupColor('#2563EB'), GROUP_PALETTE.blue)
  assert.equal(groupColor('#7C3AED'), GROUP_PALETTE.rose)
  assert.equal(groupColor('#16A34A'), GROUP_PALETTE.green)
  assert.equal(groupColor('#F59E0B'), GROUP_PALETTE.amber)
  assert.equal(groupColor(undefined), GROUP_PALETTE.green)
  assert.equal(groupColor('#94A3B8'), GROUP_PALETTE.green, 'greys have no group hue')
  assert.equal(stableIndex('a1', 4), stableIndex('a1', 4))
  assert.ok(stableIndex('a2', 4) >= 0 && stableIndex('a2', 4) < 4)
})

test('camera maps world to screen and keeps the anchor fixed while zooming', () => {
  const camera = { pan: { x: 0, y: 0 }, pixelsPerUnit: 20 }
  const zoomed = zoomAt(camera, { x: 100, y: 40 }, 2)
  assert.equal(zoomed.pixelsPerUnit, 40)
  const anchor = worldToScreen(zoomed, screenToWorld(camera, { x: 100, y: 40 }))
  close(anchor.x, 100)
  close(anchor.y, 40)
  assert.deepEqual(panBy(camera, { x: 20, y: -40 }).pan, { x: -1, y: 2 })
  assert.equal(fitCamera({ width: 4, height: 45 }, { width: 800, height: 450 }).pixelsPerUnit, 10, 'tall maps shrink to fit')
  const centred = fitCamera({ width: 24, height: 6 }, { width: 1000, height: 400 }, 64)
  assert.equal(centred.pixelsPerUnit, 1000 / 24, 'small maps scale up to the panel, capped')
  close(worldToScreen(centred, { x: 12, y: 3 }).x, 500)
  close(worldToScreen(centred, { x: 12, y: 3 }).y, 200)
})

test('display positions interpolate within a stream and never across a reset', () => {
  const frame = (streamId: string, tick: number, x: number): Frame => ({
    streamId, tick, time: tick / 10, topologyVersion: 0, sceneVersion: 1, historyRevision: 0,
    agents: [{ id: 'a1', x, y: 0, profile: 'person', controller: null, state: 'moving' }],
  })
  const previous = { frame: frame('s1', 1, 0), receivedAt: 100 }
  const current = { frame: frame('s1', 2, 1), receivedAt: 116 }
  close(displayPositions(previous, current, 124).get('a1')!.x, 0.5)
  assert.equal(displayPositions(previous, current, 200).get('a1')!.x, 1)
  assert.equal(displayPositions({ ...previous, frame: frame('s0', 1, 0) }, current, 124).get('a1')!.x, 1)
})
