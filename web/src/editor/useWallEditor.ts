import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LoadedPlan } from './loadPlan.ts'
import { toScreen, type PlanCamera } from './planView.ts'
import type { StrokeHandlers } from './PlanCanvas.tsx'
import { FLOOR, OBJECT, WALL, WallMask, draftLayers, paintWalls, suggestThreshold, type DraftSettings, type Kind, type Rect } from './walls.ts'

export type WallTool = 'move' | 'wall' | 'object' | 'erase'
type Point = { x: number; y: number }

const BRUSH_KIND: Record<Exclude<WallTool, 'move'>, Kind> = { wall: WALL, object: OBJECT, erase: FLOOR }
const BRUSH_COLOUR: Record<Exclude<WallTool, 'move'>, string> = { wall: '#B91C1C', object: '#B45309', erase: '#357650' }

/** Default sizes: a 12 cm minimum wall, and furniture up to 3 m² filled in. */
const WALL_METRES = 0.12
const OBJECT_SQUARE_METRES = 3

/**
 * Wall and furniture tracing for the loaded plan: the automatic draft (threshold, speck filter,
 * minimum wall thickness, furniture size), the person's brush corrections, undo/redo, and the
 * red/amber overlay drawn over the plan. Sizes are in metres once the plan has a scale.
 * Pointer movement updates refs and asks the canvas to redraw, so it never re-renders React.
 */
export function useWallEditor(plan: LoadedPlan | null, metresPerPixel: number | null, redraw: () => void) {
  const [threshold, setThresholdState] = useState(128)
  const [ignoreSpecks, setIgnoreSpecksState] = useState(true)
  /** Minimum wall thickness: metres on scaled plans, pixels otherwise. */
  const [wallMetres, setWallMetresState] = useState(WALL_METRES)
  const [wallPixels, setWallPixelsState] = useState(4)
  const [furnitureBlocks, setFurnitureBlocks] = useState(true)
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

  /** The draft settings in pixels, from the controls and the plan's scale. */
  const settingsFor = useCallback((values: { threshold: number; ignoreSpecks: boolean; wallMetres: number; wallPixels: number }): DraftSettings => ({
    threshold: values.threshold,
    ignoreSpecks: values.ignoreSpecks,
    wallThickness: metresPerPixel ? values.wallMetres / metresPerPixel : values.wallPixels,
    maxObjectArea: metresPerPixel ? OBJECT_SQUARE_METRES / (metresPerPixel * metresPerPixel) : (values.wallPixels * 12) ** 2,
  }), [metresPerPixel])

  const repaint = useCallback((area?: Rect) => {
    const target = overlay.current, walls = mask.current
    if (!target || !walls) return
    paintWalls(walls, target.image.data, area)
    const a = area ?? { left: 0, top: 0, right: walls.width - 1, bottom: walls.height - 1 }
    target.canvas.getContext('2d')!.putImageData(target.image, 0, 0, a.left, a.top, a.right - a.left + 1, a.bottom - a.top + 1)
    redraw()
  }, [redraw])

  // Redrafting is ~1M pixels of work, so control changes are coalesced to one redraft per frame.
  const current = useRef({ threshold, ignoreSpecks, wallMetres, wallPixels })
  const frame = useRef(0)
  const exact = useRef(false)
  const redraft = useCallback((next: Partial<typeof current.current>) => {
    if (Object.keys(next).length > 0) exact.current = false
    current.current = { ...current.current, ...next }
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const walls = mask.current
      if (!plan || !walls) return
      walls.setDraft(draftLayers(plan.pixels, settingsFor(current.current)))
      repaint()
    })
  }, [plan, repaint, settingsFor])

  // A new plan: suggest a threshold, draft the walls, size the brush to the image.
  useEffect(() => {
    if (!plan) {
      mask.current = null
      overlay.current = null
      return
    }
    const { pixels } = plan
    const suggested = suggestThreshold(pixels)
    const wallPixelsDefault = Math.max(2, Math.round(Math.min(pixels.width, pixels.height) / 220))
    current.current = { threshold: suggested, ignoreSpecks: true, wallMetres: WALL_METRES, wallPixels: wallPixelsDefault }
    // A reopened saved plan starts from its exact walls; a new upload from the automatic draft.
    exact.current = plan.seed !== undefined
    mask.current = new WallMask(pixels.width, pixels.height, plan.seed ? plan.seed.kinds.slice() : draftLayers(pixels, settingsFor(current.current)))
    const canvas = document.createElement('canvas')
    canvas.width = pixels.width
    canvas.height = pixels.height
    overlay.current = { canvas, image: new ImageData(pixels.width, pixels.height) }
    // Setting state once per new plan is the point here: the controls start from the defaults.
    /* eslint-disable react-hooks/set-state-in-effect */
    setThresholdState(suggested)
    setIgnoreSpecksState(true)
    setWallMetresState(WALL_METRES)
    setWallPixelsState(wallPixelsDefault)
    setBrush(Math.max(2, Math.round(Math.min(pixels.width, pixels.height) / 160)))
    setHistory({ canUndo: false, canRedo: false })
    /* eslint-enable react-hooks/set-state-in-effect */
    repaint()
    // Only a new plan resets; a new scale redrafts below and keeps corrections.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan])

  // A new scale changes what "12 cm" is in pixels: redraft, keeping every correction. Saved
  // walls are exact, so they are only redrafted once the person changes a wall control.
  useEffect(() => { if (mask.current && !exact.current) redraft({}) }, [metresPerPixel, redraft])

  const setThreshold = (value: number) => { setThresholdState(value); redraft({ threshold: value }) }
  const setIgnoreSpecks = (value: boolean) => { setIgnoreSpecksState(value); redraft({ ignoreSpecks: value }) }
  const setWallMetres = (value: number) => { setWallMetresState(value); redraft({ wallMetres: value }) }
  const setWallPixels = (value: number) => { setWallPixelsState(value); redraft({ wallPixels: value }) }
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
      walls.beginStroke(BRUSH_KIND[toolRef.current])
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

  /** The wall/furniture overlay, the straight-line preview and the brush ring, over the plan. */
  const drawOverlay = useCallback((context: CanvasRenderingContext2D, camera: PlanCamera, options: { brush: boolean } = { brush: true }) => {
    const target = overlay.current
    if (!target) return
    context.imageSmoothingEnabled = camera.scale < 2
    context.drawImage(target.canvas, camera.offsetX, camera.offsetY, target.canvas.width * camera.scale, target.canvas.height * camera.scale)
    const p = pointer.current
    const active = toolRef.current
    if (!options.brush || active === 'move') return
    const radius = brushRef.current * camera.scale
    const colour = BRUSH_COLOUR[active]
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
    if (p.hover) {
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
  /** Every pixel's kind (floor, wall, furniture), for saving. */
  const readKinds = useCallback(() => mask.current?.kinds() ?? null, [])
  /** The current furniture, for saving (obstacles when furniture blocks people). */
  const readObjects = useCallback(() => mask.current?.objects() ?? null, [])

  return {
    mask, readBlocked, readObjects, readKinds, threshold, setThreshold, resetThreshold, ignoreSpecks, setIgnoreSpecks,
    wallMetres, setWallMetres, wallPixels, setWallPixels, scaled: metresPerPixel !== null, furnitureBlocks, setFurnitureBlocks,
    tool, setTool, brush, setBrush, undo, redo, ...history, stroke, onHover, drawOverlay,
  }
}

export type WallEditor = ReturnType<typeof useWallEditor>
