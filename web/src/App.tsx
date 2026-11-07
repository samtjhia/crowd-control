import { useEffect, useRef, useState } from 'react'
import { parseWorkerCommand, type Frame, type RenderScene, type Stamp, type WorkerCommand } from '@crowd-control/contract'
import serviceLoad from '../../contract/fixtures/engine-services-load.json'
import contactLoad from '../../contract/fixtures/engine-contact-load.json'
import { createRealEndpoint, type RealEndpoint } from './worker/realEndpoint.ts'
import { createStaticRenderer } from './render/staticRenderer.ts'

function App() {
  const contactDemo = new URLSearchParams(window.location.search).get('demo') === 'contact'
  const movementLoad = contactDemo ? contactLoad : serviceLoad
  const controlledId = movementLoad.compiled.scene.agents[contactDemo ? 1 : 0]!.id
  const host = useRef<HTMLDivElement>(null)
  const endpoint = useRef<RealEndpoint | null>(null)
  const [status, setStatus] = useState('Loading Rust/Wasm and PixiJS…')
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [targetTime, setTargetTime] = useState('10')
  const [doorOpen, setDoorOpen] = useState(true)
  const [immobile, setImmobile] = useState(false)
  const pending = useRef(new Map<string, WorkerCommand>())
  const nextCommand = useRef(0)
  const header = () => ({ schemaVersion: 1 as const, simulationId: 'engine-demo', commandId: `control-${++nextCommand.current}` })
  const send = (command: WorkerCommand) => {
    setError('')
    pending.current.set(command.commandId, command)
    endpoint.current?.send(command)
  }
  useEffect(() => {
    if (!host.current) return
    let disposed = false
    let renderer: Awaited<ReturnType<typeof createStaticRenderer>> | undefined
    let scene: { stamp: Stamp; data: RenderScene } | undefined
    let frame: Frame | undefined
    let stream: string | undefined
    const draw = () => {
      if (!renderer || !scene || !frame || frame.streamId !== scene.stamp.streamId || frame.sceneVersion !== scene.stamp.sceneVersion || frame.historyRevision !== scene.stamp.historyRevision || frame.topologyVersion !== scene.stamp.topologyVersion) return
      try {
        renderer.render({ scene: scene.data, frame, camera: { pan: { x: -1, y: -1 }, pixelsPerUnit: 40 }, selectedIds: [] })
        setReady(true)
        setImmobile(frame.agents.find((agent) => agent.id === controlledId)?.state === 'immobile')
        setStatus(`${frame.agents.map((a) => `${a.id}: ${a.state}`).join(', ')} · ${frame.time.toFixed(2)} simulation seconds · tick ${frame.tick}`)
      } catch (e) { setError(e instanceof Error ? e.message : 'Renderer failed') }
    }
    const worker = createRealEndpoint()
    endpoint.current = worker
    const unsubscribe = worker.subscribe((message) => {
      if (message.type === 'error') {
        if (message.commandId) pending.current.delete(message.commandId)
        else setPlaying(false)
        setError(message.error.message); return
      }
      if (message.type === 'ack') {
        const command = pending.current.get(message.commandId)
        pending.current.delete(message.commandId)
        if (command?.type === 'resume') setPlaying(true)
        if (command?.type === 'pause' || command?.type === 'load' || command?.type === 'reset') setPlaying(false)
        if (command?.type === 'load' || command?.type === 'reset') setSpeed(1)
        if (command?.type === 'speed') setSpeed(command.multiplier)
      }
      if (message.type === 'ack' && message.stamp.streamId !== stream) { stream = message.stamp.streamId; scene = undefined; frame = undefined }
      if (message.type === 'scene' && message.stamp.streamId === stream) {
        scene = { stamp: message.stamp, data: message.scene }
        setDoorOpen(message.scene.map.portals[0]!.open)
      }
      if (message.type === 'frame' && message.frame.streamId === stream) frame = message.frame
      draw()
    })
    const parsed = parseWorkerCommand(movementLoad)
    if (parsed.ok) { pending.current.set(parsed.value.commandId, parsed.value); worker.send(parsed.value) }
    else queueMicrotask(() => { if (!disposed) setError(parsed.error.message) })
    void createStaticRenderer(host.current).then((view) => {
      if (disposed) { view.destroy(); return }
      renderer = view
      draw()
    }).catch((e: unknown) => { if (!disposed) setError(e instanceof Error ? e.message : 'Cannot load PixiJS') })
    const commands = pending.current
    return () => { disposed = true; unsubscribe(); worker.dispose(); renderer?.destroy(); endpoint.current = null; commands.clear() }
  }, [controlledId, movementLoad])
  return (
    <main>
      <p>HackTrent 2026</p>
      <h1>Crowd Control</h1>
      <p>{contactDemo ? 'Rust contact and compression-triggered falls' : 'Rust goals, queues, interactions and recovery'}</p>
      <p role="status">{status}</p>
      {error && <p role="alert">{error}</p>}
      <div className="playback-controls">
        <button disabled={!ready} onClick={() => send({ ...header(), type: playing ? 'pause' : 'resume' })}>{playing ? 'Pause' : 'Play'}</button>
        <button disabled={!ready || playing} onClick={() => send({ ...header(), type: 'step', ticks: contactDemo ? 1 : 20 })}>{contactDemo ? 'Step one tick' : 'Step 1 second'}</button>
        <button disabled={!ready} onClick={() => send({ ...header(), type: 'reset' })}>Reset scene</button>
        <button disabled={!ready || contactDemo} onClick={() => {
          const h = header()
          send({ ...h, type: 'apply_request', request: { schemaVersion: 1, simulationId: h.simulationId, requestId: h.commandId, action: 'create_intervention', label: doorOpen ? 'Close door' : 'Open door', operations: [{ op: 'set', targets: { ids: [movementLoad.compiled.scene.map.portals[0]!.id] }, values: { components: { portal: { open: !doorOpen } } } }] } })
        }}>{doorOpen ? 'Close door' : 'Open door'}</button>
        <button disabled={!ready} onClick={() => {
          const h = header()
          send({ ...h, type: 'apply_request', request: { schemaVersion: 1, simulationId: h.simulationId, requestId: h.commandId, action: 'create_intervention', label: immobile ? 'Recover agent' : 'Stop agent', operations: [{ op: 'set', targets: { ids: [controlledId], kind: 'agent' }, values: { components: { mobility: { speedMultiplier: immobile ? 1 : 0 } }, appearance: { pose: immobile ? 'upright' : 'fallen' } } }] } })
        }}>{immobile ? 'Recover agent' : 'Stop agent'}</button>
        <label>Speed <select disabled={!ready} value={speed} onChange={(event) => send({ ...header(), type: 'speed', multiplier: Number(event.target.value) })}>
          <option value="0.25">0.25×</option><option value="1">1×</option><option value="4">4×</option><option value="8">8×</option>
        </select></label>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); send({ ...header(), type: 'run_to', time: Number(targetTime) }) }}>
        <label>Forward to simulation second <input type="number" min="0" step="any" required disabled={!ready || playing} value={targetTime} onChange={(event) => setTargetTime(event.target.value)} /></label>
        <button disabled={!ready || playing}>Run to time</button>
      </form>
      <div ref={host} className="simulation-view" />
      {contactDemo ? <p>Two people push toward the middle person. Only the middle person's own sustained contact meets the fall rule. Step one tick at a time to inspect the delay; Recover keeps the once-only rule fired.</p> : <p>Two attendees queue at the brown desk, interact one at a time, then leave through the door. A third wanders in the hall. Close/Open door blocks and resumes routes; Stop/Recover preserves intent.</p>}
    </main>
  )
}

export default App
