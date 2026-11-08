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
 * Fits the world inside the available screen space, centred, never above
 * `maxPixelsPerUnit` (the PRD's 20 px/unit by default). Screen zoom never changes
 * physical units; it only changes how many pixels one unit takes.
 */
export function fitCamera(
  world: { width: number; height: number },
  available: { width: number; height: number },
  maxPixelsPerUnit = DEFAULT_PIXELS_PER_UNIT,
): Camera {
  const fit = Math.min(available.width / world.width, available.height / world.height)
  const pixelsPerUnit = clampScale(Math.min(maxPixelsPerUnit, fit))
  return {
    pixelsPerUnit,
    pan: { x: (world.width - available.width / pixelsPerUnit) / 2, y: (world.height - available.height / pixelsPerUnit) / 2 },
  }
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
