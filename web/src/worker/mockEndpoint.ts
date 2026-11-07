import type { WorkerCommand, WorkerEndpoint, WorkerMessage } from '@crowd-control/contract'
import { MockSimulation } from './mock/simulation.ts'

/** Wall-clock source and timer, injectable so tests can drive time by hand. */
export type MockClock = {
  now(): number
  every(intervalMs: number, callback: () => void): () => void
}

export const systemClock: MockClock = {
  now: () => performance.now(),
  every(intervalMs, callback) {
    const handle = setInterval(callback, intervalMs)
    return () => clearInterval(handle)
  },
}

export type MockEndpointOptions = {
  clock?: MockClock
  /** How often the pacing loop runs while playing. */
  intervalMs?: number
  /** Ticks per loop iteration before the mock drops time instead of falling further behind. */
  maxTicksPerInterval?: number
}

export type MockEndpoint = WorkerEndpoint & { kind: 'mock'; dispose(): void }

/**
 * Development stand-in for the real worker endpoint. Same protocol as the Wasm adapter;
 * the UI must label its output as mock data. Messages are delivered asynchronously, like
 * a real Web Worker, and playback paces wall-clock time into fixed ticks at the set speed.
 */
export function createMockEndpoint(options: MockEndpointOptions = {}): MockEndpoint {
  const clock = options.clock ?? systemClock
  const intervalMs = options.intervalMs ?? 1000 / 60
  const maxTicks = options.maxTicksPerInterval ?? 400
  const simulation = new MockSimulation()
  const listeners = new Set<(message: WorkerMessage) => void>()
  let queue: WorkerMessage[] = []
  let flushQueued = false
  let stopLoop: (() => void) | null = null
  let lastTime = 0
  let carry = 0

  const flush = () => {
    flushQueued = false
    const batch = queue
    queue = []
    for (const message of batch) for (const listener of [...listeners]) listener(message)
  }
  const deliver = (messages: WorkerMessage[]) => {
    if (messages.length === 0) return
    queue.push(...messages)
    if (!flushQueued) {
      flushQueued = true
      queueMicrotask(flush)
    }
  }
  const loop = () => {
    const now = clock.now()
    carry += ((now - lastTime) / 1000) * simulation.speedMultiplier
    lastTime = now
    let ticks = Math.floor(carry / simulation.dt + 1e-9)
    if (ticks > maxTicks) {
      ticks = maxTicks
      carry = 0
    } else {
      carry -= ticks * simulation.dt
    }
    deliver(simulation.advance(ticks))
  }
  const syncLoop = () => {
    if (simulation.isRunning && !stopLoop) {
      lastTime = clock.now()
      carry = 0
      stopLoop = clock.every(intervalMs, loop)
    } else if (!simulation.isRunning && stopLoop) {
      stopLoop()
      stopLoop = null
    }
  }

  return {
    kind: 'mock',
    send(command: WorkerCommand) {
      deliver(simulation.handle(command))
      syncLoop()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      stopLoop?.()
      stopLoop = null
      listeners.clear()
      queue = []
    },
  }
}
