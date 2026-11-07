import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { CompileOutput, WorkerMessage } from '@crowd-control/contract'
import { createMockEndpoint, type MockClock } from './mockEndpoint.ts'

const compiled = JSON.parse(readFileSync(new URL('../../../contract/fixtures/compile-output.json', import.meta.url), 'utf8')) as CompileOutput
const header = { schemaVersion: 1, simulationId: 'worked-demo' } as const
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function manualClock() {
  const clock = {
    time: 0,
    callback: null as (() => void) | null,
    now: () => clock.time,
    every(_intervalMs: number, callback: () => void) {
      clock.callback = callback
      return () => { clock.callback = null }
    },
    /** Advances wall-clock time and runs one pacing iteration if playing. */
    elapse(ms: number) {
      clock.time += ms
      clock.callback?.()
    },
  }
  return clock satisfies MockClock
}

test('messages arrive asynchronously and stop after unsubscribe', async () => {
  const endpoint = createMockEndpoint({ clock: manualClock() })
  const received: WorkerMessage[] = []
  const unsubscribe = endpoint.subscribe((message) => received.push(message))
  endpoint.send({ ...header, commandId: 'load', type: 'load', compiled, history: { historyRevision: 0, records: [], outcomes: [] } })
  assert.equal(received.length, 0, 'delivery is asynchronous, like a real worker')
  await flush()
  assert.deepEqual(received.map((m) => m.type), ['ack', 'scene', 'frame', 'metrics'])
  unsubscribe()
  endpoint.send({ ...header, commandId: 'step', type: 'step', ticks: 1 })
  await flush()
  assert.equal(received.length, 4)
  assert.equal(endpoint.kind, 'mock')
  endpoint.dispose()
})

test('playback paces wall-clock time into fixed ticks at the selected speed', async () => {
  const clock = manualClock()
  const endpoint = createMockEndpoint({ clock })
  const frames: number[] = []
  endpoint.subscribe((message) => { if (message.type === 'frame') frames.push(message.frame.tick) })
  endpoint.send({ ...header, commandId: 'load', type: 'load', compiled, history: { historyRevision: 0, records: [], outcomes: [] } })
  assert.equal(clock.callback, null, 'a loaded simulation starts paused')

  endpoint.send({ ...header, commandId: 'speed', type: 'speed', multiplier: 4 })
  endpoint.send({ ...header, commandId: 'play', type: 'resume' })
  assert.ok(clock.callback, 'resume starts the pacing loop')
  clock.elapse(1000)
  await flush()
  assert.equal(frames.at(-1), 40, '4× for one second at dt 0.1 is 40 ticks')

  endpoint.send({ ...header, commandId: 'pause', type: 'pause' })
  assert.equal(clock.callback, null, 'pause stops the loop')
  endpoint.dispose()
})
