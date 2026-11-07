import assert from 'node:assert/strict'
import test from 'node:test'
import { appendChatHistory, readChatHistory } from '../dist/index.js'

const simulationId = 'worked-demo'
const entry = {
  prompt: 'Close the hall door.',
  request: {
    schemaVersion: 1,
    simulationId,
    requestId: 'close-door-request',
    label: 'Close hall door',
    operations: [{
      op: 'set',
      targets: { ids: ['hall_door'] },
      values: { components: { portal: { open: false } } },
    }],
  },
  acknowledgement: {
    requestId: 'close-door-request',
    interventionId: 'mock-intervention-1',
    revision: 1,
    at: 0,
    historyRevision: 1,
  },
  recordedAt: '2026-11-07T07:00:00.000Z',
}

function createStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

test('reads an empty history and persists acknowledged follow-ups across reads', () => {
  const storage = createStorage()
  const initial = readChatHistory(storage, simulationId)
  assert.equal(initial.ok, true)
  assert.deepEqual(initial.value.entries, [])

  const saved = appendChatHistory(storage, simulationId, entry)
  assert.equal(saved.ok, true)
  assert.equal(saved.value.entries.length, 1)

  const restored = readChatHistory(storage, simulationId)
  assert.equal(restored.ok, true)
  assert.deepEqual(restored.value.entries, [entry])
})

test('does not duplicate the same acknowledged request', () => {
  const storage = createStorage()
  assert.equal(appendChatHistory(storage, simulationId, entry).ok, true)
  const duplicate = appendChatHistory(storage, simulationId, entry)
  assert.equal(duplicate.ok, true)
  assert.equal(duplicate.value.entries.length, 1)
})

test('rejects invalid stored history without deleting it', () => {
  const storage = createStorage()
  storage.setItem('crowd-control:chat-history:v1:worked-demo', '{')

  const result = readChatHistory(storage, simulationId)

  assert.equal(result.ok, false)
  assert.match(result.error, /not valid JSON/)
  assert.equal(storage.getItem('crowd-control:chat-history:v1:worked-demo'), '{')
})

test('reports browser storage failures', () => {
  const unavailableStorage = {
    getItem() { throw new Error('blocked') },
    setItem() { throw new Error('blocked') },
  }
  const result = readChatHistory(unavailableStorage, simulationId)
  assert.deepEqual(result, {
    ok: false,
    error: 'Could not read intervention history from browser storage.',
  })
})

test('rejects an entry with mismatched request and acknowledgement IDs', () => {
  const storage = createStorage()
  const result = appendChatHistory(storage, simulationId, {
    ...entry,
    acknowledgement: { ...entry.acknowledgement, requestId: 'different-request' },
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /IDs must match/)
})
