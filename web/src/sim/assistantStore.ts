import type { CreateInterventionRequest, InventoryItem, ScenarioPlan } from '@crowd-control/contract'
import type { AskKind } from './assistant.ts'
import type { Scenario } from './scenario.ts'

/**
 * The Assistant's conversations, one per scenario, and the scenarios it wrote, kept in this
 * browser so a reload doesn't lose them. A conversation is about the scenario it was had in:
 * switching scenarios switches conversations. Storage can be missing or full; then the
 * assistant simply starts fresh.
 */

export type Message =
  | { id: number; from: 'you'; text: string; kind: AskKind }
  | { id: number; from: 'assistant'; text: string; tone: 'info' | 'error'; evidence?: string[] }
  | { id: number; from: 'assistant'; plan: ScenarioPlan; name?: string; prompt: string; where: string | null; status: 'ready' | 'running' | 'discarded'; note?: string }
  | { id: number; from: 'assistant'; change: CreateInterventionRequest; prompt: string; inventory: InventoryItem[]; status: 'ready' | 'applied' | 'discarded'; note?: string }

export type AssistantState = { threads: Record<string, Message[]>; scenarios: Scenario[] }

const KEY = 'crowd-control:assistant'
/** Enough history to scroll back through, small enough to stay well within browser storage. */
const MAX_MESSAGES = 60
const MAX_THREADS = 30

type KeyValue = { getItem(key: string): string | null; setItem(key: string, value: string): void }
function store(): KeyValue {
  const storage = (globalThis as unknown as { localStorage?: KeyValue }).localStorage
  if (!storage) throw new Error('No storage')
  return storage
}

/**
 * Everything saved. The single shared conversation of earlier versions belonged to no one
 * scenario, so it is left behind rather than shown in the wrong place.
 */
export function loadAssistant(): AssistantState {
  try {
    const raw = store().getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<AssistantState>) : {}
    const threads = typeof parsed.threads === 'object' && parsed.threads !== null ? parsed.threads : {}
    return { threads, scenarios: Array.isArray(parsed.scenarios) ? parsed.scenarios : [] }
  } catch {
    return { threads: {}, scenarios: [] }
  }
}

function saveAssistant(state: AssistantState) {
  try {
    // Keep the most recently used conversations (object keys keep insertion order).
    const entries = Object.entries(state.threads).filter(([, messages]) => messages.length > 0).slice(-MAX_THREADS)
    const threads = Object.fromEntries(entries.map(([id, messages]) => [id, messages.slice(-MAX_MESSAGES)]))
    store().setItem(KEY, JSON.stringify({ threads, scenarios: state.scenarios }))
  } catch {
    // Not saved; the conversation still works for this visit.
  }
}

/**
 * The last few turns of a conversation as plain text, sent with a follow-up so the planner reads
 * "no, just some of them" against what was asked before. Empty when there's nothing before.
 */
export function recentChat(messages: readonly Message[], turns = 6): string {
  const lines = messages.slice(-turns).flatMap((m): string[] => {
    if (m.from === 'you') return [`Person: ${m.text}`]
    if ('text' in m) return [`Assistant: ${m.text}`]
    if ('change' in m) return [`Assistant proposed a change (${m.status === 'applied' ? 'applied' : m.status === 'discarded' ? 'discarded' : 'not applied yet'}): ${m.change.label ?? m.prompt}`]
    return [`Assistant proposed a new scenario${m.name ? ` "${m.name}"` : ''}`]
  })
  return lines.length > 0 ? ['The conversation so far (the latest request above refers to it):', ...lines].join('\n') : ''
}

/** One scenario's conversation. A change applied before a reload belonged to that earlier run. */
export function loadThread(scenarioId: string): Message[] {
  const messages = loadAssistant().threads[scenarioId]
  if (!Array.isArray(messages)) return []
  return messages.map((m): Message => ('change' in m && m.status === 'applied' ? { ...m, note: 'Applied in an earlier run.' } : m))
}

/** Saves one scenario's conversation, moving it to the most recent. */
export function saveThread(scenarioId: string, messages: Message[]) {
  const state = loadAssistant()
  const { [scenarioId]: _previous, ...others } = state.threads
  saveAssistant({ ...state, threads: { ...others, [scenarioId]: messages } })
}

export function saveScenarios(scenarios: Scenario[]) { saveAssistant({ ...loadAssistant(), scenarios }) }
