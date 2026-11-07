import {
  CreateInterventionRequestSchema,
  PlannerReplySchema,
  PlannerRequestSchema,
  SCHEMA_VERSION,
  parseContract,
  serviceResultSchema,
  type Capabilities,
  type CreateInterventionRequest,
  type InterventionSummary,
  type InventoryItem,
  type LayoutSource,
  type MetricSample,
  type PlannerRequest,
  type ScenarioPlan,
} from '@crowd-control/contract'
import { CAPABILITIES } from './scenario.ts'

/**
 * The simulator's Assistant: turns what the person types into a request for the server-side
 * planner (Role C's /api/plan, Gemini), and its reply into something the simulator can show and
 * apply. The planner's convention: `editableHistory: true` asks for a NEW scenario plan,
 * `false` for a change to the running one. Nothing is applied until the person approves it.
 */

/** A new scenario may use anything the compiler and simulator support. */
export const SCENARIO_CAPABILITIES: Capabilities = { ...CAPABILITIES, editableHistory: true }

/**
 * Changes to a running simulation: what the worker accepts as live requests today. Any layout
 * source is allowed, since the change is made to whatever map is loaded (a prepared venue or an
 * uploaded plan as well as a generated building); the operations still can't change the map.
 */
export const CHANGE_CAPABILITIES: Capabilities = {
  operations: ['spawn', 'set', 'schedule'], goals: [], geometry: [], layouts: ['generate', 'lookup', 'upload'], entityMetrics: [], editableHistory: false,
}

export type AskKind = 'scenario' | 'change'

export type AskContext = {
  simulationId: string
  prompt: string
  kind: AskKind
  /** The map in use, so a new scenario can stay in this venue and a change can name its rooms. */
  layout?: LayoutSource
  inventory: InventoryItem[]
  summary?: MetricSample
  interventions: InterventionSummary[]
  requestId?: string
}

export function buildRequest(context: AskContext) {
  return parseContract(PlannerRequestSchema, {
    schemaVersion: SCHEMA_VERSION,
    simulationId: context.simulationId,
    requestId: context.requestId ?? crypto.randomUUID(),
    prompt: context.prompt.trim(),
    context: {
      capabilities: context.kind === 'scenario' ? SCENARIO_CAPABILITIES : CHANGE_CAPABILITIES,
      ...(context.layout && { layout: context.layout }),
      inventory: context.inventory,
      ...(context.summary && { summary: context.summary }),
      interventions: context.interventions,
    },
  })
}

/** What the Assistant shows for a reply. */
export type Outcome =
  | { type: 'scenario'; plan: ScenarioPlan }
  | { type: 'change'; request: CreateInterventionRequest }
  | { type: 'message'; text: string; tone: 'info' | 'error' }

type Fetcher = (url: string, init: RequestInit) => Promise<{ json(): Promise<unknown> }>

/** Sends a request to the planner and reads its reply; any failure becomes a message to show. */
export async function askPlanner(request: PlannerRequest, kind: AskKind, fetcher: Fetcher = fetch, timeoutMs = 50_000): Promise<Outcome> {
  let payload: unknown
  try {
    const response = await fetcher('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    })
    payload = await response.json()
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError'
    return {
      type: 'message', tone: 'error',
      text: timedOut
        ? 'The assistant took too long to answer. Try again.'
        : 'Can’t reach the assistant. Start the planner server (npm run dev:server) and try again.',
    }
  }
  const result = parseContract(serviceResultSchema(PlannerReplySchema), payload)
  if (!result.ok) return { type: 'message', tone: 'error', text: 'The assistant sent back something unreadable. Try again.' }
  if (!result.value.ok) return { type: 'message', tone: 'error', text: result.value.error.message }
  return interpret(result.value.value, kind, request)
}

/** Checks a reply against what was asked, the way the planner page does. */
export function interpret(reply: Extract<ReturnType<typeof PlannerReplySchema.parse>, object>, kind: AskKind, request: PlannerRequest): Outcome {
  switch (reply.kind) {
    case 'scenario':
      return kind === 'scenario'
        ? { type: 'scenario', plan: reply.plan }
        : { type: 'message', tone: 'info', text: 'That came back as a whole new scenario rather than a change. Switch to “New scenario” if that’s what you want, or describe a change to this run.' }
    case 'followup': {
      if (kind !== 'change') return { type: 'message', tone: 'info', text: 'That came back as a change to the current run rather than a new scenario. Try describing the whole scenario.' }
      if (!('operations' in reply.request) || reply.request.simulationId !== request.simulationId || reply.request.requestId !== request.requestId) {
        return { type: 'message', tone: 'error', text: 'The assistant suggested a kind of change the simulator can’t apply. Nothing was changed.' }
      }
      const checked = parseContract(CreateInterventionRequestSchema, reply.request, { capabilities: CHANGE_CAPABILITIES })
      if (!checked.ok) return { type: 'message', tone: 'error', text: `That change didn’t pass the simulator’s checks: ${checked.error.message}` }
      return { type: 'change', request: checked.value }
    }
    case 'clarification':
      return { type: 'message', tone: 'info', text: reply.message }
    case 'answer':
      return { type: 'message', tone: 'info', text: reply.text }
    case 'query':
      return { type: 'message', tone: 'info', text: 'The assistant needs to look something up that it can’t see yet. Try naming the rooms, doors or people you mean.' }
  }
}

/** A short title for a scenario the assistant wrote, from the person's own words. */
export function titleFrom(prompt: string): string {
  const words = prompt.trim().replace(/\s+/g, ' ')
  return words.length <= 40 ? words : `${words.slice(0, 38).trimEnd()}…`
}
