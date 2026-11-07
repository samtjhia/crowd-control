import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react'
import { fitPlan, panPlan, toSource, zoomPlan, type Area, type PlanCamera } from './planView.ts'

export type PlanCanvasHandle = { zoom: (factor: number) => void; fit: () => void; redraw: () => void }

/** Pointer input for drawing tools, in source-pixel coordinates. */
export type StrokeHandlers = {
  start: (point: { x: number; y: number }, shift: boolean) => void
  move: (point: { x: number; y: number }, shift: boolean) => void
  end: (point: { x: number; y: number }, shift: boolean) => void
}

type Props = {
  pixels: ImageData
  /** Screen edges covered by floating UI, so fitting centres the plan in what is left. */
  insets: { top: number; right: number; bottom: number; left: number }
  /** Faded image: lets tracing overlays stand out (0–1). */
  imageOpacity?: number
  /** Draws tool overlays in screen space whenever the view is redrawn. */
  drawOverlay?: (context: CanvasRenderingContext2D, camera: PlanCamera) => void
  /** 'pan': dragging moves the plan. 'draw': dragging goes to `stroke` (hold Space to pan). */
  mode?: 'pan' | 'draw'
  /** Cursor while drawing: hidden by default (a brush ring replaces it), or e.g. a crosshair. */
  drawCursor?: string
  stroke?: StrokeHandlers
  /** The pointer's position over the plan, for brush previews; null when it leaves. */
  onHover?: (point: { x: number; y: number } | null) => void
  ref?: Ref<PlanCanvasHandle>
}

const CLICK_SLOP_PX = 5

/**
 * The floor plan on a pan/zoom canvas (Technical PRD §7 step 3: "pan and zoom all layers
 * together"). Scroll zooms around the pointer. Zoomed in past 2×, pixels draw crisp so walls
 * can be traced exactly.
 */
export function PlanCanvas({ pixels, insets, imageOpacity = 1, drawOverlay, mode = 'pan', drawCursor = 'none', stroke, onHover, ref }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const state = useRef<{ camera: PlanCamera | null; fitted: PlanCamera | null; image: HTMLCanvasElement | null; frame: number; moved: boolean; space: boolean }>({
    camera: null, fitted: null, image: null, frame: 0, moved: false, space: false,
  })
  const props = useRef({ insets, imageOpacity, drawOverlay, mode, drawCursor, stroke, onHover })
  useLayoutEffect(() => {
    props.current = { insets, imageOpacity, drawOverlay, mode, drawCursor, stroke, onHover }
  })

  const area = (): Area => {
    const host = hostRef.current!
    const { top, right, bottom, left } = props.current.insets
    return { left, top, width: host.clientWidth - left - right, height: host.clientHeight - top - bottom }
  }

  const draw = () => {
    const s = state.current
    cancelAnimationFrame(s.frame)
    s.frame = requestAnimationFrame(() => {
      const canvas = canvasRef.current, host = hostRef.current
      if (!canvas || !host || !s.camera || !s.image) return
      const ratio = window.devicePixelRatio || 1
      const width = host.clientWidth, height = host.clientHeight
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio)
        canvas.height = Math.round(height * ratio)
      }
      const context = canvas.getContext('2d')!
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)
      const { scale, offsetX, offsetY } = s.camera
      const w = s.image.width * scale, h = s.image.height * scale
      // The plan sits on a white sheet with a soft shadow, like paper on the workspace.
      context.save()
      context.shadowColor = 'rgb(20 30 20 / 0.12)'
      context.shadowBlur = 24
      context.shadowOffsetY = 6
      context.fillStyle = '#ffffff'
      context.fillRect(offsetX, offsetY, w, h)
      context.restore()
      context.imageSmoothingEnabled = scale < 2
      context.globalAlpha = props.current.imageOpacity
      context.drawImage(s.image, offsetX, offsetY, w, h)
      context.globalAlpha = 1
      props.current.drawOverlay?.(context, s.camera)
    })
  }

  const fit = () => {
    const s = state.current
    if (!s.image || !hostRef.current) return
    s.fitted = fitPlan(s.image, area())
    s.camera = s.fitted
    s.moved = false
    draw()
  }

  useImperativeHandle(ref, () => ({
    zoom: (factor) => {
      const s = state.current
      if (!s.camera || !s.fitted) return
      const a = area()
      s.camera = zoomPlan(s.camera, s.fitted, { x: a.left + a.width / 2, y: a.top + a.height / 2 }, factor)
      s.moved = true
      draw()
    },
    fit,
    redraw: draw,
  }))

  // A new image: copy it into a canvas once, then fit it to the screen.
  useEffect(() => {
    const image = document.createElement('canvas')
    image.width = pixels.width
    image.height = pixels.height
    image.getContext('2d')!.putImageData(pixels, 0, 0)
    state.current.image = image
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixels])

  // Overlays, opacity or insets changed: redraw; refit unless the user has zoomed or panned.
  useEffect(() => {
    if (!state.current.moved) fit()
    else draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageOpacity, drawOverlay, insets.top, insets.right, insets.bottom, insets.left])

  useEffect(() => {
    const host = hostRef.current!, canvas = canvasRef.current!
    const s = state.current
    const observer = new ResizeObserver(() => (s.moved ? draw() : fit()))
    observer.observe(host)
    const local = (event: PointerEvent | WheelEvent) => {
      const bounds = canvas.getBoundingClientRect()
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
    }
    const source = (event: PointerEvent) => (s.camera ? toSource(s.camera, local(event)) : { x: 0, y: 0 })
    const panning = () => props.current.mode === 'pan' || s.space
    const setCursor = () => {
      canvas.style.cursor = panning() ? (drag?.kind === 'pan' && drag.travelled > CLICK_SLOP_PX ? 'grabbing' : 'grab') : props.current.drawCursor
    }
    let drag: { kind: 'pan' | 'draw'; x: number; y: number; id: number; travelled: number } | null = null

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      if (!s.camera || !s.fitted) return
      s.camera = zoomPlan(s.camera, s.fitted, local(event), event.deltaY < 0 ? 1.12 : 1 / 1.12)
      s.moved = true
      draw()
    }
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      const kind = panning() ? 'pan' : 'draw'
      drag = { kind, x: event.clientX, y: event.clientY, id: event.pointerId, travelled: 0 }
      canvas.setPointerCapture(event.pointerId)
      if (kind === 'draw') props.current.stroke?.start(source(event), event.shiftKey)
    }
    const onMove = (event: PointerEvent) => {
      if (s.camera) props.current.onHover?.(source(event))
      if (!drag || drag.id !== event.pointerId || !s.camera) return
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y
      drag = { ...drag, x: event.clientX, y: event.clientY, travelled: drag.travelled + Math.hypot(dx, dy) }
      if (drag.kind === 'draw') {
        props.current.stroke?.move(source(event), event.shiftKey)
        return
      }
      if (drag.travelled <= CLICK_SLOP_PX) return
      s.camera = panPlan(s.camera, dx, dy)
      s.moved = true
      setCursor()
      draw()
    }
    const onUp = (event: PointerEvent) => {
      if (drag?.id !== event.pointerId) return
      const finished = drag
      drag = null
      if (finished.kind === 'draw') props.current.stroke?.end(source(event), event.shiftKey)
      setCursor()
    }
    const onLeave = () => props.current.onHover?.(null)
    const onEnter = () => setCursor()
    // Holding Space pans with any tool, as in most drawing apps.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== ' ' || (event.target as HTMLElement | null)?.closest('input, textarea, select, button')) return
      event.preventDefault()
      s.space = event.type === 'keydown'
      setCursor()
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('pointerenter', onEnter)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(s.frame)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('pointerenter', onEnter)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The cursor follows the tool: a hand for moving, hidden for brushes (the brush ring shows instead).
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) canvas.style.cursor = mode === 'pan' ? 'grab' : drawCursor
  }, [mode, drawCursor])

  return (
    <div className="editor-canvas" ref={hostRef}>
      <canvas ref={canvasRef} role="img" aria-label="Floor plan" />
    </div>
  )
}
