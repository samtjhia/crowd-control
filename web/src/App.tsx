import { useEffect, useRef, useState } from 'react'
import { parseWorkerCommand, type Frame, type RenderScene, type Stamp } from '@crowd-control/contract'
import staticLoad from '../../contract/fixtures/engine-static-load.json'
import { createRealEndpoint, type RealEndpoint } from './worker/realEndpoint.ts'
import { createStaticRenderer } from './render/staticRenderer.ts'

function App() {
  const host = useRef<HTMLDivElement>(null)
  const endpoint = useRef<RealEndpoint | null>(null)
  const [status, setStatus] = useState('Loading Rust/Wasm and PixiJS…')
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const nextCommand = useRef(0)
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
        setStatus(`${frame.agents.length} stationary agents · Rust stream ${frame.streamId} · tick ${frame.tick}`)
      } catch (e) { setError(e instanceof Error ? e.message : 'Renderer failed') }
    }
    const worker = createRealEndpoint()
    endpoint.current = worker
    const unsubscribe = worker.subscribe((message) => {
      if (message.type === 'error') { setError(message.error.message); return }
      if (message.type === 'ack' && message.stamp.streamId !== stream) { stream = message.stamp.streamId; scene = undefined; frame = undefined }
      if (message.type === 'scene' && message.stamp.streamId === stream) scene = { stamp: message.stamp, data: message.scene }
      if (message.type === 'frame' && message.frame.streamId === stream) frame = message.frame
      draw()
    })
    const parsed = parseWorkerCommand(staticLoad)
    if (parsed.ok) worker.send(parsed.value)
    else queueMicrotask(() => { if (!disposed) setError(parsed.error.message) })
    void createStaticRenderer(host.current).then((view) => {
      if (disposed) { view.destroy(); return }
      renderer = view
      draw()
    }).catch((e: unknown) => { if (!disposed) setError(e instanceof Error ? e.message : 'Cannot load PixiJS') })
    return () => { disposed = true; unsubscribe(); worker.dispose(); renderer?.destroy(); endpoint.current = null }
  }, [])
  return (
    <main>
      <p>HackTrent 2026</p>
      <h1>Crowd Control</h1>
      <p>Rust engine connection · static scene demo</p>
      <p role="status">{status}</p>
      {error && <p role="alert">{error}</p>}
      <button disabled={!ready} onClick={() => { setError(''); endpoint.current?.send({ schemaVersion: 1, simulationId: 'engine-demo', commandId: `reset-${++nextCommand.current}`, type: 'reset' }) }}>Reset scene</button>
      <div ref={host} className="simulation-view" />
      <p>Movement, goals and scheduling are not implemented in this milestone.</p>
    </main>
  )
}

export default App
