import { useEffect, useState, type RefObject } from 'react'
import type { CrowdRenderer } from '../render/renderer.ts'
import type { SimulationClient } from '../worker/simulationClient.ts'
import { ENGINE_VERSION } from '../worker/wasmBindings.ts'

type Reading = { fps: number; browserFps: number; updateMs: number; worstMs: number; speed: number; frameAge: number; validationMs: number; validationWorst: number; submitMs: number; submitWorstMs: number; reactMs: number; reactWorst: number; commits: number }

/** Optional browser measurements: /sim?engine=real&scenario=concert-floor&debug=1. */
export function Diagnostics({ client, renderer, validation }: {
  client: SimulationClient; renderer: RefObject<CrowdRenderer | null>; validation: RefObject<{ ms: number; worstMs: number; reactMs: number; reactWorst: number; commits: number }>
}) {
  const [reading, setReading] = useState<Reading | null>(null)
  useEffect(() => {
    let browserFrames = 0
    let animation = 0
    const countFrame = () => { browserFrames++; animation = requestAnimationFrame(countFrame) }
    animation = requestAnimationFrame(countFrame)
    let lastWall = performance.now()
    let lastFrame = client.getView().current?.frame
    const timer = setInterval(() => {
      const now = performance.now()
      const current = client.getView().current
      const draw = renderer.current?.readPerformance()
      const counters = validation.current
      if (draw && current) {
        const continuous = lastFrame?.streamId === current.frame.streamId && current.frame.time >= lastFrame.time
        setReading({ ...draw, browserFps: browserFrames * 1000 / (now - lastWall), speed: continuous ? (current.frame.time - lastFrame!.time) * 1000 / (now - lastWall) : 0,
          frameAge: now - current.receivedAt, validationMs: counters.ms * 1000 / (now - lastWall), validationWorst: counters.worstMs,
          reactMs: counters.reactMs * 1000 / (now - lastWall), reactWorst: counters.reactWorst, commits: counters.commits * 1000 / (now - lastWall) })
      }
      counters.ms = 0; counters.worstMs = 0; counters.reactMs = 0; counters.reactWorst = 0; counters.commits = 0
      browserFrames = 0
      lastWall = now; lastFrame = current?.frame
    }, 1000)
    return () => { clearInterval(timer); cancelAnimationFrame(animation) }
  }, [client, renderer, validation])
  return <output className="sim-debug" aria-label="Simulation performance">
    <strong>{ENGINE_VERSION}</strong>
    {reading ? <>
      <span>Render {reading.fps.toFixed(0)} FPS · browser {reading.browserFps.toFixed(0)} FPS · update {reading.updateMs.toFixed(1)} ms (peak {reading.worstMs.toFixed(1)})</span>
      <span>Pixi submit {reading.submitMs.toFixed(1)} ms (peak {reading.submitWorstMs.toFixed(1)})</span>
      <span>React {reading.reactMs.toFixed(0)} ms/s · {reading.commits.toFixed(0)} commits/s (peak {reading.reactWorst.toFixed(1)})</span>
      <span>Simulation {reading.speed.toFixed(1)}× / requested {client.getView().speed}× · frame age {reading.frameAge.toFixed(0)} ms</span>
      <span>Main-thread validation {reading.validationMs.toFixed(0)} ms/s (peak {reading.validationWorst.toFixed(1)})</span>
      <small>Submit includes CPU render work and any blocking; asynchronous GPU time is unmeasured. Paused simulations have no live frame rate.</small>
    </> : <span>Waiting for samples…</span>}
  </output>
}
