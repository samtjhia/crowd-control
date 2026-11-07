/** Wall-clock pacing is separate from the engine's simulation clock. */
export type WorkerClock = {
  now(): number
  every(intervalMs: number, callback: () => void): () => void
}
export const systemClock: WorkerClock = {
  now: () => performance.now(),
  every(intervalMs, callback) {
    const handle = setInterval(callback, intervalMs)
    return () => clearInterval(handle)
  },
}
