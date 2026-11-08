import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { saveVenue, savedScenarioId } from '../sim/savedVenues.ts'
import { useAuthFetch } from '../site/useAuthFetch.ts'
import { pushVenue } from '../site/venueSync.ts'
import type { Door } from './doors.ts'
import type { LoadedPlan } from './loadPlan.ts'
import { toScreen, type PlanCamera } from './planView.ts'
import type { RoomLayer } from './rooms.ts'
import { checkAndBuild, type CheckResult, type Problem } from './save.ts'
import type { Calibration } from '@crowd-control/contract'

type Inputs = {
  plan: LoadedPlan | null
  active: boolean
  readKinds: () => Uint8Array | null
  furnitureBlocks: boolean
  rooms: RefObject<RoomLayer | null>
  doors: Door[]
  calibration: Calibration | null
  redraw: () => void
}

/**
 * The Check & save step: when it opens, turn the tracing into the simulation grid and list
 * any problems; preview the grid over the plan; save the venue in this browser.
 */
export function useCheck({ plan, active, readKinds, furnitureBlocks, rooms, doors, calibration, redraw }: Inputs) {
  const [result, setResult] = useState<CheckResult | null>(null)
  const [preview, setPreview] = useState(true)
  const [focus, setFocus] = useState<Problem | null>(null)
  const [name, setName] = useState('')
  const [floor, setFloor] = useState('Ground floor')
  /** Saved here; `account` is null while saving to the account, then 'saved' or why it didn't. */
  const [saved, setSaved] = useState<{ scenario: string; account: 'saving' | 'saved' | { failed: string } } | null>(null)
  const authFetch = useAuthFetch()
  const [saveError, setSaveError] = useState<string | null>(null)
  const image = useRef<HTMLCanvasElement | null>(null)
  const live = useRef({ preview, focus, result })
  useEffect(() => { live.current = { preview, focus, result }; redraw() }, [preview, focus, result, redraw])

  // The venue is named after the file until the person types a name.
  // A reopened saved plan keeps its name and floor.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (plan?.seed) { setName(plan.fileName); setFloor(plan.seed.floor) }
    else if (plan) setName(plan.fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'My venue')
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [plan])

  const run = useCallback(() => {
    const kinds = readKinds(), layer = rooms.current
    if (!plan || !kinds || !layer) return
    const next = checkAndBuild({
      source: plan.source, width: plan.pixels.width, height: plan.pixels.height, kinds, furnitureBlocks,
      labels: layer.labels, rooms: layer.rooms, doors, calibration, name, floor, revision: `r${Date.now().toString(36)}`,
    })
    // A small canvas of the grid (one pixel per cell), stretched over the plan for the preview.
    const { grid } = next
    const canvas = document.createElement('canvas')
    canvas.width = grid.width
    canvas.height = grid.height
    const context = canvas.getContext('2d')!
    const pixels = context.createImageData(grid.width, grid.height)
    const colour = new Map(layer.rooms.map((room, k) => [k + 1, [1, 3, 5].map((i) => parseInt(room.color.slice(i, i + 2), 16))]))
    const exit = new Map(doors.map((door, k) => [k + 1, door.exit]))
    for (let c = 0; c < grid.blocked.length; c++) {
      const o = c * 4
      const [r, g, b, a] = grid.portalIndex[c]
        ? (exit.get(grid.portalIndex[c]!) ? [22, 163, 74, 220] : [234, 88, 12, 220])
        : grid.blocked[c] ? [30, 36, 32, 200]
        : [...(colour.get(grid.zoneIndex[c]!) ?? [200, 200, 200]), 120]
      pixels.data[o] = r!; pixels.data[o + 1] = g!; pixels.data[o + 2] = b!; pixels.data[o + 3] = a!
    }
    context.putImageData(pixels, 0, 0)
    image.current = canvas
    setResult(next)
    setFocus(null)
    setSaved(null)
    setSaveError(null)
    // name/floor only label the save; they don't change the check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, readKinds, furnitureBlocks, rooms, doors, calibration])

  // Opening the step checks the latest tracing. Only opening it: re-checking on every update
  // would also clear the "Saved" confirmation straight after saving.
  const runRef = useRef(run)
  useEffect(() => { runRef.current = run }, [run])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (active) runRef.current() }, [active])

  const save = () => {
    if (!result?.map) return
    const venue = { name: name.trim() || 'My venue', floor: floor.trim() || 'Ground floor', savedAt: new Date().toISOString(), map: result.map }
    const error = saveVenue(venue)
    setSaveError(error)
    if (error) return
    const scenario = savedScenarioId(venue)
    setSaved({ scenario, account: 'saving' })
    void pushVenue(authFetch, venue).then((failed) => {
      setSaved((current) => (current?.scenario === scenario ? { scenario, account: failed ? { failed } : 'saved' } : current))
    })
  }

  /** The simulation grid over the plan (when previewing), and a ring around the focused problem. */
  const drawOverlay = useCallback((context: CanvasRenderingContext2D, camera: PlanCamera) => {
    const { preview: on, focus: problem, result: checked } = live.current
    if (on && checked && image.current) {
      const cellPixels = checked.grid.cellSize / checked.worldPerPixel
      context.save()
      context.imageSmoothingEnabled = false
      context.drawImage(image.current, camera.offsetX, camera.offsetY, checked.grid.width * cellPixels * camera.scale, checked.grid.height * cellPixels * camera.scale)
      context.restore()
    }
    if (problem?.at) {
      const c = toScreen(camera, problem.at)
      context.save()
      context.lineWidth = 3
      context.strokeStyle = problem.severity === 'error' ? '#DC2626' : '#D97706'
      context.beginPath(); context.arc(c.x, c.y, 22, 0, Math.PI * 2); context.stroke()
      context.lineWidth = 1.5
      context.strokeStyle = '#ffffff'
      context.beginPath(); context.arc(c.x, c.y, 26, 0, Math.PI * 2); context.stroke()
      context.restore()
    }
  }, [])

  return { result, run, preview, setPreview, focus, setFocus, name, setName, floor, setFloor, save, saved, saveError, drawOverlay }
}

export type Check = ReturnType<typeof useCheck>
