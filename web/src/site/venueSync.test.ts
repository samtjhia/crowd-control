import assert from 'node:assert/strict'
import test from 'node:test'
import type { PreparedMap } from '@crowd-control/contract'
import { loadSavedVenues, saveVenue, type SavedVenue } from '../sim/savedVenues.ts'
import { syncVenues, type Fetcher } from './venueSync.ts'

// A tiny in-memory localStorage, so the browser copy can be read and written.
const memory = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  value: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v) },
  configurable: true,
})

function venue(id: string, savedAt: string, name = id): SavedVenue {
  const map: PreparedMap = {
    id, revision: 'r1',
    source: { mode: 'upload', assetId: id, revision: 'r1', page: 1, calibration: null, sourceToWorld: [1, 0, 0, 1, 0, 0] },
    grid: { width: 2, height: 1, cellSize: 1, units: 'model', blocked: [0, 0], traversalCost: [1, 1], zoneIndex: [1, 1], portalIndex: [0, 0], zoneIds: [null, 'hall'], portalIds: [null] },
    entities: [{ id: 'hall', kind: 'zone', label: 'Hall' }],
    reviewed: true,
  }
  return { name, floor: 'Ground', savedAt, map }
}

function account(stored: SavedVenue[], status = 200) {
  const puts: SavedVenue[] = []
  const fetcher: Fetcher = async (_url, init) => {
    if (!init?.method) return new Response(JSON.stringify(status === 200 ? { ok: true, venues: stored } : { ok: false, error: 'Tiger Data is not available.' }), { status })
    puts.push(JSON.parse(String(init.body)))
    return new Response('{"ok":true}', { status: 200 })
  }
  return { fetcher, puts }
}

test('signing in brings account plans down, sends browser-only plans up, and keeps the newer copy', async () => {
  memory.clear()
  saveVenue(venue('only-here', '2026-11-01T10:00:00.000Z'))
  saveVenue(venue('both', '2026-11-05T10:00:00.000Z', 'Newer here'))
  const { fetcher, puts } = account([venue('only-there', '2026-11-03T10:00:00.000Z'), venue('both', '2026-11-02T10:00:00.000Z', 'Older there')])
  const result = await syncVenues(fetcher)
  assert.deepEqual(result, { downloaded: 1, uploaded: 2, error: null })
  assert.deepEqual(loadSavedVenues().map((v) => v.name), ['Newer here', 'only-there', 'only-here'], 'newest first, newer copy kept')
  assert.deepEqual(puts.map((v) => v.name).sort(), ['Newer here', 'only-here'])
})

test('when the account is unreachable, the browser copy is left alone', async () => {
  memory.clear()
  saveVenue(venue('mine', '2026-11-01T10:00:00.000Z'))
  const { fetcher, puts } = account([], 503)
  assert.deepEqual(await syncVenues(fetcher), { downloaded: 0, uploaded: 0, error: 'Tiger Data is not available.' })
  assert.deepEqual(loadSavedVenues().map((v) => v.map.id), ['mine'])
  assert.equal(puts.length, 0)
})
