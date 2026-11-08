import type { Limits } from '@crowd-control/contract'

/**
 * Upload rules for floor-plan images (Technical PRD §7 step 1). These checks are pure so they
 * can be tested; decoding the image happens in loadPlan.ts, which needs a browser.
 */

export const ACCEPTED_TYPES = ['image/png', 'image/jpeg'] as const
export type AcceptedType = (typeof ACCEPTED_TYPES)[number]

/** Why a file can't be used, or null if it can. */
export function checkUpload(file: { type: string; size: number }, limits: Pick<Limits, 'maxUploadBytes'>): string | null {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) return 'Use a PNG or JPG image of the floor plan.'
  if (file.size > limits.maxUploadBytes) return `That file is ${(file.size / 1e6).toFixed(1)} MB; the limit is ${(limits.maxUploadBytes / 1e6).toFixed(0)} MB.`
  if (file.size === 0) return 'That file is empty.'
  return null
}

/** The largest size with the same shape that fits within `maxPixels`, never enlarging. */
export function fitWithin(width: number, height: number, maxPixels: number): { width: number; height: number } {
  if (width * height <= maxPixels) return { width, height }
  const scale = Math.sqrt(maxPixels / (width * height))
  // Floor, then nudge down if rounding left us a pixel row over the limit.
  let w = Math.max(1, Math.floor(width * scale)), h = Math.max(1, Math.floor(height * scale))
  while (w * h > maxPixels) {
    if (w > h) w--
    else h--
  }
  return { width: w, height: h }
}

/** Lowercase hex of a SHA-256 digest: the source's content hash, and the basis of its asset ID. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** A rectangle in image pixels. */
export type PixelRect = { x: number; y: number; width: number; height: number }

/**
 * The crop box between two dragged corners, snapped to whole pixels and kept inside the
 * image; null when it is too small to be a deliberate crop (under 16 px either way).
 */
export function cropBox(a: { x: number; y: number }, b: { x: number; y: number }, image: { width: number; height: number }): PixelRect | null {
  const left = Math.max(0, Math.round(Math.min(a.x, b.x))), right = Math.min(image.width, Math.round(Math.max(a.x, b.x)))
  const top = Math.max(0, Math.round(Math.min(a.y, b.y))), bottom = Math.min(image.height, Math.round(Math.max(a.y, b.y)))
  if (right - left < 16 || bottom - top < 16) return null
  return { x: left, y: top, width: right - left, height: bottom - top }
}
