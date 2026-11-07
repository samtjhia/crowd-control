import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LoadedPlan } from './loadPlan.ts'
import { toScreen, type PlanCamera } from './planView.ts'
import type { StrokeHandlers } from './PlanCanvas.tsx'
import { RoomLayer, lineIndices, paintRooms, partitionFloor } from './rooms.ts'

export type RoomTool = 'fill' | 'split' | 'move'
type Point = { x: number; y: number }

/**
 * Room-tracing state: fill spaces into named rooms, draw split lines, undo/redo, and the
 * coloured room overlay. Walls are read from the Walls step when the Rooms step opens.
 */
export function useRoomEditor(plan: LoadedPlan | null, active: boolean, readWalls: () => Uint8Array | null, metresPerPixel: number | null, redraw: () => void) {
  const [tool, setTool] = useState<RoomTool>('fill')
  const [selected, setSelected] = useState<number | null>(null)
  const [, setVersion] = useState(0)
  const [warning, setWarning] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** Openings narrower than this split rooms: metres on scaled plans, pixels otherwise. */
  const [gapMetres, setGapMetres] = useState(1)
  const [gapPixels, setGapPixels] = useState(20)
  const [justCreated, setJustCreated] = useState<number | null>(null)
  const layer = useRef<RoomLayer | null>(null)
  const walls = useRef<Uint8Array | null>(null)
  const cache = useRef<{ key: string; space: Int32Array } | null>(null)
  const boundaryVersion = useRef(0)
  const overlay = useRef<{ canvas: HTMLCanvasElement; image: ImageData } | null>(null)
  const pointer = useRef<{ anchor: Point | null; line: Point | null }>({ anchor: null, line: null })
  const toolRef = useRef(tool)
  const selectedRef = useRef(selected)
  useEffect(() => { toolRef.current = tool }, [tool])
  useEffect(() => { selectedRef.current = selected }, [selected])

  /** Gap in pixels: half of the narrowest opening that still joins two spaces. */
  const gapRadius = metresPerPixel ? (gapMetres / metresPerPixel) / 2 : gapPixels / 2
  const gapRef = useRef(gapRadius)
  useEffect(() => {
    gapRef.current = gapRadius
    cache.current = null
  }, [gapRadius])

  const refresh = useCallback(() => {
    const target = overlay.current, rooms = layer.current, blocked = walls.current
    if (!target || !rooms || !blocked) return
    paintRooms(rooms, blocked, selectedRef.current, target.image.data)
    target.canvas.getContext('2d')!.putImageData(target.image, 0, 0)
    setVersion((v) => v + 1)
    redraw()
  }, [redraw])

  // A new plan: rooms start over, and the default gap is sized to the image.
  useEffect(() => {
    layer.current = plan ? new RoomLayer(plan.pixels.width, plan.pixels.height) : null
    cache.current = null
    if (!plan) return
    const canvas = document.createElement('canvas')
    canvas.width = plan.pixels.width
    canvas.height = plan.pixels.height
    overlay.current = { canvas, image: new ImageData(plan.pixels.width, plan.pixels.height) }
    /* eslint-disable react-hooks/set-state-in-effect */
    setSelected(null)
    setWarning(null)
    setGapPixels(Math.max(4, Math.round(Math.min(plan.pixels.width, plan.pixels.height) * 0.02)))
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [plan])

  // Opening the step reads the latest walls (they may have changed since last time).
  useEffect(() => {
    if (!active) return
    walls.current = readWalls()
    cache.current = null
    refresh()
  }, [active, readWalls, refresh])

  useEffect(() => { refresh() }, [selected, refresh])

  const spaces = (gap: number): Int32Array | null => {
    const rooms = layer.current, blocked = walls.current
    if (!rooms || !blocked) return null
    const key = `${boundaryVersion.current}|${gap}`
    if (cache.current?.key !== key) cache.current = { key, space: partitionFloor(blocked, rooms.boundary, rooms.width, rooms.height, gap) }
    return cache.current.space
  }

  /** Fills the space under the click as a new room, or (Shift) adds it to the selected room. */
  const fillAt = (point: Point, add: boolean) => {
    const rooms = layer.current, blocked = walls.current
    if (!rooms || !blocked || !plan) return
    const x = Math.floor(point.x), y = Math.floor(point.y)
    if (x < 0 || y < 0 || x >= rooms.width || y >= rooms.height) return
    const seed = y * rooms.width + x
    const existing = rooms.roomAt(seed)
    if (existing) {
      // Shift-clicking another room merges it into the selected one.
      if (add && selectedRef.current !== null && existing.id !== selectedRef.current) {
        rooms.merge(selectedRef.current, existing.id)
        refresh()
        return
      }
      setSelected(existing.id)
      return
    }
    if (blocked[seed]) {
      setWarning('That’s a wall. Click inside a space.')
      return
    }
    let space = spaces(gapRef.current)
    // Pockets too cramped for the doorway rule still fill as plain enclosed areas.
    if (space && space[seed]! < 0) space = spaces(0)
    if (!space) return
    const room = rooms.fill(seed, space, add ? selectedRef.current : null)
    if (!room) return
    setSelected(room.id)
    if (!add) setJustCreated(room.id)
    setWarning(edgeWarning(rooms, room.id))
    refresh()
  }

  const stroke: StrokeHandlers = useMemo(() => ({
    start: (point) => {
      pointer.current = { anchor: point, line: null }
    },
    move: (point) => {
      if (toolRef.current !== 'split' || !pointer.current.anchor) return
      pointer.current.line = point
      redraw()
    },
    end: (point, shift) => {
      const anchor = pointer.current.anchor
      pointer.current = { anchor: null, line: null }
      const rooms = layer.current
      if (!anchor || !rooms) return
      if (toolRef.current === 'fill') fillAt(anchor, shift)
      else if (toolRef.current === 'split' && rooms.split(lineIndices(anchor, point, 1.2, rooms.width, rooms.height))) {
        boundaryVersion.current++
        cache.current = null
        refresh()
      } else redraw()
    },
    // fillAt reads only refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [refresh, redraw, plan])

  /** Room colours, plus the split line being drawn. */
  const drawOverlay = useCallback((context: CanvasRenderingContext2D, camera: PlanCamera) => {
    const target = overlay.current
    if (!target) return
    context.imageSmoothingEnabled = camera.scale < 2
    context.drawImage(target.canvas, camera.offsetX, camera.offsetY, target.canvas.width * camera.scale, target.canvas.height * camera.scale)
    const { anchor, line } = pointer.current
    if (anchor && line) {
      const a = toScreen(camera, anchor), b = toScreen(camera, line)
      context.save()
      context.setLineDash([8, 5])
      context.lineWidth = 2.5
      context.strokeStyle = '#1E3A8A'
      context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke()
      context.restore()
    }
  }, [])

  /**
   * Fills every space at least ~2 m² (or 3% of the image on unscaled plans) in one go.
   * Spaces touching the plan's edge come out as "Outside", tagged outside.
   */
  const findRooms = () => {
    const rooms = layer.current
    if (!rooms || !plan) return
    const space = spaces(gapRef.current)
    if (!space) return
    const minPixels = metresPerPixel ? 2 / (metresPerPixel * metresPerPixel) : (Math.min(rooms.width, rooms.height) * 0.03) ** 2
    const created = rooms.fillAll(space, minPixels)
    setWarning(null)
    setSelected(null)
    setNotice(created.length === 0
      ? 'No new spaces found. Every enclosed space is already a room, or too small to count.'
      : `Found ${created.length} ${created.length === 1 ? 'space' : 'spaces'}. Check each one: rename it, Shift-click to merge pieces of one room, and remove anything that isn’t a room.`)
    refresh()
  }

  const rooms = layer.current?.rooms ?? []
  const sizes = layer.current?.sizes() ?? new Map<number, number>()
  const area = (id: number) => {
    const pixels = sizes.get(id) ?? 0
    return metresPerPixel ? pixels * metresPerPixel * metresPerPixel : null
  }
  const act = (change: (layer: RoomLayer) => void) => {
    if (!layer.current) return
    change(layer.current)
    refresh()
  }

  return {
    tool, setTool, selected, setSelected, warning, notice, findRooms,
    clearAll: () => { act((l) => l.clear()); setSelected(null); setNotice(null) }, gapMetres, setGapMetres, gapPixels, setGapPixels, scaled: metresPerPixel !== null,
    rooms, area, justCreated, clearJustCreated: () => setJustCreated(null),
    rename: (id: number, label: string) => act((l) => l.rename(id, label)),
    toggleTag: (id: number, tag: string) => act((l) => l.toggleTag(id, tag)),
    remove: (id: number) => { act((l) => l.remove(id)); setSelected(null) },
    undo: () => act((l) => { if (l.undo()) { boundaryVersion.current++; cache.current = null } }),
    redo: () => act((l) => { if (l.redo()) { boundaryVersion.current++; cache.current = null } }),
    canUndo: layer.current?.canUndo ?? false,
    canRedo: layer.current?.canRedo ?? false,
    stroke, drawOverlay, layer,
  }
}

/** A hint when a fill reaches the edge of the plan, which usually means a gap in a wall. */
function edgeWarning(rooms: RoomLayer, id: number): string | null {
  const { width, height, labels } = rooms
  let edge = 0
  for (let x = 0; x < width; x++) edge += Number(labels[x] === id) + Number(labels[(height - 1) * width + x] === id)
  for (let y = 0; y < height; y++) edge += Number(labels[y * width] === id) + Number(labels[y * width + width - 1] === id)
  if (edge < Math.min(width, height) * 0.1) return null
  return 'This room reaches the edge of the plan. If it shouldn’t, a wall has a gap: close it in Walls, or draw a split line. Undo removes the fill.'
}

export type RoomEditor = ReturnType<typeof useRoomEditor>
