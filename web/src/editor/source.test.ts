import assert from 'node:assert/strict'
import test from 'node:test'
import { fitPlan, toScreen, toSource, zoomPlan } from './planView.ts'
import { checkUpload, cropBox, fitWithin, sha256Hex } from './source.ts'

const limits = { maxUploadBytes: 10_000_000 }

test('only PNG and JPG plans up to the upload limit are accepted', () => {
  assert.equal(checkUpload({ type: 'image/png', size: 2_000_000 }, limits), null)
  assert.equal(checkUpload({ type: 'image/jpeg', size: 1 }, limits), null)
  assert.match(checkUpload({ type: 'application/pdf', size: 1000 }, limits)!, /PNG or JPG/)
  assert.match(checkUpload({ type: 'image/png', size: 12_000_000 }, limits)!, /12\.0 MB; the limit is 10 MB/)
  assert.match(checkUpload({ type: 'image/png', size: 0 }, limits)!, /empty/)
})

test('large plans are scaled down to fit the source-pixel limit, keeping their shape', () => {
  assert.deepEqual(fitWithin(800, 600, 1_000_000), { width: 800, height: 600 }, 'small images are never enlarged')
  const big = fitWithin(4000, 3000, 1_000_000)
  assert.ok(big.width * big.height <= 1_000_000)
  assert.ok(big.width * big.height > 990_000, 'and use nearly the whole budget')
  assert.ok(Math.abs(big.width / big.height - 4 / 3) < 0.01)
  const strip = fitWithin(10_000, 101, 1_000_000)
  assert.ok(strip.width * strip.height <= 1_000_000 && strip.height >= 99)
})

test('the content hash is a SHA-256 of the file bytes', async () => {
  const hash = await sha256Hex(new TextEncoder().encode('floor plan').buffer as ArrayBuffer)
  assert.equal(hash.length, 64)
  assert.equal(hash, await sha256Hex(new TextEncoder().encode('floor plan').buffer as ArrayBuffer))
})

test('the plan is fitted into the free screen area and zooms around the pointer', () => {
  const area = { left: 12, top: 76, width: 900, height: 600 }
  const fitted = fitPlan({ width: 1000, height: 500 }, area, 32)
  assert.equal(fitted.scale, (900 - 64) / 1000)
  const centre = toScreen(fitted, { x: 500, y: 250 })
  assert.ok(Math.abs(centre.x - (12 + 450)) < 1e-9 && Math.abs(centre.y - (76 + 300)) < 1e-9, 'centred in the free area')
  const anchor = { x: 300, y: 200 }
  const zoomed = zoomPlan(fitted, fitted, anchor, 2)
  const before = toSource(fitted, anchor), after = toSource(zoomed, anchor)
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9, 'the point under the pointer stays put')
  assert.equal(zoomPlan(fitted, fitted, anchor, 0.01).scale, fitted.scale * 0.5, 'never smaller than half the fitted size')
})

test('a crop box is snapped to whole pixels, kept inside the image, and ignores tiny drags', () => {
  const image = { width: 800, height: 600 }
  assert.deepEqual(cropBox({ x: 700.4, y: 500.6 }, { x: 100.2, y: 50.4 }, image), { x: 100, y: 50, width: 600, height: 451 }, 'dragged in any direction')
  assert.deepEqual(cropBox({ x: -50, y: -50 }, { x: 900, y: 700 }, image), { x: 0, y: 0, width: 800, height: 600 }, 'clamped to the image')
  assert.equal(cropBox({ x: 10, y: 10 }, { x: 20, y: 300 }, image), null, 'a click or a sliver is not a crop')
})
