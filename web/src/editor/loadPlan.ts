import type { Limits, Result, SourcePage } from '@crowd-control/contract'
import { checkUpload, fitWithin, sha256Hex, type AcceptedType } from './source.ts'

/**
 * A floor-plan image loaded into the editor: the "source page" every later tracing step
 * works on, in its pixel coordinates (Technical PRD §7 step 1).
 */
export type LoadedPlan = {
  source: SourcePage
  /** The plan at source resolution: the pixels every tool works on. */
  pixels: ImageData
  fileName: string
  /** Original size before any downscaling, for the "scaled down" note. */
  original: { width: number; height: number }
}

/**
 * Decodes, downscales if needed and fingerprints an uploaded plan image (browser only).
 * Images above the source-pixel limit are scaled down once here, so masks and brushes stay fast.
 */
export async function loadPlan(file: File, limits: Pick<Limits, 'maxUploadBytes' | 'maxSourcePixels'>): Promise<Result<LoadedPlan>> {
  const problem = checkUpload(file, limits)
  if (problem) return { ok: false, error: { code: problem.includes('limit') ? 'RESOURCE_LIMIT' : 'INVALID_SCHEMA', message: problem } }
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return { ok: false, error: { code: 'INVALID_SCHEMA', message: 'That image could not be read. Try exporting it again as PNG or JPG.' } }
  }
  const size = fitWithin(bitmap.width, bitmap.height, limits.maxSourcePixels)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.imageSmoothingQuality = 'high'
  // Transparent areas of a PNG are treated as white paper.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, size.width, size.height)
  context.drawImage(bitmap, 0, 0, size.width, size.height)
  const original = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  const hash = await sha256Hex(await file.arrayBuffer())
  return {
    ok: true,
    value: {
      source: {
        assetId: `upload-${hash.slice(0, 16)}`, revision: 'draft', page: 1, mimeType: file.type as AcceptedType,
        pixelWidth: size.width, pixelHeight: size.height, contentHash: hash,
      },
      pixels: context.getImageData(0, 0, size.width, size.height),
      fileName: file.name,
      original,
    },
  }
}
