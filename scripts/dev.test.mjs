import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { supervise } from './dev.mjs'

function child() {
  const process = new EventEmitter()
  process.killed = 0
  process.kill = (signal) => { assert.equal(signal, 'SIGTERM'); process.killed++; process.emit('exit', null, signal) }
  return process
}

test('API failure stops Vite and preserves a failing exit code', () => {
  const api = child(), web = child(), exits = []
  supervise([api, web], (code) => exits.push(code))
  api.emit('exit', 1, null)
  assert.equal(web.killed, 1)
  assert.deepEqual(exits, [1])
})
test('stopping Vite or interrupting cleans up the API once', () => {
  const api = child(), web = child(), exits = []
  const stop = supervise([api, web], (code) => exits.push(code))
  stop(); stop()
  assert.equal(api.killed, 1)
  assert.equal(web.killed, 1)
  assert.deepEqual(exits, [0])
})
test('a process spawn error shuts down its companion', (t) => {
  t.mock.method(console, 'error', () => {})
  const api = child(), web = child(), exits = []
  supervise([api, web], (code) => exits.push(code))
  api.emit('error', new Error('spawn failed'))
  assert.equal(web.killed, 1)
  assert.deepEqual(exits, [1])
})
