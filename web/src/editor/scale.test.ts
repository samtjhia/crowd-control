import assert from 'node:assert/strict'
import test from 'node:test'
import { CalibrationSchema } from '@crowd-control/contract'
import { FEET_TO_METRES, calibrate, formatMetres, planSize, scaleBar, scaleWarning } from './scale.ts'

test('PRD §7 example: 250 pixels for ten metres is 0.04 m per pixel, and the 500 × 300 px gym is 20 × 12 m', () => {
  const result = calibrate({ x: 100, y: 100 }, { x: 350, y: 100 }, 10, 'm')
  assert.ok(result.ok)
  assert.equal(result.value.metresPerPixel, 0.04)
  assert.deepEqual(result.value.pointsPx, [[100, 100], [350, 100]])
  assert.equal(CalibrationSchema.safeParse(result.value).success, true, 'a valid contract calibration')
  const gym = planSize({ width: 500, height: 300 }, result.value.metresPerPixel)
  assert.ok(Math.abs(gym.width - 20) < 1e-9 && Math.abs(gym.height - 12) < 1e-9)
})

test('feet are converted to metres', () => {
  const result = calibrate({ x: 0, y: 0 }, { x: 0, y: 100 }, 10, 'ft')
  assert.ok(result.ok)
  assert.equal(result.value.distanceMetres, 10 * FEET_TO_METRES)
})

test('missing points, a tiny line or a bad distance explain what to do', () => {
  const reason = (r: ReturnType<typeof calibrate>) => (r.ok ? '' : r.reason)
  assert.match(reason(calibrate(null, null, 5, 'm')), /Drag a line/)
  assert.match(reason(calibrate({ x: 0, y: 0 }, { x: 3, y: 4 }, 5, 'm')), /too short/)
  assert.match(reason(calibrate({ x: 0, y: 0 }, { x: 300, y: 0 }, Number.NaN, 'm')), /Type the real distance/)
  assert.match(reason(calibrate({ x: 0, y: 0 }, { x: 300, y: 0 }, -2, 'm')), /Type the real distance/)
})

test('implausible scales get a warning, ordinary ones do not', () => {
  const image = { width: 1000, height: 600 }
  assert.equal(scaleWarning(image, 0.04), null, 'a 40 × 24 m building')
  assert.match(scaleWarning(image, 0.004)!, /smaller than a room/, 'probably cm typed as m')
  assert.match(scaleWarning(image, 3)!, /km across/)
  assert.match(scaleWarning({ width: 200, height: 100 }, 0.5)!, /coarser than the 0.25 m/)
})

test('lengths read naturally, and the scale bar is a round number', () => {
  assert.equal(formatMetres(0.9), '90 cm')
  assert.equal(formatMetres(4.25), '4.3 m')
  assert.equal(formatMetres(42.31), '42.3 m')
  assert.equal(formatMetres(1500), '1.5 km')
  const bar = scaleBar(0.04)
  assert.equal(bar.metres, 5, 'about 120 px at 4 cm per screen pixel is 4.8 m, shown as a 5 m bar')
  assert.equal(bar.pixels, 125)
})
