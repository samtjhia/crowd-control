import { useCallback, useMemo, useRef, useState } from 'react'
import type { LoadedPlan } from './loadPlan.ts'
import { toScreen, type PlanCamera } from './planView.ts'
import type { StrokeHandlers } from './PlanCanvas.tsx'
import { cropBox, type PixelRect } from './source.ts'

/**
 * Cropping in the Upload step: drag a box around the building to cut away title blocks,
 * legends and margins. The box only previews; applying it is up to the caller.
 */
export function useCropTool(plan: LoadedPlan | null, redraw: () => void) {
  const [active, setActive] = useState(false)
  const [box, setBox] = useState<PixelRect | null>(null)
  const drag = useRef<{ anchor: { x: number; y: number }; box: PixelRect | null } | null>(null)
  const boxRef = useRef<PixelRect | null>(null)

  const start = () => {
    setActive(true)
    setBox(null)
    boxRef.current = null
    redraw()
  }
  const cancel = () => {
    setActive(false)
    setBox(null)
    boxRef.current = null
    drag.current = null
    redraw()
  }

  const stroke: StrokeHandlers = useMemo(() => ({
    start: (point) => {
      drag.current = { anchor: point, box: null }
    },
    move: (point) => {
      if (!drag.current || !plan) return
      drag.current.box = cropBox(drag.current.anchor, point, plan.pixels)
      boxRef.current = drag.current.box
      redraw()
    },
    end: (point) => {
      if (!drag.current || !plan) return
      const next = cropBox(drag.current.anchor, point, plan.pixels)
      drag.current = null
      // A click without a drag keeps the previous box.
      if (next) {
        boxRef.current = next
        setBox(next)
      }
      redraw()
    },
  }), [plan, redraw])

  /** Dims everything outside the box, outlines it, and labels its size. */
  const drawOverlay = useCallback((context: CanvasRenderingContext2D, camera: PlanCamera) => {
    const rect = boxRef.current
    if (!plan) return
    const corner = toScreen(camera, { x: 0, y: 0 })
    const w = plan.pixels.width * camera.scale, h = plan.pixels.height * camera.scale
    if (!rect) {
      context.save()
      context.fillStyle = 'rgb(20 30 20 / 0.08)'
      context.fillRect(corner.x, corner.y, w, h)
      context.restore()
      return
    }
    const a = toScreen(camera, rect), bw = rect.width * camera.scale, bh = rect.height * camera.scale
    context.save()
    context.fillStyle = 'rgb(20 30 20 / 0.45)'
    context.beginPath()
    context.rect(corner.x, corner.y, w, h)
    context.rect(a.x, a.y, bw, bh)
    context.fill('evenodd')
    context.setLineDash([6, 4])
    context.lineWidth = 1.5
    context.strokeStyle = '#ffffff'
    context.strokeRect(a.x, a.y, bw, bh)
    const label = `${rect.width} × ${rect.height} px`
    context.font = "600 11px 'DM Sans Variable', 'DM Sans', sans-serif"
    const tw = context.measureText(label).width
    context.setLineDash([])
    context.fillStyle = 'rgb(20 30 20 / 0.75)'
    context.beginPath()
    context.roundRect(a.x, Math.max(corner.y, a.y - 24), tw + 14, 20, 6)
    context.fill()
    context.fillStyle = '#ffffff'
    context.fillText(label, a.x + 7, Math.max(corner.y, a.y - 24) + 14)
    context.restore()
  }, [plan])

  return { active, box, start, cancel, stroke, drawOverlay }
}

export type CropTool = ReturnType<typeof useCropTool>
