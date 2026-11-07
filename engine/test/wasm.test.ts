import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parseWorkerMessage } from '@crowd-control/contract'
import { instantiateEngine } from '../../web/src/worker/wasmBindings.ts'

test('actual Wasm module loads, publishes typed messages, resets and releases handles', async () => {
  const bytes = readFileSync(new URL('../../web/public/engine/crowd_control_engine.wasm', import.meta.url))
  const bindings = await instantiateEngine(new Uint8Array(bytes))
  assert.equal(bindings.abi_version(), 1)
  assert.equal(bindings.engine_version(), 'static-engine-v1')
  const handle = bindings.create_engine()
  const command = readFileSync(new URL('../../contract/fixtures/engine-static-load.json', import.meta.url), 'utf8')
  const messages = JSON.parse(bindings.dispatch(handle, command))
  for (const message of messages) assert.equal(parseWorkerMessage(message).ok, true)
  assert.deepEqual(messages.map((m: { type: string }) => m.type), ['ack', 'scene', 'frame'])
  assert.equal(messages[2].frame.agents[0].x, 1.5)
  const reset = JSON.parse(bindings.dispatch(handle, JSON.stringify({ schemaVersion: 1, simulationId: 'engine-demo', commandId: 'reset', type: 'reset' })))
  assert.notEqual(reset[2].frame.streamId, messages[2].frame.streamId)
  bindings.destroy_engine(handle)
  assert.throws(() => bindings.dispatch(handle, command), /destroyed/)
  const next = bindings.create_engine(); assert.notEqual(next, handle); bindings.destroy_engine(next)
})
