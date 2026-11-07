export const TRAIL_COLOR = '#f6f2e8'
export const STORY_MAX_WIDTH = 1240
export function trailWidth(viewportWidth: number) { return viewportWidth < 700 ? 48 : 86 }
export function trailEntryX(viewportWidth: number) {
  return viewportWidth < 700 ? viewportWidth * .85 : viewportWidth / 2 + Math.min(viewportWidth, STORY_MAX_WIDTH) * .22
}
export function campusFrame(width: number, height: number) {
  const scale = Math.max(width / 1536, height / 624)
  const offsetX = (width - 1536 * scale) / 2
  const offsetY = height - 1024 * scale
  // Fit the full campus into its own lower viewport region, even on wide screens.
  const campusScaleY = Math.min(.72, Math.max(.1, (height / scale - 20) / 740))
  const campusY = 1012 - 1010 * campusScaleY
  return { width, height, scale, offsetX, offsetY, campusScaleY, campusY }
}
