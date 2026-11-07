import { commandError } from './dispatchCommand.ts'
import { loadWasmEngine } from './wasmBindings.ts'
import { createEngineHost } from './engineHost.ts'

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  postMessage(message: unknown): void
}
const publicationSession = crypto.randomUUID()
const ready = loadWasmEngine(`${import.meta.env.BASE_URL}engine/crowd_control_engine.wasm`)
  .then((bindings) => createEngineHost(bindings, (message) => {
    // Transport identity is independent of physics randomness and worker lifetimes.
    if ('stamp' in message) message.stamp.streamId = `${publicationSession}/${message.stamp.streamId}`
    if (message.type === 'frame') message.frame.streamId = `${publicationSession}/${message.frame.streamId}`
    scope.postMessage(message)
  }))
// Retain initialization failure for queued commands without an unhandled rejection.
void ready.catch(() => {})
let queue = Promise.resolve()
scope.onmessage = (event) => {
  queue = queue.then(async () => {
    let engine: Awaited<typeof ready>
    try {
      engine = await ready
    } catch (error) {
      scope.postMessage(commandError(event.data, { code: 'UNSUPPORTED_CAPABILITY', message: error instanceof Error ? error.message : 'Engine worker failed' }))
      return
    }
    try {
      engine.send(event.data)
    } catch (error) {
      scope.postMessage(commandError(event.data, { code: 'INVALID_SCHEMA', message: error instanceof Error ? error.message : 'Invalid engine response' }))
    }
  })
}
