import { z } from 'zod'
import {
  ApplyAckSchema,
  CreateInterventionRequestSchema,
  IdSchema,
  SCHEMA_VERSION,
  parseContract,
  type CreateInterventionRequest,
} from '@crowd-control/contract'

export const ChatHistoryEntrySchema = z.strictObject({
  prompt: z.string().min(1),
  request: CreateInterventionRequestSchema,
  acknowledgement: ApplyAckSchema,
  recordedAt: z.string().datetime(),
}).superRefine((entry, context) => {
  if (!('operations' in entry.request)) {
    context.addIssue({ code: 'custom', message: 'Chat history only supports created interventions' })
  } else if (entry.request.requestId !== entry.acknowledgement.requestId) {
    context.addIssue({ code: 'custom', message: 'Request and acknowledgement IDs must match' })
  }
})

export const ChatHistorySchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  simulationId: IdSchema,
  entries: z.array(ChatHistoryEntrySchema),
}).superRefine((history, context) => {
  if (history.entries.some((entry) => entry.request.simulationId !== history.simulationId)) {
    context.addIssue({ code: 'custom', message: 'Chat history contains an entry for another simulation' })
  }
  if (new Set(history.entries.map((entry) => entry.request.requestId)).size !== history.entries.length) {
    context.addIssue({ code: 'custom', message: 'Chat history contains duplicate request IDs' })
  }
})

export type ChatHistoryEntry = z.infer<typeof ChatHistoryEntrySchema>
export type ChatHistory = z.infer<typeof ChatHistorySchema>
export type CreateFollowupRequest = CreateInterventionRequest
export type HistoryStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}
export type HistoryResult<T> = { ok: true; value: T } | { ok: false; error: string }

const storageKey = (simulationId: string) => `crowd-control:chat-history:v${SCHEMA_VERSION}:${encodeURIComponent(simulationId)}`

export function readChatHistory(storage: HistoryStorage, simulationId: string): HistoryResult<ChatHistory> {
  let serialized: string | null
  try {
    serialized = storage.getItem(storageKey(simulationId))
  } catch {
    return { ok: false, error: 'Could not read intervention history from browser storage.' }
  }
  if (serialized === null) {
    return { ok: true, value: { schemaVersion: SCHEMA_VERSION, simulationId, entries: [] } }
  }

  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    return { ok: false, error: 'Saved intervention history is not valid JSON; it was left unchanged.' }
  }

  const parsed = parseContract(ChatHistorySchema, value)
  if (!parsed.ok) {
    return { ok: false, error: `Saved intervention history failed validation: ${parsed.error.message}` }
  }
  if (parsed.value.simulationId !== simulationId) {
    return { ok: false, error: 'Saved intervention history belongs to a different simulation.' }
  }
  return { ok: true, value: parsed.value }
}

export function appendChatHistory(
  storage: HistoryStorage,
  simulationId: string,
  entry: ChatHistoryEntry,
): HistoryResult<ChatHistory> {
  const existing = readChatHistory(storage, simulationId)
  if (!existing.ok) return existing
  const duplicate = existing.value.entries.find((item) => item.request.requestId === entry.request.requestId)
  if (duplicate) {
    if (JSON.stringify(duplicate) === JSON.stringify(entry)) return existing
    return { ok: false, error: 'This request ID already exists in intervention history with different content.' }
  }

  const parsed = parseContract(ChatHistorySchema, {
    ...existing.value,
    entries: [...existing.value.entries, entry],
  })
  if (!parsed.ok) {
    return { ok: false, error: `Could not save intervention history: ${parsed.error.message}` }
  }
  try {
    storage.setItem(storageKey(simulationId), JSON.stringify(parsed.value))
  } catch {
    return { ok: false, error: 'The intervention was applied, but browser storage could not save its history.' }
  }
  return { ok: true, value: parsed.value }
}
