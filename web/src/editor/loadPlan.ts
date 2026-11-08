import type { Limits, Result, SourcePage } from '@crowd-control/contract'
import type { Door } from './doors.ts'
import type { Room } from './rooms.ts'
import { checkUpload, fitWithin, sha256Hex, type AcceptedType, type PixelRect } from './source.ts'

/**
 * A floor-plan image loaded into the editor: the "source page" every later tracing step
 * works on, in its pixel coordinates (Technical PRD §7 step 1).
 */
export type LoadedPlan = {
  source: SourcePage
  /** The plan at source resolution: the pixels every tool works on. */
  pixels: ImageData
  fileName: string
  /** The uploaded image at full resolution, kept so a crop can use all of its detail. */
  original: { width: number; height: number; bitmap: ImageBitmap }
  /** The part of the original in use, in original pixels; null for the whole image. */
  crop: PixelRect | null
  /** A saved plan reopened for editing: where its rooms, doors and scale start (see fromSaved.ts). */
  seed?: PlanSeed
}

/** The tracing of a saved plan, in the pixels of its redrawn image. */
export type PlanSeed = {
  /** FLOOR or WALL per pixel: the saved walls exactly, used instead of a draft from the image. */
  kinds: Uint8Array
  /** Room number per pixel, 0 for none. */
  labels: Uint16Array
  rooms: Room[]
  doors: Door[]
  /** The saved scale as a measured line, or null for a plan without one. */
  scale: { a: { x: number; y: number }; b: { x: number; y: number }; metres: number } | null
  floor: string
  /** The saved plan's ID, kept when it is saved again. */
  editing: string
}

type Limit = Pick<Limits, 'maxUploadBytes' | 'maxSourcePixels'>

/**
 * Decodes and fingerprints an uploaded plan image (browser only). Images above the
 * source-pixel limit are scaled down once here, so masks and brushes stay fast.
 */
export async function loadPlan(file: File, limits: Limit): Promise<Result<LoadedPlan>> {
  const problem = checkUpload(file, limits)
  if (problem) return { ok: false, error: { code: problem.includes('limit') ? 'RESOURCE_LIMIT' : 'INVALID_SCHEMA', message: problem } }
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return { ok: false, error: { code: 'INVALID_SCHEMA', message: 'That image could not be read. Try exporting it again as PNG or JPG.' } }
  }
  const original = { width: bitmap.width, height: bitmap.height, bitmap }
  return { ok: true, value: await render(file.name, file.type as AcceptedType, original, null, limits) }
}

/**
 * Crops the plan to part of the original image, then scales that part to fit the pixel limit,
 * so cropping a large scan gains detail rather than losing it. `rect` is in the current plan's
 * pixels; null goes back to the whole image.
 */
export async function cropPlan(plan: LoadedPlan, rect: PixelRect | null, limits: Limit): Promise<LoadedPlan> {
  if (!rect) return render(plan.fileName, plan.source.mimeType as AcceptedType, plan.original, null, limits)
  const current = plan.crop ?? { x: 0, y: 0, width: plan.original.width, height: plan.original.height }
  const kx = current.width / plan.source.pixelWidth, ky = current.height / plan.source.pixelHeight
  const x = Math.max(0, Math.floor(current.x + rect.x * kx)), y = Math.max(0, Math.floor(current.y + rect.y * ky))
  const crop = {
    x, y,
    width: Math.max(1, Math.min(plan.original.width - x, Math.round(rect.width * kx))),
    height: Math.max(1, Math.min(plan.original.height - y, Math.round(rect.height * ky))),
  }
  return render(plan.fileName, plan.source.mimeType as AcceptedType, plan.original, crop, limits)
}

/** Draws (part of) the original at a size within the pixel limit, on white paper, and fingerprints it. */
async function render(fileName: string, mimeType: AcceptedType, original: LoadedPlan['original'], crop: PixelRect | null, limits: Limit): Promise<LoadedPlan> {
  const area = crop ?? { x: 0, y: 0, width: original.width, height: original.height }
  const size = fitWithin(area.width, area.height, limits.maxSourcePixels)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.imageSmoothingQuality = 'high'
  // Transparent areas of a PNG are treated as white paper.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, size.width, size.height)
  context.drawImage(original.bitmap, area.x, area.y, area.width, area.height, 0, 0, size.width, size.height)
  const pixels = context.getImageData(0, 0, size.width, size.height)
  // The fingerprint is of the pixels actually traced, so a crop is a different source.
  const hash = await sha256Hex(pixels.data.slice().buffer)
  return {
    source: { assetId: `upload-${hash.slice(0, 16)}`, revision: 'draft', page: 1, mimeType, pixelWidth: size.width, pixelHeight: size.height, contentHash: hash },
    pixels,
    fileName,
    original,
    crop,
  }
}
