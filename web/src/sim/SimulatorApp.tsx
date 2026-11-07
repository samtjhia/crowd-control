import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { CompileOutputSchema, parseContract, type CompileOutput } from '@crowd-control/contract'
import workedExample from '../../../contract/fixtures/compile-output.json'
import { CrowdRenderer } from '../render/renderer.ts'
import { createMockEndpoint } from '../worker/mockEndpoint.ts'
import { SimulationClient, type SimulationView } from '../worker/simulationClient.ts'
import './simulator.css'

const SPEEDS = [0.5, 1, 2, 4, 8]
const PAN_STEP_PX = 40

/** The Technical PRD §8 worked example, validated at the boundary like any other input. */
function workedExampleScene(): CompileOutput {
  const parsed = parseContract(CompileOutputSchema, workedExample)
  if (!parsed.ok) throw new Error(`Worked example fixture is invalid: ${parsed.error.message}`)
  return parsed.value
}

function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${(seconds - minutes * 60).toFixed(1).padStart(4, '0')}`
}

export default function SimulatorApp() {
  // One endpoint and client per page. The mock is swapped for the real Wasm adapter here later.
  const [client] = useState(() => new SimulationClient(createMockEndpoint()))
  const hostRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<CrowdRenderer | null>(null)
  const view = useSyncExternalStore(client.subscribe, client.getView)

  useEffect(() => {
    void client.load(workedExampleScene())
    // Pausing stops the playback timer; the client stays usable if React remounts (StrictMode).
    return () => void client.pause().catch(() => {})
  }, [client])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let renderer: CrowdRenderer | null = null
    void CrowdRenderer.create(host, client).then((created) => {
      if (cancelled) {
        created.destroy()
        return
      }
      renderer = created
      rendererRef.current = created
    })
    return () => {
      cancelled = true
      renderer?.destroy()
      rendererRef.current = null
    }
  }, [client])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest('input, select, textarea, button, [contenteditable="true"]')) return
      const renderer = rendererRef.current
      const handled = (() => {
        switch (event.key) {
          case ' ': void (client.getView().playing ? client.pause() : client.play()); return true
          case '.': void client.step(1); return true
          case 'r': case 'R': void client.reset(); return true
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
    <div className="sim">
      <header className="sim-header">
        <h1>Crowd Control <span>Simulator</span></h1>
        {view?.endpointKind === 'mock' && (
          <p className="sim-mock" role="status">Mock worker: development data, not simulation results</p>
        )}
      </header>
      <div className="sim-body">
        <main className="sim-main">
          <Controls client={client} view={view} renderer={rendererRef} />
          <div className="sim-canvas" ref={hostRef} />
          <Status view={view} />
          <Legend />
        </main>
        <aside className="sim-chat" aria-label="Chat">
          <p>Chat panel (Role C) mounts here.</p>
        </aside>
      </div>
    </div>
  )
}

function Controls({ client, view, renderer }: { client: SimulationClient | null; view: SimulationView | null; renderer: RefObject<CrowdRenderer | null> }) {
  const disabled = !client || !view?.current
  const time = view?.current?.frame.time ?? 0
  return (
    <div className="sim-controls" role="toolbar" aria-label="Playback controls">
      <button type="button" disabled={disabled} aria-pressed={view?.playing ?? false} aria-keyshortcuts="Space"
        onClick={() => void (view?.playing ? client?.pause() : client?.play())}>
        {view?.playing ? 'Pause' : 'Play'} <kbd>Space</kbd>
      </button>
      <button type="button" disabled={disabled || view?.playing} aria-keyshortcuts="." onClick={() => void client?.step(1)}>
        Step <kbd>.</kbd>
      </button>
      <label className="sim-speed">
        Speed
        <select disabled={disabled} value={view?.speed ?? 1} onChange={(event) => void client?.setSpeed(Number(event.target.value))}>
          {SPEEDS.map((speed) => <option key={speed} value={speed}>{speed}×</option>)}
        </select>
      </label>
      <button type="button" disabled={disabled} aria-keyshortcuts="R" onClick={() => void client?.reset()}>
        Reset <kbd>R</kbd>
      </button>
      <span className="sim-zoom" role="group" aria-label="Zoom">
        <button type="button" aria-label="Zoom out" aria-keyshortcuts="-" onClick={() => renderer.current?.zoom(1 / 1.25)}>−</button>
        <button type="button" aria-label="Fit map" aria-keyshortcuts="0" onClick={() => renderer.current?.resetCamera()}>Fit</button>
        <button type="button" aria-label="Zoom in" aria-keyshortcuts="+" onClick={() => renderer.current?.zoom(1.25)}>+</button>
      </span>
      <output className="sim-clock" aria-label="Simulation time">
        {formatClock(time)} <small>tick {view?.current?.frame.tick ?? 0}</small>
      </output>
    </div>
  )
}

function Status({ view }: { view: SimulationView | null }) {
  const sample = view?.metrics
  const recent = view?.events.slice(-4).reverse() ?? []
  return (
    <section className="sim-status" aria-label="Simulation status">
      <dl>
        <div><dt>Inside</dt><dd>{sample?.present ?? 0}</dd></div>
        <div><dt>Departed</dt><dd>{sample?.departed ?? 0}</dd></div>
        <div><dt>Down</dt><dd>{sample?.immobile ?? 0}</dd></div>
      </dl>
      <ol className="sim-events" aria-label="Recent events">
        {recent.map((event) => (
          <li key={event.id}><time>{formatClock(event.time)}</time> {event.name}{event.source ? ` · ${event.source}` : ''}</li>
        ))}
      </ol>
      {view?.lastError && <p className="sim-error" role="alert">{view.lastError.code}: {view.lastError.message}</p>}
    </section>
  )
}

function Legend() {
  return (
    <details className="sim-legend">
      <summary>Legend and shortcuts</summary>
      <ul>
        <li><b>down</b> fallen person (immobile obstacle) · <b>stop</b> immobile</li>
        <li><b>blocked</b> / <b>error</b> red ring: no route or failed goal</li>
        <li><b>Q</b> queueing · <b>S</b> being served · <b>out</b> departed (faded)</li>
        <li><b>×</b> closed door</li>
        <li>Drag to pan, scroll to zoom. Keys: arrows pan, + / − zoom, 0 fit.</li>
      </ul>
    </details>
  )
}
