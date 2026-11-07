import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { LoadedPlan } from './loadPlan.ts'
import { toScreen, type PlanCamera } from './planView.ts'
import type { StrokeHandlers } from './PlanCanvas.tsx'
import { doorAcross, findOpenings, reconcileDoors, roomsWithoutDoors, type Door, type PixelRect } from './doors.ts'
import type { RoomLayer } from './rooms.ts'

export type DoorTool = 'select' | 'add' | 'move'
type Point = { x: number; y: number }

/** Openings wider than this are open boundaries between areas rather than doorways. */
export const OPEN_BOUNDARY_METRES = 2.5
/** Narrower than a person's shoulders: flagged for review. */
export const NARROW_METRES = 0.6

/**
 * The Doors step: detect every opening between rooms when the step opens, keep the person's
 * choices (exit, one-way, closed, deleted) across re-detection, add doors by hand, undo/redo,
 * and draw doors over the plan in the PRD's orange.
 */
export function useDoorEditor(plan: LoadedPlan | null, active: boolean, rooms: RefObject<RoomLayer | null>, metresPerPixel: number | null, redraw: () => void, cameraOf: () => PlanCamera | null) {
  const [doors, setDoors] = useState<Door[]>([])
  const [dismissed, setDismissed] = useState<PixelRect[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [tool, setTool] = useState<DoorTool>('select')
  const [warning, setWarning] = useState<string | null>(null)
  const history = useRef<{ done: { doors: Door[]; dismissed: PixelRect[] }[]; undone: { doors: Door[]; dismissed: PixelRect[] }[] }>({ done: [], undone: [] })
  const nextId = useRef(1)
  const live = useRef({ doors, selected, tool })
  const pointer = useRef<{ anchor: Point | null; line: Point | null }>({ anchor: null, line: null })
  useEffect(() => { live.current = { doors, selected, tool }; redraw() }, [doors, selected, tool, redraw])

  // A new plan starts with no doors.
  useEffect(() => {
    history.current = { done: [], undone: [] }
    /* eslint-disable react-hooks/set-state-in-effect */
    setDoors([])
    setDismissed([])
    setSelected(null)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [plan])

  // Opening the step re-detects openings (rooms may have changed), keeping the person's choices.
  useEffect(() => {
    const layer = rooms.current
    if (!active || !layer) return
    const openings = findOpenings(layer.labels, layer.width, layer.height)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDoors((current) => reconcileDoors(current, openings, dismissed, layer.rooms, () => nextId.current++))
    // Only on opening the step; later edits go through the actions below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const commit = (next: Door[], nextDismissed = dismissed) => {
    history.current.done.push({ doors, dismissed })
    history.current.undone = []
    setDoors(next)
    setDismissed(nextDismissed)
  }
  const update = (id: number, patch: Partial<Door>) => commit(doors.map((door) => (door.id === id ? { ...door, ...patch } : door)))
  const remove = (id: number) => {
    const door = doors.find((d) => d.id === id)
    if (!door) return
    commit(doors.filter((d) => d.id !== id), door.detected ? [...dismissed, door.rect] : dismissed)
    setSelected(null)
  }
  /** Swaps a door's direction (which way a one-way door lets people through). */
  const reverse = (id: number) => {
    const door = doors.find((d) => d.id === id)
    if (door) update(id, { from: door.to, to: door.from })
  }
  const step = (from: 'done' | 'undone', to: 'done' | 'undone') => {
    const state = history.current[from].pop()
    if (!state) return
    history.current[to].push({ doors, dismissed })
    setDoors(state.doors)
    setDismissed(state.dismissed)
  }

  const thickness = metresPerPixel ? 0.3 / metresPerPixel : 6
  const stroke: StrokeHandlers = useMemo(() => ({
    start: (point) => { pointer.current = { anchor: point, line: null } },
    move: (point) => {
      if (live.current.tool !== 'add' || !pointer.current.anchor) return
      pointer.current.line = point
      redraw()
    },
    end: (point) => {
      const anchor = pointer.current.anchor
      pointer.current = { anchor: null, line: null }
      const layer = rooms.current
      if (!anchor || !layer) return
      if (live.current.tool === 'select') {
        const camera = cameraOf()
        const slop = camera ? 6 / camera.scale : 3
        const hit = live.current.doors.find((d) => point.x >= d.rect.x - slop && point.x <= d.rect.x + d.rect.width + slop && point.y >= d.rect.y - slop && point.y <= d.rect.y + d.rect.height + slop)
        setSelected(hit?.id ?? null)
        return
      }
      if (live.current.tool !== 'add') return
      const added = doorAcross(anchor, point, thickness, layer.labels, layer.width, layer.height)
      if (!added) {
        setWarning('A door has to cross from one room into another. Drag across the wall or gap between two rooms.')
        redraw()
        return
      }
      setWarning(null)
      const outside = new Set(layer.rooms.filter((r) => r.tags.includes('outside')).map((r) => r.id))
      const [from, to] = outside.has(added.rooms[0]) ? [added.rooms[1], added.rooms[0]] : added.rooms
      const door: Door = {
        id: nextId.current++, from, to, rect: added.rect, length: Math.max(added.rect.width, added.rect.height),
        detected: false, exit: outside.has(to) && !outside.has(from), oneWay: false, open: true,
      }
      history.current.done.push({ doors: live.current.doors, dismissed })
      history.current.undone = []
      setDoors([...live.current.doors, door])
      setSelected(door.id)
    },
    // Reads live state through refs; `dismissed` is captured for the undo entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [redraw, cameraOf, thickness, dismissed])

  /** Doors in orange (exits green, closed ones dashed rose), the selected one in blue, one-way arrows, and the add-door preview. */
  const drawOverlay = useCallback((context: CanvasRenderingContext2D, camera: PlanCamera) => {
    const layer = rooms.current
    const { doors: all, selected: chosen } = live.current
    context.save()
    for (const door of all) {
      const a = toScreen(camera, door.rect)
      const w = Math.max(3, door.rect.width * camera.scale), h = Math.max(3, door.rect.height * camera.scale)
      const colour = !door.open ? '#BB6479' : door.exit ? '#16A34A' : '#EA580C'
      context.fillStyle = colour
      context.globalAlpha = 0.6
      context.fillRect(a.x, a.y, w, h)
      context.globalAlpha = 1
      context.setLineDash(door.open ? [] : [4, 3])
      context.lineWidth = door.id === chosen ? 3 : 1.5
      context.strokeStyle = door.id === chosen ? '#2F6FEB' : colour
      context.strokeRect(a.x - 1.5, a.y - 1.5, w + 3, h + 3)
      context.setLineDash([])
      if (door.oneWay && layer) drawArrow(context, camera, door, layer)
    }
    const { anchor, line } = pointer.current
    if (anchor && line) {
      const p = toScreen(camera, anchor), q = toScreen(camera, line)
      context.setLineDash([6, 4])
      context.lineWidth = 2.5
      context.strokeStyle = '#EA580C'
      context.beginPath(); context.moveTo(p.x, p.y); context.lineTo(q.x, q.y); context.stroke()
    }
    context.restore()
  }, [rooms])

  const width = (door: Door) => (metresPerPixel ? door.length * metresPerPixel : null)
  const layer = rooms.current
  const nameOf = (id: number) => layer?.rooms.find((room) => room.id === id)?.label ?? 'Room'
  const isolated = layer ? roomsWithoutDoors(layer.rooms, doors).map(nameOf) : []

  return {
    doors, selected, setSelected, tool, setTool, warning, width, nameOf, isolated,
    update, remove, reverse, undo: () => step('done', 'undone'), redo: () => step('undone', 'done'),
    canUndo: history.current.done.length > 0, canRedo: history.current.undone.length > 0,
    stroke, drawOverlay,
  }
}

/** An arrow across a one-way door, pointing from its `from` room into its `to` room. */
function drawArrow(context: CanvasRenderingContext2D, camera: PlanCamera, door: Door, layer: RoomLayer) {
  const { rect } = door
  const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  // Across the opening: a tall opening is crossed left-right, a wide one top-bottom.
  const across = rect.height >= rect.width ? { x: 1, y: 0 } : { x: 0, y: 1 }
  const sample = (k: number) => {
    const x = Math.round(centre.x + across.x * k), y = Math.round(centre.y + across.y * k)
    return x >= 0 && y >= 0 && x < layer.width && y < layer.height ? layer.labels[y * layer.width + x] : 0
  }
  // Which side the `from` room is on.
  let sign = 1
  for (let k = 1; k < 40; k++) {
    if (sample(-k) === door.from || sample(k) === door.to) { sign = 1; break }
    if (sample(k) === door.from || sample(-k) === door.to) { sign = -1; break }
  }
  const c = toScreen(camera, centre)
  const length = 16
  const dx = across.x * sign, dy = across.y * sign
  const tail = { x: c.x - dx * length, y: c.y - dy * length }, head = { x: c.x + dx * length, y: c.y + dy * length }
  context.strokeStyle = '#1E2420'
  context.fillStyle = '#1E2420'
  context.lineWidth = 2.5
  context.beginPath(); context.moveTo(tail.x, tail.y); context.lineTo(head.x, head.y); context.stroke()
  context.beginPath()
  context.moveTo(head.x + dx * 6, head.y + dy * 6)
  context.lineTo(head.x - dy * 6 - dx * 2, head.y + dx * 6 - dy * 2)
  context.lineTo(head.x + dy * 6 - dx * 2, head.y - dx * 6 - dy * 2)
  context.closePath()
  context.fill()
}

export type DoorEditor = ReturnType<typeof useDoorEditor>
