import { useEffect, useRef, useState } from 'react'
import { parseWorkerCommand, type Frame, type RenderScene, type Stamp, type WorkerCommand } from '@crowd-control/contract'
import staticLoad from '../../contract/fixtures/engine-static-load.json'
import { createRealEndpoint, type RealEndpoint } from './worker/realEndpoint.ts'
import { createStaticRenderer } from './render/staticRenderer.ts'

function App() {
  const host = useRef<HTMLDivElement>(null)
  const endpoint = useRef<RealEndpoint | null>(null)
  const [status, setStatus] = useState('Loading Rust/Wasm and PixiJS…')
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [targetTime, setTargetTime] = useState('10')
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
      if (!renderer || !scene || !frame || frame.streamId !== scene.stamp.streamId || frame.sceneVersion !== scene.stamp.sceneVersion || frame.historyRevision !== scene.stamp.historyRevision) return
      try {
        renderer.render({ scene: scene.data, frame, camera: { pan: { x: -1, y: -1 }, pixelsPerUnit: 60 }, selectedIds: [] })
        setReady(true)
        setStatus(`${frame.agents.length} agents · ${frame.time.toFixed(2)} simulation seconds · tick ${frame.tick}`)
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
      if (message.type === 'scene' && message.stamp.streamId === stream) scene = { stamp: message.stamp, data: message.scene }
      if (message.type === 'frame' && message.frame.streamId === stream) frame = message.frame
      draw()
    })
    const parsed = parseWorkerCommand(staticLoad)
    if (parsed.ok) { pending.current.set(parsed.value.commandId, parsed.value); worker.send(parsed.value) }
    else queueMicrotask(() => { if (!disposed) setError(parsed.error.message) })
    void createStaticRenderer(host.current).then((view) => {
      if (disposed) { view.destroy(); return }
      renderer = view
      draw()
    }).catch((e: unknown) => { if (!disposed) setError(e instanceof Error ? e.message : 'Cannot load PixiJS') })
    const commands = pending.current
    return () => { disposed = true; unsubscribe(); worker.dispose(); renderer?.destroy(); endpoint.current = null; commands.clear() }
  }, [])
  return (
    <main>
      <p>HackTrent 2026</p>
      <h1>Crowd Control</h1>
      <p>Rust world initialization and fixed-clock demo</p>
      <p role="status">{status}</p>
      {error && <p role="alert">{error}</p>}
      <div className="playback-controls">
        <button disabled={!ready} onClick={() => send({ ...header(), type: playing ? 'pause' : 'resume' })}>{playing ? 'Pause' : 'Play'}</button>
        <button disabled={!ready || playing} onClick={() => send({ ...header(), type: 'step', ticks: 20 })}>Step 1 second</button>
        <button disabled={!ready} onClick={() => send({ ...header(), type: 'reset' })}>Reset scene</button>
        <label>Speed <select disabled={!ready} value={speed} onChange={(event) => send({ ...header(), type: 'speed', multiplier: Number(event.target.value) })}>
          <option value="0.25">0.25×</option><option value="1">1×</option><option value="4">4×</option>
        </select></label>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); send({ ...header(), type: 'run_to', time: Number(targetTime) }) }}>
        <label>Forward to simulation second <input type="number" min="0" step="any" required disabled={!ready || playing} value={targetTime} onChange={(event) => setTargetTime(event.target.value)} /></label>
        <button disabled={!ready || playing}>Run to time</button>
      </form>
      <div ref={host} className="simulation-view" />
      <p>The clock advances; agents remain stationary. Movement, goals and scheduling follow in later milestones.</p>
    </main>
  )
}

export default App
