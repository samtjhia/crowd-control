import type { Camera, Vec2 } from '@crowd-control/contract'

export const DEFAULT_PIXELS_PER_UNIT = 20
const MIN_PIXELS_PER_UNIT = 2
const MAX_PIXELS_PER_UNIT = 200

/** Technical PRD §12: screen = (world − pan) × pixelsPerUnit. */
export function worldToScreen(camera: Camera, point: Vec2): Vec2 {
  return { x: (point.x - camera.pan.x) * camera.pixelsPerUnit, y: (point.y - camera.pan.y) * camera.pixelsPerUnit }
}

export function screenToWorld(camera: Camera, point: Vec2): Vec2 {
  return { x: point.x / camera.pixelsPerUnit + camera.pan.x, y: point.y / camera.pixelsPerUnit + camera.pan.y }
}

/**
 * Initial camera: the PRD's 20 px/unit when the world fits the available space,
 * otherwise the largest scale that fits. Screen zoom never changes physical units.
 */
export function fitCamera(world: { width: number; height: number }, available: { width: number; height: number }): Camera {
  const fit = Math.min(available.width / world.width, available.height / world.height)
  return { pan: { x: 0, y: 0 }, pixelsPerUnit: clampScale(Math.min(DEFAULT_PIXELS_PER_UNIT, fit)) }
}

/** Zooms by `factor` while keeping the world point under `anchor` (screen px) fixed. */
export function zoomAt(camera: Camera, anchor: Vec2, factor: number): Camera {
  const pixelsPerUnit = clampScale(camera.pixelsPerUnit * factor)
  const fixed = screenToWorld(camera, anchor)
  return { pixelsPerUnit, pan: { x: fixed.x - anchor.x / pixelsPerUnit, y: fixed.y - anchor.y / pixelsPerUnit } }
}

/** Pans by a screen-pixel drag delta. */
export function panBy(camera: Camera, deltaPx: Vec2): Camera {
  return { ...camera, pan: { x: camera.pan.x - deltaPx.x / camera.pixelsPerUnit, y: camera.pan.y - deltaPx.y / camera.pixelsPerUnit } }
}

function clampScale(pixelsPerUnit: number): number {
  return Math.min(MAX_PIXELS_PER_UNIT, Math.max(MIN_PIXELS_PER_UNIT, pixelsPerUnit))
}
