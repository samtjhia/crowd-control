import type { CreateInterventionRequest, InventoryItem, ScenarioPlan } from '@crowd-control/contract'
import type { AskKind } from './assistant.ts'
import type { Scenario } from './scenario.ts'

/**
 * The Assistant's conversation and the scenarios it wrote, kept in this browser so a reload
 * doesn't lose them. Storage can be missing or full; then the assistant simply starts fresh.
 */

export type Message =
  | { id: number; from: 'you'; text: string; kind: AskKind }
  | { id: number; from: 'assistant'; text: string; tone: 'info' | 'error' }
  | { id: number; from: 'assistant'; plan: ScenarioPlan; prompt: string; where: string | null; status: 'ready' | 'running' | 'discarded'; note?: string }
  | { id: number; from: 'assistant'; change: CreateInterventionRequest; prompt: string; inventory: InventoryItem[]; status: 'ready' | 'applied' | 'discarded'; note?: string }

export type AssistantState = { messages: Message[]; scenarios: Scenario[] }

const KEY = 'crowd-control:assistant'
/** Enough history to scroll back through, small enough to stay well within browser storage. */
const MAX_MESSAGES = 60

type KeyValue = { getItem(key: string): string | null; setItem(key: string, value: string): void }
function store(): KeyValue {
  const storage = (globalThis as unknown as { localStorage?: KeyValue }).localStorage
  if (!storage) throw new Error('No storage')
  return storage
}

export function loadAssistant(): AssistantState {
  try {
    const raw = store().getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<AssistantState>) : {}
    const messages = Array.isArray(parsed.messages) ? parsed.messages : []
    // A change applied before the reload belongs to that earlier run; it can't be re-applied blindly.
    const settled = messages.map((m): Message => ('change' in m && m.status === 'applied' ? { ...m, note: 'Applied in an earlier run.' } : m))
    return { messages: settled, scenarios: Array.isArray(parsed.scenarios) ? parsed.scenarios : [] }
  } catch {
    return { messages: [], scenarios: [] }
  }
}

export function saveAssistant(state: AssistantState) {
  try {
    store().setItem(KEY, JSON.stringify({ messages: state.messages.slice(-MAX_MESSAGES), scenarios: state.scenarios }))
  } catch {
    // Not saved; the conversation still works for this visit.
  }
}

/** Reads one part, writes it back with the other part unchanged. */
export function saveMessages(messages: Message[]) { saveAssistant({ ...loadAssistant(), messages }) }
export function saveScenarios(scenarios: Scenario[]) { saveAssistant({ ...loadAssistant(), scenarios }) }
