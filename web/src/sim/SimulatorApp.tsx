import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  ChevronDown, ChevronLeft, ChevronRight, Flame, Maximize2, Minus, PanelsLeftRight,
  Pause, Play, Plus, RotateCcw, Shuffle, Siren, StepForward,
} from 'lucide-react'
import { RunReplaySchema, type Camera, type ModelPreset, type RunReplay, type ScenarioPlan, type Vec2 } from '@crowd-control/contract'
import examplePreset from '../../../contract/fixtures/compile-output.json'
import workedPlan from '../../../contract/fixtures/scenario-plan.json'
import type { AgentDrawMode } from '../render/agentStyle.ts'
import { CrowdRenderer, type BoxSelectMode } from '../render/renderer.ts'
import { createMockEndpoint } from '../worker/mockEndpoint.ts'
import { createRealEndpoint } from '../worker/realEndpoint.ts'
import { SimulationClient, type SimulationView } from '../worker/simulationClient.ts'
import { PlanSigns } from './PlanSigns.tsx'
import { StatusIcon } from './StatusIcon.tsx'
import { Timeline } from './Timeline.tsx'
import { formatClock, toIncidents, type Incident } from './incidents.ts'
import type { Pick, PickKind } from '../render/hitTest.ts'
import { ChangesList, MapToolbar, SelectionDetails, type MapTool } from './MapTools.tsx'
import { DensityPanel } from './DensityPanel.tsx'
import { actionFor, placeDanger, toggle as toggleIn, union, type MapAction } from './mapActions.ts'
import { PEDESTRIAN_PRESET, describeScenario, movementPreset, scenarios, startScenario, venueOptions, type Scenario } from './scenario.ts'
import { loadAssistant, saveScenarios } from './assistantStore.ts'
import { AssistantPanel } from './AssistantPanel.tsx'
import { loadSavedVenues, presetFor } from './savedVenues.ts'
import { AccountMenu, BrandMark, PageLinks } from '../site/Site.tsx'
import { useAuthFetch } from '../site/useAuthFetch.ts'
import { runIdentity } from './runNames.ts'
import { useRunSaving } from './useRunSaving.ts'
import { PointPins } from './PointPins.tsx'
import { loadPoints, nextPointId, pointsKeyForSource, savePoints, type MapPoint } from './points.ts'

/** What each tool can click: Select anything, Trip people, Doors doors, Point and Danger the floor. */
const PICKABLE: Record<MapTool, readonly PickKind[]> = { select: ['agent', 'object', 'portal', 'zone'], box: ['agent', 'object', 'portal', 'zone'], point: ['zone'], trip: ['agent'], doors: ['portal'], danger: ['zone'] }
/** Box always drags a selection box; Select does with Shift held; the others always pan. */
const BOX_MODE: Record<MapTool, BoxSelectMode> = { select: 'shift', box: 'always', point: 'off', trip: 'off', doors: 'off', danger: 'off' }
import './simulator.css'

const SPEEDS = [0.5, 1, 2, 4, 8]
const PAN_STEP_PX = 40
const MAP_FONT = "'DM Sans Variable', 'DM Sans', sans-serif"
/** Below this width the side panels overlay the map instead of sitting beside it. */
const WIDE = 1000
/** Floating layout, in CSS pixels; simulator.css uses the same numbers. */
const LAYOUT = { gap: 12, left: 320, right: 340, top: 52, bottom: 68 }

/** Screen edges covered by floating UI, so fitting centres the map in the visible space. */
function insetsFor(panels: Panels) {
  const wide = window.innerWidth >= WIDE
  return {
    top: LAYOUT.gap + LAYOUT.top,
    bottom: LAYOUT.gap * 2 + LAYOUT.bottom,
    left: wide && panels.left ? LAYOUT.gap * 2 + LAYOUT.left : 0,
    right: wide && panels.right ? LAYOUT.gap * 2 + LAYOUT.right : 0,
  }
}
/**
 * Demo plans compiled in the browser, until the planner supplies them: the Technical PRD §8
 * worked example (model units) and one per prepared venue (metres).
 */
const REAL_ENGINE = new URLSearchParams(window.location.search).get('engine') === 'real'
const SCENARIOS = scenarios(workedPlan as ScenarioPlan, REAL_ENGINE ? movementPreset(examplePreset.resolvedModel as ModelPreset) : examplePreset.resolvedModel as ModelPreset)
const SCENARIO_PARAM = 'scenario'
/** `/sim?replay=<run ID>` replays a saved run from Past runs. */
const REPLAY_PARAM = 'replay'
const ASSISTANT_PREFIX = 'assistant-'

/**
 * The model preset for a plan the assistant wrote: the worked example's body-width preset for
 * generated buildings, the pedestrian preset for metre venues, and whichever fits a saved floor plan.
 */
function presetForPlan(plan: ScenarioPlan): ModelPreset {
  const bodies = SCENARIOS[0]!.model
  if (plan.layout.mode === 'generate') return bodies
  if (plan.layout.mode === 'upload') {
    const { assetId } = plan.layout
    const venue = loadSavedVenues().find((saved) => saved.map.id === assetId)
    return venue ? presetFor(venue, PEDESTRIAN_PRESET, bodies) : PEDESTRIAN_PRESET
  }
  return PEDESTRIAN_PRESET
}
const UPLOAD_OPTION = '__upload'

/** The scenario named in the URL (`/sim?scenario=hillside-alley`), else the worked example. */
function initialScenarioId(): string {
  const requested = new URLSearchParams(window.location.search).get(SCENARIO_PARAM)
  const known = [...SCENARIOS, ...loadAssistant().scenarios]
  return known.some((scenario) => scenario.id === requested) ? requested! : SCENARIOS[0]!.id
}

/** Keeps the choice in the URL so a reload or a shared link opens the same venue. */
function rememberScenario(id: string) {
  const url = new URL(window.location.href)
  if (!id.startsWith('replay-')) url.searchParams.delete(REPLAY_PARAM)
  if (id === SCENARIOS[0]!.id) url.searchParams.delete(SCENARIO_PARAM)
  else url.searchParams.set(SCENARIO_PARAM, id)
  window.history.replaceState(window.history.state, '', url)
}

type Panels = { left: boolean; right: boolean }

const DRAW_MODE_KEY = 'crowd-control:draw-mode'

/** Remembered per viewer; storage can be unavailable (private mode), so failures fall back. */
function savedDrawMode(): AgentDrawMode {
  try {
    return window.localStorage.getItem(DRAW_MODE_KEY) === 'markers' ? 'markers' : 'people'
  } catch {
    return 'people'
  }
}

function saveDrawMode(mode: AgentDrawMode) {
  try {
    window.localStorage.setItem(DRAW_MODE_KEY, mode)
  } catch {
    // Not persisted; the toggle still works for this visit.
  }
}

const HEATMAP_KEY = 'crowd-control:heatmap'

/** The heatmap is on unless this viewer turned it off. */
function savedHeatmap(): boolean {
  try {
    return window.localStorage.getItem(HEATMAP_KEY) !== 'off'
  } catch {
    return true
  }
}

function saveHeatmap(on: boolean) {
  try {
    window.localStorage.setItem(HEATMAP_KEY, on ? 'on' : 'off')
  } catch {
    // Not persisted; the switch still works for this visit.
  }
}

export default function SimulatorApp() {
  // Keep mock demos available; /sim?engine=real uses the same client with Rust/Wasm.
  const [client] = useState(() => new SimulationClient(REAL_ENGINE ? createRealEndpoint() : createMockEndpoint()))
  const hostRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<CrowdRenderer | null>(null)
  const [camera, setCamera] = useState<Camera | null>(null)
  const [drawMode, setDrawMode] = useState<AgentDrawMode>(savedDrawMode)
  const [heatmap, setHeatmap] = useState(savedHeatmap)
  const heatmapRef = useRef(heatmap)
  const drawModeRef = useRef(drawMode)
  const panelsRef = useRef<Panels | null>(null)
  const [panels, setPanels] = useState<Panels>(() => {
    const wide = window.innerWidth >= WIDE
    return { left: wide, right: wide }
  })
  const view = useSyncExternalStore(client.subscribe, client.getView)
  const incidents = useMemo(() => toIncidents(view.events), [view.events])
  const now = view.current?.frame.time ?? 0
  const ready = view.current !== null
  const alarm = incidents.find((incident) => incident.title === 'Alarm')
  const toggle = (side: keyof Panels) => setPanels((p) => ({ ...p, [side]: !p[side] }))
  const anyPanelOpen = panels.left || panels.right
  /** Closes both panels for a clear view of the map; reopens both when both are closed. */
  const toggleBoth = () => setPanels((p) => {
    const open = !(p.left || p.right)
    return { left: open, right: open }
  })

  const [scenarioId, setScenarioId] = useState(initialScenarioId)
  /** Scenarios the assistant wrote in this visit; they join the picker. */
  const [assistantScenarios, setAssistantScenarios] = useState<Scenario[]>(() => loadAssistant().scenarios)
  useEffect(() => { saveScenarios(assistantScenarios) }, [assistantScenarios])

  // A replay of a saved run (from Past runs): its scenario, then its changes at the same moments.
  const authFetch = useAuthFetch()
  const [replay, setReplay] = useState<{ scenario: Scenario; changes: RunReplay['changes']; startedAt: string } | { error: string } | null>(null)
  useEffect(() => {
    const runId = new URLSearchParams(window.location.search).get(REPLAY_PARAM)
    if (!runId) return
    let cancelled = false
    void (async () => {
      try {
        const response = await authFetch(`/api/runs/${encodeURIComponent(runId)}/replay`)
        const payload = await response.json().catch(() => null) as { replay?: unknown; error?: string } | null
        if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`)
        const parsed = RunReplaySchema.safeParse(payload?.replay)
        if (!parsed.success) throw new Error('the saved run couldn’t be read')
        const saved = parsed.data
        // Older runs were saved without their scenario; the demos can still be found by name.
        const identity = runIdentity(saved.simulationId)
        const known = [...SCENARIOS, ...loadAssistant().scenarios].find((candidate) => candidate.id === identity.scenario || candidate.plan.simulationId === saved.simulationId)
        const plan = saved.plan ?? known?.plan
        if (!plan) throw new Error('this run was saved before runs kept their scenario, so it can’t be rebuilt')
        const title = saved.title ?? identity.title
        const scenario: Scenario = { id: `replay-${saved.runId}`, title: `Replay: ${title}`, plan, model: known && known.plan.simulationId === plan.simulationId ? known.model : presetForPlan(plan) }
        if (cancelled) return
        setReplay({ scenario, changes: saved.changes, startedAt: saved.startedAt })
        setScenarioId(scenario.id)
      } catch (error) {
        if (!cancelled) setReplay({ error: error instanceof Error ? error.message : 'something went wrong' })
      }
    })()
    return () => { cancelled = true }
  }, [authFetch])
  const replayScenarios = replay && 'scenario' in replay ? [replay.scenario] : []
  const scenario = [...SCENARIOS, ...assistantScenarios, ...replayScenarios].find((candidate) => candidate.id === scenarioId) ?? SCENARIOS[0]!
  const replaying = replay && 'scenario' in replay && replay.scenario.id === scenario.id ? replay : null
  // Runs save to the signed-in account as they play, for Past runs, with their title and scenario.
  const about = useMemo(() => ({ title: scenario.title, plan: scenario.plan }), [scenario])
  const save = useRunSaving(view, about)
  /** Seed for a varied generated layout (Technical PRD §10); null keeps the standard layout. */
  const [layoutSeed, setLayoutSeed] = useState<number | null>(null)
  const generated = scenario.plan.layout.mode === 'generate'
  // Compiled once per choice; switching scenarios or layouts loads a fresh simulation.
  const compiled = useMemo(() => layoutSeed === null
    ? startScenario(scenario.plan, scenario.model)
    : startScenario({ ...scenario.plan, seed: layoutSeed }, scenario.model, { varyLayout: true }), [scenario, layoutSeed])
  const scenarioDetail = !compiled.ok ? 'This plan could not be built'
    // A replay says what it replays: the saved changes, at the moments they first happened.
    : replaying ? `Replaying ${replaying.changes.length} ${replaying.changes.length === 1 ? 'change' : 'changes'} from ${new Date(replaying.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
    : describeScenario(compiled.value) + (layoutSeed === null ? '' : ` · layout ${layoutSeed}`)
  const chooseScenario = (id: string) => {
    setScenarioId(id)
    setLayoutSeed(null)
    setSelection([])
    rememberScenario(id)
  }
  /**
   * Runs a scenario the assistant wrote: compile it first, so a plan that can't be built is
   * reported in the chat instead of loaded; then add it to the picker and switch to it.
   */
  const runAssistantPlan = (plan: ScenarioPlan, title: string): { error: string } | { id: string } => {
    const model = presetForPlan(plan)
    const check = startScenario(plan, model)
    if (!check.ok) return { error: `This can’t be built: ${check.error.message}` }
    const id = `${ASSISTANT_PREFIX}${assistantScenarios.length + 1}`
    setAssistantScenarios((all) => [...all, { id, title: `Assistant: ${title}`, plan, model }])
    chooseScenario(id)
    return { id }
  }
  /** Test-builds a plan the assistant wrote, without loading it; returns why it can't be built. */
  const checkAssistantPlan = (plan: ScenarioPlan): string | null => {
    const check = startScenario(plan, presetForPlan(plan))
    return check.ok ? null : check.error.message
  }
  /** Venues a new scenario can use, and which one is loaded now (null for a made-up building). */
  const venues = useMemo(() => venueOptions(SCENARIOS[0]!.model), [])
  const layout = scenario.plan.layout
  const currentVenueId = layout.mode === 'lookup'
    ? venues.find((v) => v.layout.mode === 'lookup' && v.layout.venue === layout.venue && v.layout.floor === layout.floor)?.id ?? null
    : layout.mode === 'upload' ? layout.assetId : null

  /** Same description, a different building: the plan's seed first, then the next seeds in turn. */
  const nextLayout = () => {
    setLayoutSeed((seed) => (seed === null ? scenario.plan.seed : (seed + 1) >>> 0))
    setSelection([])
  }

  // Map tools: Select inspects; Trip and Doors change the simulation with one click.
  const [tool, setTool] = useState<MapTool>('select')
  const [selection, setSelection] = useState<readonly Pick[]>([])
  const toolRef = useRef(tool)

  // Points marked on this venue (A, B, C…), kept per venue in this browser for the assistant.
  const pointsKey = view.scene && view.simulationId ? pointsKeyForSource(view.scene.map.source, view.simulationId) : null
  const [pointsVersion, setPointsVersion] = useState(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const points = useMemo(() => loadPoints(pointsKey), [pointsKey, pointsVersion])
  const pointsRef = useRef({ key: pointsKey, points })
  useEffect(() => { pointsRef.current = { key: pointsKey, points } }, [pointsKey, points])
  const updatePoints = (key: string, next: MapPoint[]) => {
    savePoints(key, next)
    setPointsVersion((version) => version + 1)
  }
  const removePoint = (id: string) => {
    if (!pointsKey) return
    updatePoints(pointsKey, points.filter((p) => p.id !== id))
    setSelection((current) => current.filter((pick) => !(pick.kind === 'point' && pick.id === id)))
  }
  /** Applies a map action as a follow-up request; failures show in the event log. */
  const applyAction = (action: MapAction) => void client.apply(action.label, action.operations)
  /** What a click on the map does with the current tool. Read through a ref by the renderer. */
  const onPickRef = useRef<(pick: Pick | null, additive: boolean, at: Vec2) => void>(() => {})
  const onBoxRef = useRef<(picks: Pick[], additive: boolean) => void>(() => {})
  useEffect(() => {
    onPickRef.current = (pick, additive, at) => {
      if (toolRef.current === 'select' || toolRef.current === 'box') {
        // Shift-click adds or removes one item; a plain click replaces the selection.
        if (additive) { if (pick) setSelection((current) => toggleIn(current, pick)) }
        else setSelection(pick ? [pick] : [])
        return
      }
      const current = client.getView()
      if (toolRef.current === 'point') {
        // A point goes wherever the floor was clicked, with the next free letter; then it is selected.
        const { key, points: marked } = pointsRef.current
        if (pick?.kind !== 'zone' || !key) return
        const id = nextPointId(marked)
        updatePoints(key, [...marked, { id, x: Math.round(at.x * 100) / 100, y: Math.round(at.y * 100) / 100 }])
        setSelection([{ kind: 'point', id }])
        return
      }
      if (toolRef.current === 'danger') {
        // A danger goes wherever the floor was clicked; then it is selected, so its details show.
        if (pick?.kind !== 'zone' || !current.scene) return
        const action = placeDanger(current.scene, current.current?.frame ?? null, at)
        const added = action.operations[0]
        void client.apply(action.label, action.operations).then((result) => {
          if (result.ok && added?.op === 'add') setSelection([{ kind: 'object', id: added.entity.id }])
        })
        return
      }
      setSelection(pick ? [pick] : [])
      if (!pick || !current.scene) return
      const action = actionFor(toolRef.current as 'trip' | 'doors', current.scene, current.current?.frame ?? null, pick.kind, pick.id)
      if (action) void client.apply(action.label, action.operations)
    }
    // A box replaces the selection; with Shift held it adds to it.
    onBoxRef.current = (picks, additive) => setSelection((current) => (additive ? union(current, picks) : picks))
  }, [client])

  useEffect(() => {
    toolRef.current = tool
    rendererRef.current?.setPickable(PICKABLE[tool])
    rendererRef.current?.setBoxSelect(BOX_MODE[tool])
  }, [tool])

  useEffect(() => {
    rendererRef.current?.setSelection(selection)
  }, [selection])

  // Replaying: once the replayed scenario's run is ready (and again after each reset), its saved
  // changes are applied, each scheduled for the moment it originally took effect.
  const replayedStream = useRef<string | null>(null)
  const staleStream = useRef<string | null>(null)
  useEffect(() => {
    if (!replaying || !view.streamId || !ready || replayedStream.current === view.streamId || staleStream.current === view.streamId) return
    if (view.simulationId !== replaying.scenario.plan.simulationId) return
    replayedStream.current = view.streamId
    const start = client.getView().current?.frame.time ?? 0
    for (const change of replaying.changes) {
      void client.apply(change.label, change.operations, change.at > start + 0.05 ? change.at : undefined, change.prompt)
    }
  }, [client, replaying, ready, view.streamId, view.simulationId])

  useEffect(() => {
    // The stream showing before this load; until the new one arrives, it still belongs to the old scenario.
    staleStream.current = client.getView().streamId
    // A plan that fails to compile never reaches the worker; its error shows in the event log.
    if (compiled.ok) void client.load(compiled.value)
    else client.reportError(compiled.error)
    // Pausing stops the playback timer; the client stays usable if React remounts (StrictMode).
    return () => void client.pause().catch(() => {})
  }, [client, compiled])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let renderer: CrowdRenderer | null = null
    let stopCamera = () => {}
    let stopPick = () => {}
    let stopBox = () => {}
    void CrowdRenderer.create(host, client, { fontFamily: MAP_FONT, zoneTint: 0.4, paddingPx: 40, agentDrawMode: drawModeRef.current }).then((created) => {
      if (cancelled) {
        created.destroy()
        return
      }
      renderer = created
      rendererRef.current = created
      stopCamera = created.onCameraChange(setCamera)
      stopPick = created.onPick((pick, additive, at) => onPickRef.current(pick, additive, at))
      stopBox = created.onBoxSelect((picks, additive) => onBoxRef.current(picks, additive))
      created.setPickable(PICKABLE[toolRef.current])
      created.setBoxSelect(BOX_MODE[toolRef.current])
      created.setHeatmap(heatmapRef.current)
      if (panelsRef.current) created.setInsets(insetsFor(panelsRef.current))
    })
    return () => {
      cancelled = true
      stopCamera()
      stopPick()
      stopBox()
      renderer?.destroy()
      rendererRef.current = null
    }
  }, [client])

  // Panels float over the map; the map glides to stay centred in the space they leave.
  useEffect(() => {
    panelsRef.current = panels
    const apply = () => rendererRef.current?.setInsets(insetsFor(panels))
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [panels])

  useEffect(() => {
    drawModeRef.current = drawMode
    rendererRef.current?.setAgentDrawMode(drawMode)
    saveDrawMode(drawMode)
  }, [drawMode])

  useEffect(() => {
    heatmapRef.current = heatmap
    rendererRef.current?.setHeatmap(heatmap)
    saveHeatmap(heatmap)
  }, [heatmap])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest('input, select, textarea, [contenteditable="true"]')) return
      // A focused button or disclosure keeps Space/Enter for itself; other shortcuts still work.
      if ((event.key === ' ' || event.key === 'Enter') && target?.closest('button, summary')) return
      const renderer = rendererRef.current
      const handled = (() => {
        switch (event.key) {
          case ' ': void (client.getView().playing ? client.pause() : client.play()); return true
          case '.': void client.step(1); return true
          case 'r': case 'R': void client.reset(); return true
          case '[': setPanels((p) => ({ ...p, left: !p.left })); return true
          case ']': setPanels((p) => ({ ...p, right: !p.right })); return true
          case '\\': setPanels((p) => { const open = !(p.left || p.right); return { left: open, right: open } }); return true
          case 'v': case 'V': setTool('select'); return true
          case 'b': case 'B': setTool('box'); return true
          case 'f': case 'F': setTool('trip'); return true
          case 'd': case 'D': setTool('doors'); return true
          case 'x': case 'X': setTool('danger'); return true
          case 'p': case 'P': setTool('point'); return true
          case 'h': case 'H': setHeatmap((on) => !on); return true
          case 'Escape':
            if (window.innerWidth >= WIDE) { setSelection([]); return true }
            setPanels({ left: false, right: false })
            return true
          case '+': case '=': renderer?.zoom(1.25); return true
          case '-': case '_': renderer?.zoom(1 / 1.25); return true
          case '0': renderer?.resetCamera(); return true
          case 'ArrowLeft': renderer?.pan({ x: PAN_STEP_PX, y: 0 }); return true
          case 'ArrowRight': renderer?.pan({ x: -PAN_STEP_PX, y: 0 }); return true
          case 'ArrowUp': renderer?.pan({ x: 0, y: PAN_STEP_PX }); return true
          case 'ArrowDown': renderer?.pan({ x: 0, y: -PAN_STEP_PX }); return true
          default: return false
        }
      })()
      if (handled) event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [client])

  return (
    <div className={`sim${panels.left ? ' has-left' : ''}${panels.right ? ' has-right' : ''}`}>
      <div className="sim-stage">
        <div className="sim-canvas" ref={hostRef}>
          {!ready && <p className="sim-loading">Loading the venue…</p>}
        </div>
        <PlanSigns scene={view.scene} frame={view.current?.frame ?? null} camera={camera} incidents={incidents} now={now} />
        <PointPins points={points} camera={camera} selected={selection.length === 1 && selection[0]!.kind === 'point' ? selection[0]!.id : null}
          onSelect={(id) => setSelection([{ kind: 'point', id }])} />
      </div>

      <header className="sim-float sim-topbar">
        <p className="sim-brand"><BrandMark /> Crowd Control</p>
        <div className="sim-scenario">
          <label className="sim-scenario-picker">
            <span className="visually-hidden">Scenario</span>
            <select value={scenarioId} onChange={(event) => {
              // The last entry opens the floor-plan editor instead of a scenario.
              if (event.target.value === UPLOAD_OPTION) window.location.assign('/editor')
              else chooseScenario(event.target.value)
            }}>
              {SCENARIOS.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}
              {assistantScenarios.length > 0 && (
                <optgroup label="From the assistant">
                  {assistantScenarios.map((option) => <option key={option.id} value={option.id}>{option.title.replace(/^Assistant: /, '')}</option>)}
                </optgroup>
              )}
              {replayScenarios.length > 0 && (
                <optgroup label="Replay from Past runs">
                  {replayScenarios.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}
                </optgroup>
              )}
              <option value={UPLOAD_OPTION}>New floor plan…</option>
            </select>
            <ChevronDown size={14} strokeWidth={2.25} aria-hidden="true" />
          </label>
          {generated && (
            <button type="button" className="sim-icon-btn" onClick={nextLayout}
              aria-label="New layout" title="New layout: same description, a different building">
              <Shuffle size={14} />
            </button>
          )}
          <span className="sim-scenario-detail" title={scenarioDetail}>{scenarioDetail}</span>
        </div>
        {alarm && (
          <p className="sim-tag sim-tag-alarm" role="status">
            <Siren size={13} strokeWidth={2.25} aria-hidden="true" /> Alarm at {formatClock(alarm.time, false)}
          </p>
        )}
        {replay && 'error' in replay && <p className="sim-tag sim-tag-alarm" role="alert">Couldn’t replay that run: {replay.error}</p>}
        {view.endpointKind === 'real' && <p className="sim-tag" title="Running on the Rust engine preview (movement only)">Engine preview</p>}
        <PageLinks />
        <AccountMenu save={save} />
      </header>

      <MapToolbar tool={tool} onTool={setTool} />

      <div className="sim-float sim-draw-mode" role="radiogroup" aria-label="Show people as">
        {(['people', 'markers'] as const).map((mode) => (
          <button key={mode} type="button" role="radio" aria-checked={drawMode === mode} onClick={() => setDrawMode(mode)}>
            {mode === 'people' ? 'People' : 'Markers'}
          </button>
        ))}
      </div>

      <div className="sim-float sim-zoom" role="group" aria-label="Zoom">
        <button type="button" className="sim-icon-btn" aria-label="Zoom in" aria-keyshortcuts="+" onClick={() => rendererRef.current?.zoom(1.25)}><Plus size={15} /></button>
        <button type="button" className="sim-icon-btn" aria-label="Zoom out" aria-keyshortcuts="-" onClick={() => rendererRef.current?.zoom(1 / 1.25)}><Minus size={15} /></button>
        <button type="button" className="sim-icon-btn" aria-label="Fit map to view" aria-keyshortcuts="0" onClick={() => rendererRef.current?.resetCamera()}><Maximize2 size={14} /></button>
        <span className="sim-zoom-divider" aria-hidden="true" />
        <button type="button" className="sim-icon-btn" aria-pressed={heatmap} aria-keyshortcuts="H" onClick={() => setHeatmap((on) => !on)}
          aria-label={heatmap ? 'Hide density heatmap' : 'Show density heatmap'} title={heatmap ? 'Hide density heatmap (H)' : 'Show density heatmap (H)'}>
          <Flame size={15} />
        </button>
        <button type="button" className="sim-icon-btn" aria-pressed={!anyPanelOpen} aria-keyshortcuts="\" onClick={toggleBoth}
          aria-label={anyPanelOpen ? 'Hide both panels' : 'Show both panels'} title={anyPanelOpen ? 'Hide both panels' : 'Show both panels'}>
          <PanelsLeftRight size={15} />
        </button>
      </div>

      <PlaybackBar client={client} view={view} ready={ready} now={now} incidents={incidents} />

      <SidePanel side="left" open={panels.left} title="Assistant" onToggle={() => toggle('left')}>
        <AssistantPanel key={scenario.id} scenarioId={scenario.id} scenarioTitle={scenario.title.replace(/^Assistant: /, '')} client={client} view={view} venues={venues} currentVenueId={currentVenueId} onCheckPlan={checkAssistantPlan} onRunPlan={runAssistantPlan} />
      </SidePanel>

      <SidePanel side="right" open={panels.right} title="Simulation" onToggle={() => toggle('right')}>
        <Overview view={view} />
        <Section title="Selected">
          <SelectionDetails selection={selection} view={view} plan={compiled.ok ? scenario.plan : null} points={points} onAction={applyAction} onClear={() => setSelection([])} onRemovePoint={removePoint} />
        </Section>
        <Section title="Density">
          <DensityPanel view={view} on={heatmap} onToggle={() => setHeatmap((on) => !on)} />
        </Section>
        <EventLog incidents={incidents} error={view.lastError} />
        <Section title="Changes">
          <ChangesList changes={view.changes} />
        </Section>
        <Legend />
      </SidePanel>

      <button type="button" className="sim-scrim" aria-label="Close panels" tabIndex={-1}
        onClick={() => setPanels({ left: false, right: false })} />
    </div>
  )
}

/**
 * A floating, full-height panel with one handle at its vertical middle. Open, the handle
 * sits on the panel's inner edge and closes it; closed, the same handle waits at the screen
 * edge and reopens it ([ and ] too). It slides with the panel, so it is always in one place.
 */
function SidePanel({ side, open, title, onToggle, children }: {
  side: 'left' | 'right'; open: boolean; title: string; onToggle: () => void; children: ReactNode
}) {
  // The arrow points where the panel will go: toward the edge to close, away from it to open.
  const Icon = (side === 'left') === open ? ChevronLeft : ChevronRight
  return (
    <>
      <aside className={`sim-float sim-panel sim-panel-${side}`} aria-label={title} inert={!open}>
        <header className="sim-panel-head"><h2>{title}</h2></header>
        <div className="sim-panel-body">{children}</div>
      </aside>
      <button type="button" className={`sim-handle sim-handle-${side}`} onClick={onToggle} aria-expanded={open}
        aria-label={`${open ? 'Hide' : 'Show'} ${title.toLowerCase()}`} aria-keyshortcuts={side === 'left' ? '[' : ']'}>
        <Icon size={14} strokeWidth={2.25} aria-hidden="true" />
      </button>
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sim-section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function Overview({ view }: { view: SimulationView }) {
  // Count from the live frame, published with the events, so the numbers and the log agree.
  const agents = view.current?.frame.agents ?? []
  const departed = agents.filter((agent) => agent.state === 'departed').length
  const down = agents.filter((agent) => agent.state === 'immobile').length
  const inside = agents.length - departed
  return (
    <Section title="Overview">
      <dl className="sim-stats">
        <div><dt>Inside</dt><dd>{inside}</dd></div>
        <div><dt>Left</dt><dd>{departed}</dd></div>
        <div><dt>Down</dt><dd className={down > 0 ? 'is-warning' : undefined}>{down}</dd></div>
      </dl>
      {departed > 0 && (
        <p className="sim-stat-note">
          {down > 0 ? <><StatusIcon kind="warning" size={18} /> Evacuation incomplete: {down} still down inside</>
            : inside === 0 ? <><StatusIcon kind="exit" size={18} /> Everyone is out</>
            : <><StatusIcon kind="exit" size={18} /> Leaving in progress</>}
        </p>
      )}
    </Section>
  )
}

function EventLog({ incidents, error }: { incidents: Incident[]; error: SimulationView['lastError'] }) {
  const recent = incidents.slice(-40).reverse()
  return (
    <Section title="Events">
      {error && <p className="sim-error" role="alert"><StatusIcon kind="closed" size={18} /> {error.message}</p>}
      {recent.length === 0 ? (
        <p className="sim-muted">Nothing yet. Falls, closures and arrivals appear here as they happen.</p>
      ) : (
        <ol className="sim-events">
          {recent.map((incident) => (
            <li key={incident.id}>
              <StatusIcon kind={incident.sign} size={22} />
              <span className="sim-event-text">
                <span className="sim-event-title">{incident.title}</span>
                <span className="sim-muted">
                  {[incident.detail, incident.time > incident.startTime ? `until ${formatClock(incident.time, false)}` : null].filter(Boolean).join(' · ')}
                </span>
              </span>
              <time>{formatClock(incident.startTime, false)}</time>
            </li>
          ))}
        </ol>
      )}
    </Section>
  )
}

function Legend() {
  return (
    <details className="sim-section sim-legend">
      <summary>Legend and shortcuts</summary>
      <ul className="sim-legend-list">
        <li><MapSwatch kind="person" /> People (figure or marker), colour by group</li>
        <li><MapSwatch kind="left" /> Left the venue (faded)</li>
        <li><MapSwatch kind="down" /> Down (lying figure or capsule)</li>
        <li><MapSwatch kind="open" /> Open door</li>
        <li><MapSwatch kind="closed" /> Closed door</li>
        <li><MapSwatch kind="service" /> Something people use (table, counter, desk): click for details</li>
        <li><MapSwatch kind="danger" /> Danger: people nearby keep away</li>
        <li><StatusIcon kind="exit" size={18} /> Exit or safe</li>
        <li><StatusIcon kind="warning" size={18} /> Fall or hazard</li>
        <li><StatusIcon kind="closed" size={18} /> Closure or alarm</li>
        <li><StatusIcon kind="instruction" size={18} /> Scheduled change</li>
      </ul>
      <dl className="sim-shortcuts">
        <div><dt><kbd>Space</kbd></dt><dd>Play or pause</dd></div>
        <div><dt><kbd>.</kbd></dt><dd>Step one tick</dd></div>
        <div><dt><kbd>R</kbd></dt><dd>Reset</dd></div>
        <div><dt><kbd>[</kbd> <kbd>]</kbd></dt><dd>Toggle side panels</dd></div>
        <div><dt><kbd>\</kbd></dt><dd>Hide or show both panels</dd></div>
        <div><dt><kbd>+</kbd> <kbd>−</kbd> <kbd>0</kbd></dt><dd>Zoom in, out, fit</dd></div>
        <div><dt>Arrows, drag</dt><dd>Pan the map</dd></div>
        <div><dt><kbd>V</kbd> <kbd>B</kbd> <kbd>P</kbd></dt><dd>Select, Box, Point</dd></div>
        <div><dt><kbd>F</kbd> <kbd>D</kbd> <kbd>X</kbd></dt><dd>Trip, Doors, Danger</dd></div>
      </dl>
    </details>
  )
}

/** Legend swatches for the map's own cues, drawn to match what the canvas paints. */
function MapSwatch({ kind }: { kind: 'person' | 'left' | 'down' | 'open' | 'closed' | 'service' | 'danger' }) {
  const box = { width: 18, height: 18, viewBox: '0 0 18 18', 'aria-hidden': true, focusable: false } as const
  switch (kind) {
    case 'person':
      return (
        <svg width={34} height={18} viewBox="0 0 34 18" aria-hidden focusable={false}>
          <rect x="5" y="6" width="5" height="7" rx="2" fill="#397B58" />
          <circle cx="7.5" cy="3.6" r="2.2" fill="#D6A37C" />
          <path d="M6 13l-1 4M9 13l1 4" stroke="#405052" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="24" cy="9" r="6" fill="#5C83B4" stroke="#FCFCF9" strokeWidth="1.5" />
          <path d="M29 9l-3.2-2.3v4.6z" fill="#FCFCF9" />
        </svg>
      )
    case 'left':
      return <svg {...box}><circle cx="9" cy="9" r="6" fill="#397B58" opacity="0.45" /></svg>
    case 'down':
      return <svg {...box}><rect x="2" y="6" width="14" height="6" rx="3" fill="#397B58" stroke="#C08A3E" strokeWidth="1.5" /></svg>
    case 'open':
      return <svg {...box}><rect x="1" y="1" width="16" height="16" rx="3" fill="#B9D6AE" /></svg>
    case 'closed':
      return <svg {...box}><rect x="1" y="1" width="16" height="16" rx="3" fill="#BB6479" /><path d="M6 6l6 6M12 6l-6 6" stroke="#FFFFFF" strokeWidth="1.75" /></svg>
    case 'service':
      return <svg {...box}><circle cx="9" cy="9" r="7" fill="#2F6FEB" stroke="#FFFFFF" strokeWidth="1.5" /><path d="M9 8v4.5" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" /><circle cx="9" cy="5.6" r="1.1" fill="#FFFFFF" /></svg>
    case 'danger':
      return <svg {...box}><circle cx="9" cy="9" r="7.5" fill="#DC2626" fillOpacity="0.35" stroke="#B91C1C" strokeWidth="1.5" /><path d="M9 5v5" stroke="#B91C1C" strokeWidth="1.8" strokeLinecap="round" /><circle cx="9" cy="12.8" r="1.1" fill="#B91C1C" /></svg>
  }
}

function PlaybackBar({ client, view, ready, now, incidents }: {
  client: SimulationClient; view: SimulationView; ready: boolean; now: number; incidents: Incident[]
}) {
  return (
    <section className="sim-float sim-playback" aria-label="Playback and timeline">
      <div className="sim-transport" role="toolbar" aria-label="Playback">
        <button type="button" className="sim-play" disabled={!ready} aria-pressed={view.playing} aria-keyshortcuts="Space"
          onClick={() => void (view.playing ? client.pause() : client.play())}>
          {view.playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
          {view.playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="sim-icon-btn" disabled={!ready || view.playing} aria-label="Step one tick" aria-keyshortcuts="."
          onClick={() => void client.step(1)}><StepForward size={16} /></button>
        <button type="button" className="sim-icon-btn" disabled={!ready} aria-label="Reset" aria-keyshortcuts="R"
          onClick={() => void client.reset()}><RotateCcw size={15} /></button>
        <div className="sim-speed" role="radiogroup" aria-label="Speed">
          {SPEEDS.map((speed) => (
            <button key={speed} type="button" role="radio" aria-checked={view.speed === speed} disabled={!ready}
              onClick={() => void client.setSpeed(speed)}>{speed}×</button>
          ))}
        </div>
      </div>
      <p className="sim-clock" aria-label={`Simulation time ${formatClock(now)}`}>{formatClock(now)}</p>
      <Timeline now={now} incidents={incidents} />
    </section>
  )
}
