/**
 * The editor's camera: source pixels → screen pixels as `screen = source × scale + offset`.
 * Kept separate from the simulator camera because a plan is measured in image pixels (often
 * shown below 1:1), not in map units.
 */
export type PlanCamera = { scale: number; offsetX: number; offsetY: number }
export type Area = { left: number; top: number; width: number; height: number }

/** Fits the whole plan into the free area of the screen with a margin, centred. */
export function fitPlan(image: { width: number; height: number }, area: Area, margin = 32): PlanCamera {
  const scale = Math.min((area.width - margin * 2) / image.width, (area.height - margin * 2) / image.height)
  const safe = Math.max(0.01, scale)
  return {
    scale: safe,
    offsetX: area.left + (area.width - image.width * safe) / 2,
    offsetY: area.top + (area.height - image.height * safe) / 2,
  }
}

export function toScreen(camera: PlanCamera, p: { x: number; y: number }) {
  return { x: p.x * camera.scale + camera.offsetX, y: p.y * camera.scale + camera.offsetY }
}

export function toSource(camera: PlanCamera, p: { x: number; y: number }) {
  return { x: (p.x - camera.offsetX) / camera.scale, y: (p.y - camera.offsetY) / camera.scale }
}

/** Zooms by `factor` around a screen point, between half the fitted size and 24× it (or 16 screen px per pixel). */
export function zoomPlan(camera: PlanCamera, fitted: PlanCamera, anchor: { x: number; y: number }, factor: number): PlanCamera {
  const min = fitted.scale * 0.5
  const max = Math.max(fitted.scale * 24, 16)
  const scale = Math.min(max, Math.max(min, camera.scale * factor))
  const fixed = toSource(camera, anchor)
  return { scale, offsetX: anchor.x - fixed.x * scale, offsetY: anchor.y - fixed.y * scale }
}

export function panPlan(camera: PlanCamera, dx: number, dy: number): PlanCamera {
  return { ...camera, offsetX: camera.offsetX + dx, offsetY: camera.offsetY + dy }
}
