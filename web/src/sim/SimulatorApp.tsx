import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/manrope'
import {
  ChevronLeft, ChevronRight, Maximize2, Minus, PanelsLeftRight,
  Pause, Play, Plus, RotateCcw, SendHorizontal, Siren, StepForward,
} from 'lucide-react'
import type { Camera, ModelPreset } from '@crowd-control/contract'
import examplePreset from '../../../contract/fixtures/compile-output.json'
import workedPlan from '../../../contract/fixtures/scenario-plan.json'
import type { AgentDrawMode } from '../render/agentStyle.ts'
import { CrowdRenderer } from '../render/renderer.ts'
import { createMockEndpoint } from '../worker/mockEndpoint.ts'
import { SimulationClient, type SimulationView } from '../worker/simulationClient.ts'
import { PlanSigns } from './PlanSigns.tsx'
import { StatusIcon } from './StatusIcon.tsx'
import { Timeline } from './Timeline.tsx'
import { formatClock, toIncidents, type Incident } from './incidents.ts'
import { describeScenario, startScenario } from './scenario.ts'
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
 * The Technical PRD §8 plan, compiled in the browser on load, until the planner and prepared
 * venues supply plans. The preset is the fixture's example preset (model units, not metres).
 */
const SCENARIO = { title: 'Worked example', plan: workedPlan as unknown, model: examplePreset.resolvedModel as ModelPreset }
const SUGGESTIONS = ['Close the hall door for 30 seconds', 'Someone trips in the foyer', 'Why did people queue at the exit?']

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

export default function SimulatorApp() {
  // One endpoint and client per page. The mock is swapped for the real Wasm adapter here later.
  const [client] = useState(() => new SimulationClient(createMockEndpoint()))
  const hostRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<CrowdRenderer | null>(null)
  const [camera, setCamera] = useState<Camera | null>(null)
  const [drawMode, setDrawMode] = useState<AgentDrawMode>(savedDrawMode)
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

  // Compiled once per page; the plan is fixed until the planner can replace it.
  const [compiled] = useState(() => startScenario(SCENARIO.plan, SCENARIO.model))
  const scenarioDetail = compiled.ok ? describeScenario(compiled.value) : 'This plan could not be built'

  useEffect(() => {
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
    void CrowdRenderer.create(host, client, { fontFamily: MAP_FONT, zoneTint: 0.4, paddingPx: 40, agentDrawMode: drawModeRef.current }).then((created) => {
      if (cancelled) {
        created.destroy()
        return
      }
      renderer = created
      rendererRef.current = created
      stopCamera = created.onCameraChange(setCamera)
      if (panelsRef.current) created.setInsets(insetsFor(panelsRef.current))
    })
    return () => {
      cancelled = true
      stopCamera()
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
          case 'Escape':
            if (window.innerWidth >= WIDE) return false
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
      </div>

      <header className="sim-float sim-topbar">
        <p className="sim-brand"><BrandMark /> Crowd Control</p>
        <p className="sim-scenario"><span>{SCENARIO.title}</span> · {scenarioDetail}</p>
        {alarm && (
          <p className="sim-tag sim-tag-alarm" role="status">
            <Siren size={13} strokeWidth={2.25} aria-hidden="true" /> Alarm at {formatClock(alarm.time, false)}
          </p>
        )}
        {view.endpointKind === 'mock' && <p className="sim-tag" title="Driven by the development mock worker, not the simulation engine">Mock data</p>}
      </header>

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
        <button type="button" className="sim-icon-btn" aria-pressed={!anyPanelOpen} aria-keyshortcuts="\" onClick={toggleBoth}
          aria-label={anyPanelOpen ? 'Hide both panels' : 'Show both panels'} title={anyPanelOpen ? 'Hide both panels' : 'Show both panels'}>
          <PanelsLeftRight size={15} />
        </button>
      </div>

      <PlaybackBar client={client} view={view} ready={ready} now={now} incidents={incidents} />

      <SidePanel side="left" open={panels.left} title="Assistant" onToggle={() => toggle('left')}>
        <ChatPlaceholder />
      </SidePanel>

      <SidePanel side="right" open={panels.right} title="Simulation" onToggle={() => toggle('right')}>
        <Overview view={view} />
        <Section title="Density">
          <p className="sim-muted">
            {view.scene?.map.units === 'm'
              ? 'The density heatmap arrives with the simulation engine.'
              : 'This plan is not to scale, so density can’t be shown in people per m². The heatmap appears on metre-scaled venues once the engine is connected.'}
          </p>
        </Section>
        <EventLog incidents={incidents} error={view.lastError} />
        <Section title="Changes">
          <p className="sim-muted">No changes yet. Changes from the assistant or the map are listed here with edit and undo.</p>
        </Section>
        <Legend />
      </SidePanel>

      <button type="button" className="sim-scrim" aria-label="Close panels" tabIndex={-1}
        onClick={() => setPanels({ left: false, right: false })} />
    </div>
  )
}

/** Benito's landing mark: six pill-shaped people leaning into motion. */
function BrandMark() {
  return <span className="sim-brand-mark" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
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

function ChatPlaceholder() {
  return (
    <div className="sim-chat">
      <div className="sim-chat-empty">
        <p className="sim-chat-title">Talk to the simulation</p>
        <p className="sim-muted">Describe a change or ask why something happened. Every change appears as a preview you can apply or edit.</p>
        <ul className="sim-suggestions" aria-label="Example requests">
          {SUGGESTIONS.map((text) => (
            <li key={text}><span className="sim-prompt-avatar" aria-hidden="true">You</span>{text}</li>
          ))}
        </ul>
      </div>
      <form className="sim-composer" onSubmit={(event) => event.preventDefault()}>
        <label className="visually-hidden" htmlFor="sim-chat-input">Message</label>
        <input id="sim-chat-input" disabled placeholder="Planner not connected yet" />
        <button type="submit" className="sim-send" disabled aria-label="Send"><SendHorizontal size={15} /></button>
      </form>
    </div>
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
      </dl>
    </details>
  )
}

/** Legend swatches for the map's own cues, drawn to match what the canvas paints. */
function MapSwatch({ kind }: { kind: 'person' | 'left' | 'down' | 'open' | 'closed' }) {
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
