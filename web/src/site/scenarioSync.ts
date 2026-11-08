import { loadAssistant, saveScenarios } from '../sim/assistantStore.ts'
import type { Scenario } from '../sim/scenario.ts'
import type { Fetcher } from './venueSync.ts'

/**
 * Keeps the person's own scenarios (written by the assistant) in their account, the way floor
 * plans are: this browser's copy is the working set pages read; the account is where they live
 * between devices. For each scenario the newer save wins.
 */

async function reason(response: Response): Promise<string> {
  const payload: unknown = await response.json().catch(() => null)
  return typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`
}

const stamped = (scenario: Scenario): Scenario & { savedAt: string } => ({ ...scenario, savedAt: scenario.savedAt ?? new Date(0).toISOString() })

/** Saves one scenario (new or renamed) to the account. Returns why not, or null. */
export async function pushScenario(fetcher: Fetcher, scenario: Scenario): Promise<string | null> {
  try {
    const response = await fetcher(`/api/scenarios/${encodeURIComponent(scenario.id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stamped(scenario)),
    })
    return response.ok ? null : await reason(response)
  } catch {
    return 'the server can’t be reached'
  }
}

export async function deleteAccountScenario(fetcher: Fetcher, id: string): Promise<string | null> {
  try {
    const response = await fetcher(`/api/scenarios/${encodeURIComponent(id)}`, { method: 'DELETE' })
    return response.ok || response.status === 404 ? null : await reason(response)
  } catch {
    return 'the server can’t be reached'
  }
}

/** Brings account scenarios down and sends this browser's up; the newer copy of each wins. */
export async function syncScenarios(fetcher: Fetcher): Promise<{ downloaded: number; uploaded: number; error: string | null }> {
  let account: Scenario[]
  try {
    const response = await fetcher('/api/scenarios')
    if (!response.ok) return { downloaded: 0, uploaded: 0, error: await reason(response) }
    const payload = await response.json() as { scenarios?: Scenario[] }
    account = Array.isArray(payload.scenarios) ? payload.scenarios : []
  } catch {
    return { downloaded: 0, uploaded: 0, error: 'the server can’t be reached' }
  }
  const local = loadAssistant().scenarios
  const time = (s: Scenario) => Date.parse(s.savedAt ?? '') || 0
  const byId = new Map<string, Scenario>()
  for (const scenario of [...local, ...account]) {
    const seen = byId.get(scenario.id)
    byId.set(scenario.id, seen && time(seen) >= time(scenario) ? seen : scenario)
  }
  const merged = [...byId.values()].sort((a, b) => time(a) - time(b))
  const accountTimes = new Map(account.map((s) => [s.id, time(s)]))
  const localTimes = new Map(local.map((s) => [s.id, time(s)]))
  const downloaded = merged.filter((s) => localTimes.get(s.id) !== time(s)).length
  if (downloaded > 0) saveScenarios(merged)
  let error: string | null = null
  let uploaded = 0
  for (const scenario of merged.filter((s) => accountTimes.get(s.id) !== time(s))) {
    const failed = await pushScenario(fetcher, scenario)
    if (failed) error = failed
    else uploaded++
  }
  return { downloaded, uploaded, error }
}
