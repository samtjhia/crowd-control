import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LoadedPlan } from './loadPlan.ts'
import { toScreen, type PlanCamera } from './planView.ts'
import type { StrokeHandlers } from './PlanCanvas.tsx'
import { WallMask, draftWalls, paintWalls, suggestThreshold, type Rect } from './walls.ts'

export type WallTool = 'move' | 'wall' | 'erase'
type Point = { x: number; y: number }

/**
 * Wall-tracing state for the loaded plan: the automatic draft (threshold and speck filter),
 * the person's brush corrections, undo/redo, and the red overlay drawn over the plan.
 * Pointer movement updates refs and asks the canvas to redraw, so it never re-renders React.
 */
export function useWallEditor(plan: LoadedPlan | null, redraw: () => void) {
  const [threshold, setThresholdState] = useState(128)
  const [ignoreSpecks, setIgnoreSpecksState] = useState(true)
  const [tool, setTool] = useState<WallTool>('wall')
  const [brush, setBrush] = useState(4)
  const [history, setHistory] = useState({ canUndo: false, canRedo: false })
  const mask = useRef<WallMask | null>(null)
  const overlay = useRef<{ canvas: HTMLCanvasElement; image: ImageData } | null>(null)
  const pointer = useRef<{ hover: Point | null; last: Point | null; anchor: Point | null; line: Point | null }>({ hover: null, last: null, anchor: null, line: null })
  const brushRef = useRef(brush)
  const toolRef = useRef(tool)
  useEffect(() => { brushRef.current = brush }, [brush])
  useEffect(() => { toolRef.current = tool }, [tool])

  const repaint = useCallback((area?: Rect) => {
    const target = overlay.current, walls = mask.current
    if (!target || !walls) return
    paintWalls(walls, target.image.data, area)
    const a = area ?? { left: 0, top: 0, right: walls.width - 1, bottom: walls.height - 1 }
    target.canvas.getContext('2d')!.putImageData(target.image, 0, 0, a.left, a.top, a.right - a.left + 1, a.bottom - a.top + 1)
    redraw()
  }, [redraw])

  // A new plan: suggest a threshold, draft the walls, size the brush to the image.
  useEffect(() => {
    if (!plan) {
      mask.current = null
      overlay.current = null
      return
    }
    const { pixels } = plan
    const suggested = suggestThreshold(pixels)
    mask.current = new WallMask(pixels.width, pixels.height, draftWalls(pixels, suggested, true))
    const canvas = document.createElement('canvas')
    canvas.width = pixels.width
    canvas.height = pixels.height
    overlay.current = { canvas, image: new ImageData(pixels.width, pixels.height) }
    // Setting state once per new plan is the point here: the controls start from the suggestion.
    /* eslint-disable react-hooks/set-state-in-effect */
    setThresholdState(suggested)
    setIgnoreSpecksState(true)
    setBrush(Math.max(2, Math.round(Math.min(pixels.width, pixels.height) / 160)))
    setHistory({ canUndo: false, canRedo: false })
    /* eslint-enable react-hooks/set-state-in-effect */
    repaint()
  }, [plan, repaint])

  // Redrafting is ~1M pixels of work, so slider drags are coalesced to one redraft per frame.
  const pending = useRef<{ threshold: number; ignoreSpecks: boolean } | null>(null)
  const frame = useRef(0)
  const redraft = useCallback((next: { threshold: number; ignoreSpecks: boolean }) => {
    pending.current = next
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const walls = mask.current, settings = pending.current
      if (!plan || !walls || !settings) return
      walls.setDraft(draftWalls(plan.pixels, settings.threshold, settings.ignoreSpecks))
      repaint()
    })
  }, [plan, repaint])

  const setThreshold = (value: number) => {
    setThresholdState(value)
    redraft({ threshold: value, ignoreSpecks })
  }
  const setIgnoreSpecks = (value: boolean) => {
    setIgnoreSpecksState(value)
    redraft({ threshold, ignoreSpecks: value })
  }
  const resetThreshold = () => plan && setThreshold(suggestThreshold(plan.pixels))

  const syncHistory = () => setHistory({ canUndo: mask.current?.canUndo ?? false, canRedo: mask.current?.canRedo ?? false })
  const undo = () => {
    const area = mask.current?.undo()
    if (area) repaint(area)
    syncHistory()
  }
  const redo = () => {
    const area = mask.current?.redo()
    if (area) repaint(area)
    syncHistory()
  }

  /** Brush input: drag paints; Shift-drag draws a straight line from where the drag began. */
  const stroke: StrokeHandlers = useMemo(() => ({
    start: (point, shift) => {
      const walls = mask.current
      if (!walls || toolRef.current === 'move') return
      walls.beginStroke(toolRef.current === 'erase')
      pointer.current = { ...pointer.current, last: point, anchor: point, line: shift ? point : null }
      if (!shift) {
        const area = walls.paint(point, point, brushRef.current)
        if (area) repaint(area)
      }
    },
    move: (point, shift) => {
      const walls = mask.current, p = pointer.current
      if (!walls || !p.last) return
      if (shift && p.anchor) {
        p.line = point // previewed until release
        redraw()
        return
      }
      const area = walls.paint(p.last, point, brushRef.current)
      p.last = point
      if (area) repaint(area)
    },
    end: (point, shift) => {
      const walls = mask.current, p = pointer.current
      if (!walls || !p.last) return
      if (shift && p.anchor) {
        const area = walls.paint(p.anchor, point, brushRef.current)
        if (area) repaint(area)
      }
      walls.endStroke()
      pointer.current = { ...p, last: null, anchor: null, line: null }
      syncHistory()
      redraw()
    },
  }), [repaint, redraw])

  const onHover = useCallback((point: Point | null) => {
    pointer.current.hover = point
    if (toolRef.current !== 'move') redraw()
  }, [redraw])

  /** The red wall overlay, the straight-line preview and the brush ring, over the plan. */
  const drawOverlay = useCallback((context: CanvasRenderingContext2D, camera: PlanCamera, options: { brush: boolean } = { brush: true }) => {
    const target = overlay.current
    if (!target) return
    context.imageSmoothingEnabled = camera.scale < 2
    context.drawImage(target.canvas, camera.offsetX, camera.offsetY, target.canvas.width * camera.scale, target.canvas.height * camera.scale)
    const p = pointer.current
    const radius = brushRef.current * camera.scale
    const colour = toolRef.current === 'erase' ? '#357650' : '#B91C1C'
    if (p.anchor && p.line) {
      const a = toScreen(camera, p.anchor), b = toScreen(camera, p.line)
      context.save()
      context.lineCap = 'round'
      context.globalAlpha = 0.5
      context.strokeStyle = colour
      context.lineWidth = radius * 2
      context.beginPath()
      context.moveTo(a.x, a.y)
      context.lineTo(b.x, b.y)
      context.stroke()
      context.restore()
    }
    if (options.brush && p.hover && toolRef.current !== 'move') {
      const c = toScreen(camera, p.hover)
      context.save()
      context.lineWidth = 1.5
      context.strokeStyle = '#ffffff'
      context.beginPath()
      context.arc(c.x, c.y, Math.max(2, radius) + 1, 0, Math.PI * 2)
      context.stroke()
      context.strokeStyle = colour
      context.beginPath()
      context.arc(c.x, c.y, Math.max(2, radius), 0, Math.PI * 2)
      context.stroke()
      context.restore()
    }
  }, [])

  /** The current walls (draft plus corrections), for later steps. */
  const readBlocked = useCallback(() => mask.current?.blocked() ?? null, [])

  return {
    mask, readBlocked, threshold, setThreshold, resetThreshold, ignoreSpecks, setIgnoreSpecks,
    tool, setTool, brush, setBrush, undo, redo, ...history, stroke, onHover, drawOverlay,
  }
}

export type WallEditor = ReturnType<typeof useWallEditor>
