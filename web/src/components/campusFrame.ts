export const TRAIL_COLOR = '#fcf2e5'
export const JOURNEY_GRASS = '#e0e8c6'
export const CAMPUS_COURTYARD = [[490, 726], [620, 668], [742, 680], [820, 723], [900, 785], [932, 845], [820, 905], [675, 904], [540, 861], [484, 807]] as const
export const STORY_MAX_WIDTH = 1240
export function trailWidth(viewportWidth: number) { return viewportWidth < 700 ? 48 : 86 }
export function trailEntryX(viewportWidth: number) {
  return viewportWidth < 700 ? viewportWidth * .85 : viewportWidth / 2 + Math.min(viewportWidth, STORY_MAX_WIDTH) * .22
}
export function campusFrame(width: number, height: number) {
  const scale = width < 700 ? Math.min(width / 1536, height / 624) : Math.max(width / 1536, height / 624)
  const offsetX = (width - 1536 * scale) / 2
  const offsetY = height - 1024 * scale
  // Fit the full campus into its own lower viewport region, even on wide screens.
  const campusScaleY = Math.min(.72, Math.max(.1, (height / scale - 20) / 740))
  const campusY = 1012 - 1010 * campusScaleY
  return { width, height, scale, offsetX, offsetY, campusScaleY, campusY }
}

export function projectCampusPoint(campus: { x: number; y: number; width: number; height: number }, x: number, y: number) {
  const frame = campusFrame(campus.width, campus.height)
  return {
    x: campus.x + frame.offsetX + x * frame.scale,
    y: campus.y + frame.offsetY + (frame.campusY + y * frame.campusScaleY) * frame.scale,
  }
}
