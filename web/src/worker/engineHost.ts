import type { WasmEngineBindings, WorkerCommand, WorkerMessage } from '@crowd-control/contract'
import { systemClock, type WorkerClock } from './clock.ts'
import { commandError, dispatchCommand } from './dispatchCommand.ts'

export const MAX_TICKS_PER_BATCH = 8

/** Runs inside the worker; only bounded step commands enter Rust's clock. */
export function createEngineHost(bindings: WasmEngineBindings, publish: (message: WorkerMessage) => void, clock: WorkerClock = systemClock) {
  const handle = bindings.create_engine()
  let disposed = false
  let playing = false
  let stopLoop: (() => void) | undefined
  let simulationId = 'unknown'
  let dt = 0.05
  let multiplier = 1
  let last = 0
  let owedTicks = 0
  let commandSequence = 0
  let tickCostMs = 0
  let lastDensityAt = 0
  const stop = () => { stopLoop?.(); stopLoop = undefined; playing = false }
  const accrue = () => {
    const now = clock.now()
    if (!Number.isFinite(now) || now < last) throw new Error('Worker clock must be finite and monotonic')
    owedTicks += ((now - last) / 1000) * multiplier / dt
    last = now
    if (!Number.isFinite(owedTicks)) throw new Error('Playback rate exceeds clock range')
  }
  const pump = () => {
    const budget = tickCostMs > 0 ? Math.max(1, Math.floor(12 / tickCostMs)) : MAX_TICKS_PER_BATCH
    const ticks = Math.min(MAX_TICKS_PER_BATCH, budget, Math.max(0, Math.floor(owedTicks + 1e-9)))
    if (ticks === 0) return
    const started = clock.now()
    const messages = dispatchCommand(bindings, handle, { schemaVersion: 1, simulationId, commandId: `worker-tick-${++commandSequence}`, type: 'step', ticks })
    const elapsed = clock.now() - started
    if (Number.isFinite(elapsed) && elapsed > 0) tickCostMs = tickCostMs > 0 ? tickCostMs * 0.8 + elapsed / ticks * 0.2 : elapsed / ticks
    if (messages.some((m) => m.type === 'ack')) owedTicks -= ticks
    else stop()
    for (const message of messages) {
      // Internal stepping has no UI command awaiting acknowledgement.
      if (message.type === 'error') { const { commandId: _id, ...error } = message; publish(error) }
      else if (message.type !== 'ack') {
        // The live peak readout needs at most 5 Hz; physics/history sampling is unchanged.
        if (message.type === 'metrics' && message.density) {
          const now = clock.now()
          if (now - lastDensityAt < 200) delete message.density
          else lastDensityAt = now
        }
        publish(message)
      }
    }
  }
  const pulse = () => {
    if (!playing || disposed) return
    try { accrue(); pump() } catch (error) {
      stop()
      publish(commandError({ simulationId }, { code: 'RESOURCE_LIMIT', message: error instanceof Error ? error.message : 'Worker clock failed' }))
    }
  }
  return {
    send(raw: unknown) {
      if (disposed) throw new Error('Engine host is disposed')
      if (playing) pulse()
      const messages = dispatchCommand(bindings, handle, raw)
      if (messages.some((m) => m.type === 'ack')) {
        // A successful dispatch has already validated this command at both boundaries.
        const command = raw as WorkerCommand
        switch (command.type) {
          case 'load':
          case 'reset':
            if (command.type === 'load') { simulationId = command.simulationId; dt = command.compiled.scene.model.dt }
            stop(); owedTicks = 0; tickCostMs = 0; multiplier = 1; last = clock.now(); lastDensityAt = last; break
          case 'resume':
            if (!playing) { last = clock.now(); playing = true; stopLoop = clock.every(1000 / 60, pulse) }
            break
          case 'pause': stop(); break
          case 'speed': multiplier = command.multiplier; break
        }
      }
      messages.forEach(publish)
    },
    dispose() {
      if (disposed) return
      stop(); disposed = true; bindings.destroy_engine(handle)
    },
  }
}
