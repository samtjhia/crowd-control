import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SaveState } from '../site/saveState.ts'
import { useAuthFetch } from '../site/useAuthFetch.ts'
import type { SimulationView } from '../worker/simulationClient.ts'
import { RunRecorder, type Poster, type RunAbout } from './runRecorder.ts'

/** How often queued run data is sent while a run plays. */
const FLUSH_MS = 4000

/**
 * Saves the simulator's runs to the signed-in account as they play: a new run for each load or
 * reset, its metric samples, and each change applied. Returns the save state for the account menu.
 */
export function useRunSaving(view: SimulationView, about: RunAbout): { state: SaveState; runId: string | null; flush: () => Promise<boolean> } {
  const authFetch = useAuthFetch()
  const [state, setState] = useState<SaveState>({ kind: 'off' })
  const [runId, setRunId] = useState<string | null>(null)
  const recorder = useMemo(() => {
    const post: Poster = async (path, body) => {
      const response = await authFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (response.ok) return { ok: true, status: response.status }
      const payload: unknown = await response.json().catch(() => null)
      const error = typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string' ? payload.error : undefined
      return { ok: false, status: response.status, ...(error && { error }) }
    }
    return new RunRecorder(post, setState)
  }, [authFetch])

  // What the current scenario is; updated before a new run starts, so the run is saved with it.
  const aboutRef = useRef(about)
  useEffect(() => { aboutRef.current = about }, [about])

  // Each new stream (a load or a reset) is a new run.
  useEffect(() => {
    if (!view.streamId || !view.simulationId) return
    recorder.start(view.simulationId, aboutRef.current)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRunId(recorder.current()?.runId ?? null)
  }, [recorder, view.streamId, view.simulationId])

  useEffect(() => {
    if (view.metrics) recorder.sample(view.metrics)
  }, [recorder, view.metrics])

  // Changes arrive as a growing list for the stream; record each one once.
  const seen = useRef<{ stream: string | null; count: number }>({ stream: null, count: 0 })
  useEffect(() => {
    if (seen.current.stream !== view.streamId) seen.current = { stream: view.streamId, count: 0 }
    for (const change of view.changes.slice(seen.current.count)) recorder.change({ prompt: change.prompt, request: change.request, ack: change.ack })
    seen.current.count = view.changes.length
  }, [recorder, view.streamId, view.changes])

  useEffect(() => {
    const timer = window.setInterval(() => void recorder.flush(), FLUSH_MS)
    const leave = () => void recorder.flush()
    window.addEventListener('pagehide', leave)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pagehide', leave)
      void recorder.flush()
    }
  }, [recorder])

  /** Sends everything measured so far; true once the run on screen is saved to the account. */
  const flush = useCallback(async () => {
    await recorder.flush()
    return recorder.current()?.saved ?? false
  }, [recorder])

  return { state, runId, flush }
}
