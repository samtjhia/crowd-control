import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { ModelPreset, ScenarioPlan } from '@crowd-control/contract'
import { loadAssistant, saveScenarios } from '../sim/assistantStore.ts'
import type { Scenario } from '../sim/scenario.ts'
import { syncScenarios } from './scenarioSync.ts'
import type { Fetcher } from './venueSync.ts'

const memory = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  value: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v) },
  configurable: true,
})
const plan = JSON.parse(readFileSync(new URL('../../../contract/fixtures/scenario-plan.json', import.meta.url), 'utf8')) as ScenarioPlan
const model = JSON.parse(readFileSync(new URL('../../../contract/fixtures/compile-output.json', import.meta.url), 'utf8')).resolvedModel as ModelPreset
const scenario = (id: string, title: string, savedAt: string): Scenario => ({ id, title, plan, model, savedAt })

test('your scenarios follow you between devices; a rename on one wins over the older copy', async () => {
  memory.clear()
  saveScenarios([scenario('assistant-a', 'Hacker check-in', '2026-11-07T10:00:00.000Z'), scenario('assistant-b', 'Old name', '2026-11-07T09:00:00.000Z')])
  const puts: Scenario[] = []
  const fetcher: Fetcher = async (_url, init) => {
    if (!init?.method) return new Response(JSON.stringify({ ok: true, scenarios: [scenario('assistant-b', 'Renamed elsewhere', '2026-11-07T11:00:00.000Z'), scenario('assistant-c', 'Fire drill', '2026-11-07T08:00:00.000Z')] }))
    puts.push(JSON.parse(String(init.body)))
    return new Response('{"ok":true}')
  }
  assert.deepEqual(await syncScenarios(fetcher), { downloaded: 2, uploaded: 1, error: null })
  assert.deepEqual(loadAssistant().scenarios.map((s) => s.title).sort(), ['Fire drill', 'Hacker check-in', 'Renamed elsewhere'])
  assert.deepEqual(puts.map((s) => s.id), ['assistant-a'], 'only the one the account didn’t have goes up')
})
