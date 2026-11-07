import { parseWorkerCommand, parseWorkerMessage, type WorkerCommand, type WorkerEndpoint, type WorkerMessage } from '@crowd-control/contract'
import { commandError } from './dispatchCommand.ts'

export type WorkerPort = {
  postMessage(command: WorkerCommand): void
  terminate(): void
  onmessage: ((event: MessageEvent<unknown>) => unknown) | null
  onerror: ((event: ErrorEvent) => unknown) | null
  onmessageerror: ((event: MessageEvent<unknown>) => unknown) | null
}
export type RealEndpoint = WorkerEndpoint & { kind: 'real'; dispose(): void }

export function createRealEndpoint(options: { worker?: WorkerPort; onValidationTime?: (ms: number) => void } = {}): RealEndpoint {
  let worker: WorkerPort | undefined = options.worker
  const listeners = new Set<(message: WorkerMessage) => void>()
  const pending = new Map<string, WorkerCommand>()
  let active: WorkerCommand | undefined
  let disposed = false
  let failed = false
  const deliver = (message: WorkerMessage) => queueMicrotask(() => {
    if (!disposed) for (const listener of [...listeners]) listener(message)
  })
  const fail = (message: string) => {
    if (failed || disposed) return
    failed = true
    worker?.terminate()
    const affected = pending.size ? [...pending.values()] : [active]
    pending.clear()
    for (const command of affected) deliver(commandError(command, { code: 'INVALID_SCHEMA', message }))
  }
  const connect = (port: WorkerPort) => {
    port.onmessage = (event) => {
      if (disposed || failed) return
      const started = options.onValidationTime ? performance.now() : 0
      const parsed = parseWorkerMessage(event.data)
      options.onValidationTime?.(performance.now() - started)
      if (!parsed.ok) { fail(`Invalid worker response: ${parsed.error.message}`); return }
      const message = parsed.value
      if ('commandId' in message && message.commandId) pending.delete(message.commandId)
      deliver(message)
    }
    port.onerror = (event) => fail(event.message || 'Engine worker failed')
    port.onmessageerror = () => fail('Cannot deserialize engine worker response')
  }
  if (worker) connect(worker)
  return {
    kind: 'real',
    send(command) {
      if (disposed) throw new Error('Engine endpoint is disposed')
      if (failed) { deliver(commandError(command, { code: 'UNSUPPORTED_CAPABILITY', message: 'Engine worker has failed; create a new endpoint' })); return }
      const parsed = parseWorkerCommand(command)
      if (!parsed.ok) { deliver(commandError(command, parsed.error)); return }
      if (pending.has(command.commandId)) { deliver(commandError(command, { code: 'INVALID_SCHEMA', message: 'commandId is already pending' })); return }
      active = parsed.value
      pending.set(command.commandId, parsed.value)
      try {
        // Defer construction so discarded React render initializers do not leak workers.
        if (!worker) { worker = new Worker(new URL('./realWorker.ts', import.meta.url), { type: 'module' }); connect(worker) }
        worker.postMessage(parsed.value)
      } catch (error) { fail(error instanceof Error ? error.message : 'Cannot post worker command') }
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    dispose() {
      if (disposed) return
      disposed = true
      if (worker) { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate() }
      pending.clear(); listeners.clear()
    },
  }
}
