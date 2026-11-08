import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Calibration } from '@crowd-control/contract'
import type { LoadedPlan } from './loadPlan.ts'
import { toScreen, type PlanCamera } from './planView.ts'
import type { StrokeHandlers } from './PlanCanvas.tsx'
import { calibrate, formatMetres, pixelDistance, scaleBar, type LengthUnit, type Point } from './scale.ts'

/** How close (in screen pixels) a press must be to an end to drag that end. */
const GRAB_PX = 12

/**
 * The Scale step: drag a measuring line, adjust its ends, type the real distance. The
 * resulting calibration (or "not to scale") is kept for the rest of the editor.
 */
export function useScaleTool(plan: LoadedPlan | null, redraw: () => void, cameraOf: () => PlanCamera | null) {
  const [points, setPoints] = useState<{ a: Point | null; b: Point | null }>({ a: null, b: null })
  const [distance, setDistance] = useState('')
  const [unit, setUnit] = useState<LengthUnit>('m')
  /** True once the person says the plan has no reliable scale. */
  const [unscaled, setUnscaled] = useState(false)
  const live = useRef<{ a: Point | null; b: Point | null }>({ a: null, b: null })
  const drag = useRef<'a' | 'b' | null>(null)

  // A new (or re-cropped) plan has new pixel coordinates, so any measurement starts again.
  // A reopened saved plan starts with its saved scale, drawn as a line along the bottom.
  useEffect(() => {
    const saved = plan?.seed?.scale
    live.current = saved ? { a: saved.a, b: saved.b } : { a: null, b: null }
    /* eslint-disable react-hooks/set-state-in-effect */
    setPoints({ ...live.current })
    setUnscaled(plan?.seed !== undefined && !saved)
    if (saved) { setDistance(String(saved.metres)); setUnit('m') }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [plan])

  const clamp = useCallback((p: Point): Point => plan
    ? { x: Math.min(plan.pixels.width, Math.max(0, p.x)), y: Math.min(plan.pixels.height, Math.max(0, p.y)) }
    : p, [plan])

  const stroke: StrokeHandlers = useMemo(() => ({
    start: (point) => {
      const p = clamp(point)
      const camera = cameraOf()
      const near = (q: Point | null) => q !== null && camera !== null && pixelDistance(toScreen(camera, q), toScreen(camera, p)) <= GRAB_PX
      // Grab an existing end to adjust it; otherwise start a new line here.
      if (near(live.current.b)) drag.current = 'b'
      else if (near(live.current.a)) drag.current = 'a'
      else {
        live.current = { a: p, b: null }
        drag.current = 'b'
      }
      redraw()
    },
    move: (point) => {
      if (!drag.current) return
      live.current = { ...live.current, [drag.current]: clamp(point) }
      redraw()
    },
    end: (point) => {
      if (!drag.current) return
      live.current = { ...live.current, [drag.current]: clamp(point) }
      drag.current = null
      setPoints({ ...live.current })
      setUnscaled(false)
      redraw()
    },
  }), [clamp, cameraOf, redraw])

  // Recomputed only when the line, distance or unit changes: later steps react to a new scale.
  const result = useMemo(() => calibrate(points.a, points.b, Number.parseFloat(distance), unit), [points, distance, unit])
  const calibration: Calibration | null = useMemo(() => (!unscaled && result.ok ? result.value : null), [unscaled, result])

  /** The measuring line with its ends and length, and (once scaled) a scale bar in the corner. */
  const drawOverlay = useCallback((context: CanvasRenderingContext2D, camera: PlanCamera, options: { measuring: boolean; metresPerPixel: number | null }) => {
    const { a, b } = live.current
    context.save()
    if (options.measuring && a) {
      const sa = toScreen(camera, a), sb = b ? toScreen(camera, b) : sa
      context.lineCap = 'round'
      context.strokeStyle = '#ffffff'
      context.lineWidth = 5
      context.beginPath(); context.moveTo(sa.x, sa.y); context.lineTo(sb.x, sb.y); context.stroke()
      context.strokeStyle = '#2F6FEB'
      context.lineWidth = 2.5
      context.beginPath(); context.moveTo(sa.x, sa.y); context.lineTo(sb.x, sb.y); context.stroke()
      for (const end of b ? [sa, sb] : [sa]) {
        context.fillStyle = '#ffffff'
        context.beginPath(); context.arc(end.x, end.y, 7, 0, Math.PI * 2); context.fill()
        context.strokeStyle = '#2F6FEB'
        context.lineWidth = 2.5
        context.beginPath(); context.arc(end.x, end.y, 7, 0, Math.PI * 2); context.stroke()
      }
      if (b) {
        const pixels = pixelDistance(a, b)
        const label = options.metresPerPixel ? formatMetres(pixels * options.metresPerPixel) : `${Math.round(pixels)} px`
        pill(context, label, (sa.x + sb.x) / 2, (sa.y + sb.y) / 2 - 16)
      }
    }
    if (options.metresPerPixel && plan) {
      const bar = scaleBar(options.metresPerPixel / camera.scale)
      const origin = toScreen(camera, { x: 0, y: plan.pixels.height })
      const x = origin.x + 16, y = origin.y - 18
      context.fillStyle = 'rgb(255 255 255 / 0.85)'
      context.beginPath(); context.roundRect(x - 8, y - 22, bar.pixels + 16, 32, 8); context.fill()
      context.fillStyle = '#1E2420'
      context.fillRect(x, y, bar.pixels, 3)
      context.fillRect(x, y - 5, 2, 8)
      context.fillRect(x + bar.pixels - 2, y - 5, 2, 8)
      context.font = "600 11px 'DM Sans Variable', 'DM Sans', sans-serif"
      context.fillText(formatMetres(bar.metres), x, y - 8)
    }
    context.restore()
  }, [plan])

  return {
    points, distance, setDistance, unit, setUnit, unscaled, setUnscaled, result, calibration, stroke, drawOverlay,
    clear: () => { live.current = { a: null, b: null }; setPoints({ a: null, b: null }); redraw() },
  }
}

/** A small dark label centred on a point. */
function pill(context: CanvasRenderingContext2D, text: string, x: number, y: number) {
  context.font = "600 12px 'DM Sans Variable', 'DM Sans', sans-serif"
  const width = context.measureText(text).width + 14
  context.fillStyle = 'rgb(20 30 20 / 0.8)'
  context.beginPath(); context.roundRect(x - width / 2, y - 11, width, 22, 7); context.fill()
  context.fillStyle = '#ffffff'
  context.textAlign = 'center'
  context.fillText(text, x, y + 4)
  context.textAlign = 'start'
}

export type ScaleTool = ReturnType<typeof useScaleTool>
