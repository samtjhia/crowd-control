import {
  CreateInterventionRequestSchema,
  PlannerReplySchema,
  PlannerRequestSchema,
  SCHEMA_VERSION,
  parseContract,
  serviceResultSchema,
  type Capabilities,
  type CreateInterventionRequest,
  type EventRecord,
  type InterventionSummary,
  type InventoryItem,
  type LayoutSource,
  type MetricSample,
  type PlannerRequest,
  type ScenarioPlan,
} from '@crowd-control/contract'
import type { Place } from './places.ts'
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
 * Changes to a running simulation: what both the mock and the engine accept as live requests:
 * add or remove people, place objects such as a danger, set doors and speeds, give or clear
 * goals (including queueing at a desk and using a table or counter), sound events, add or remove
 * rules, and schedule any of these. (Follow needs a person's ID, which the planner can't see, so
 * it is left out.) Any layout source is allowed, since the change is made to whatever map is
 * loaded (a prepared venue or an uploaded plan as well as a generated building). Objects can be
 * placed by a rectangle, so "a check-in desk at point A" lands on the spot that was marked.
 */
export const CHANGE_CAPABILITIES: Capabilities = {
  operations: ['add', 'spawn', 'set', 'schedule', 'assign_goal', 'clear_goal', 'emit', 'define_rule', 'remove_rule', 'remove'],
  goals: ['reach', 'avoid', 'wait', 'wander', 'queue', 'interact', 'sequence'],
  geometry: ['rectangle'], layouts: ['generate', 'lookup', 'upload'], entityMetrics: [], editableHistory: false,
}

/** A change to this run, a whole new scenario, or a question about what happened in this run. */
export type AskKind = 'scenario' | 'change' | 'why'

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
  /** For "why" questions: the run's measurements and events, the only evidence the answer may use. */
  metricSamples?: MetricSample[]
  events?: EventRecord[]
}

/** At most `limit` items, spread evenly and keeping the last, so a long run still fits a request. */
export function spread<T>(items: readonly T[], limit: number): T[] {
  if (items.length <= limit) return [...items]
  const step = (items.length - 1) / (limit - 1)
  return Array.from({ length: limit }, (_, k) => items[Math.round(k * step)]!)
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
      ...(context.kind === 'why' && { askWhy: true, metricSamples: spread(context.metricSamples ?? [], 100), events: (context.events ?? []).slice(-100) }),
    },
  })
}

/** What the Assistant shows for a reply. */
export type Outcome =
  | { type: 'scenario'; plan: ScenarioPlan; title?: string }
  | { type: 'change'; request: CreateInterventionRequest }
  | { type: 'message'; text: string; tone: 'info' | 'error'; evidence?: string[] }

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
  // The server's sign-in check answers { ok: false, error: "…" } before the planner runs.
  if (typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string') {
    return { type: 'message', tone: 'error', text: `The assistant is unavailable: ${payload.error}` }
  }
  const result = parseContract(serviceResultSchema(PlannerReplySchema), payload)
  if (!result.ok) return { type: 'message', tone: 'error', text: 'The assistant sent back something unreadable. Try again.' }
  if (!result.value.ok) return { type: 'message', tone: 'error', text: result.value.error.message }
  return interpret(result.value.value, kind, request)
}

/** Checks a reply against what was asked, the way the planner page does. */
export function interpret(reply: Extract<ReturnType<typeof PlannerReplySchema.parse>, object>, kind: AskKind, request: PlannerRequest): Outcome {
  if (kind === 'why') {
    return reply.kind === 'answer'
      ? { type: 'message', tone: 'info', text: reply.text, evidence: reply.evidenceEventIds }
      : reply.kind === 'clarification' ? { type: 'message', tone: 'info', text: reply.message }
      : { type: 'message', tone: 'info', text: 'That came back as a change rather than an answer. Ask about something that has already happened in this run.' }
  }
  switch (reply.kind) {
    case 'scenario':
      return kind === 'scenario'
        ? { type: 'scenario', plan: reply.plan, ...(reply.title && { title: reply.title }) }
        : { type: 'message', tone: 'info', text: 'That came back as a whole new scenario rather than a change. Switch to “New scenario” if that’s what you want, or describe a change to this run.' }
    case 'followup': {
      if (kind !== 'change') return { type: 'message', tone: 'info', text: 'That came back as a change to the current run rather than a new scenario. Try describing the whole scenario.' }
      if (!('operations' in reply.request) || reply.request.simulationId !== request.simulationId || reply.request.requestId !== request.requestId) {
        return { type: 'message', tone: 'error', text: 'The assistant suggested a kind of change the simulator can’t apply. Nothing was changed.' }
      }
      const checked = parseContract(CreateInterventionRequestSchema, reply.request, { capabilities: CHANGE_CAPABILITIES })
      if (!checked.ok) return { type: 'message', tone: 'error', text: `That change didn’t pass the simulator’s checks: ${checked.error.message}` }
      // Live changes can place objects (desks, stands, dangers), not walls, rooms or doors.
      if (addsStructure(checked.value.operations)) return { type: 'message', tone: 'info', text: 'That change would add walls, rooms or doors, which can’t be changed while a run plays. Edit the floor plan instead, or place an object.' }
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

/**
 * The line added to a new-scenario request in a venue: how many people each area holds at the
 * start, so the planner writes crowds that fit rather than plans the simulator must refuse.
 */
export function capacityNote(capacities: Record<string, number>): string {
  const rooms = Object.entries(capacities).filter(([, n]) => n > 0)
  if (rooms.length === 0) return ''
  const list = rooms.map(([id, n]) => `${id} ${n}`).join(', ')
  return `How many people each area can hold at the start (all spawns into one area together must stay at or below this): ${list}.`
}

const time = (s: number) => (s >= 90 ? `${Math.round(s / 60)} min` : `${Math.round(s * 10) / 10} s`)

/**
 * The line added to a request about the places people can use on the map and what each does,
 * so the planner can write visits that make sense ("check in, find a table, then roam") and
 * target them by real ID. Identical objects (24 tables) are listed once, as a range.
 */
export function placesNote(places: readonly Place[]): string {
  if (places.length === 0) return ''
  const describe = (place: Place): string => {
    if (place.hazard) return 'a danger; tell people to avoid it with goal {"kind":"avoid","target":{"ids":[its ID]},"distance":metres}'
    if (place.door) return `a check-in point: a door from ${place.door.connects[0]} to ${place.door.connects[1]} that takes ${time(place.door.traversalTime)} per person; anyone walking between those areas passes through it`
    const parts: string[] = []
    if (place.interaction) parts.push(`${place.interaction.slots} at a time, ${time(place.interaction.duration)} each; use with goal {"kind":"interact","target":{"ids":[one ID]}}`)
    if (place.capacity) parts.push(`holds ${place.capacity.maximumOccupants}; line up with goal {"kind":"queue","target":{"ids":[one ID]}}`)
    return parts.join('; ') || 'an object'
  }
  // Group objects that differ only by a trailing number ("Table 1" … "Table 24").
  const groups = new Map<string, Place[]>()
  for (const place of places) {
    const key = `${(place.label ?? place.id).replace(/\s*\d+$/, '')}|${describe(place)}|${place.tags.join(',')}`
    groups.set(key, [...(groups.get(key) ?? []), place])
  }
  const lines = [...groups.values()].map((group) => {
    const first = group[0]!
    const name = (first.label ?? first.id).replace(/\s*\d+$/, '')
    const ids = group.length === 1 ? first.id : `${group.length} of them, ${first.id} … ${group.at(-1)!.id}`
    const nearest = group.length > 1 && first.tags.length > 0
      ? `; interact with one ID sends everyone to that same one, so to spread people out (a seat at any table), use reach {"tags":["${first.tags[0]}"]} with "selection":"nearest" and then a wait`
      : ''
    return `- ${name} (${ids}): ${describe(first)}${nearest}.`
  })
  return `Places people can use on this map (refer to them by these IDs):\n${lines.join('\n')}`
}

type Op = CreateInterventionRequest['operations'][number]

/** Whether any operation (at any depth) adds something other than an object. */
function addsStructure(operations: readonly Op[]): boolean {
  return operations.some((o) => (o.op === 'add' && o.entity.kind !== 'object') || ((o.op === 'schedule' || o.op === 'define_rule') && addsStructure(o.operations as Op[])))
}
type Goal = Extract<Op, { op: 'assign_goal' }>['goal']
type Target = Extract<Goal, { kind: 'reach' }>['target']

/**
 * Turns goal targets chosen by tag or kind ("the exits") into the explicit room and door IDs they
 * mean on the loaded map, so a change works in the engine too (it requires explicit goal targets).
 * Who a change applies to is still resolved live when it runs; it is only limited to people.
 */
export function pinGoalTargets(request: CreateInterventionRequest, inventory: InventoryItem[]): CreateInterventionRequest {
  const places = inventory.filter((item) => item.kind === 'zone' || item.kind === 'portal' || item.kind === 'object')
  /** `single`: queue, interact and follow need exactly one target, so several matches stay as written. */
  const pin = (target: Target, single = false): Target => {
    if ('binding' in target || target.ids || target.inside || target.near || target.where || target.sample) return target
    const ids = places
      .filter((item) => (!target.kind || item.kind === target.kind) && (!target.tags || target.tags.every((tag) => item.tags.includes(tag))) && (!target.label || item.label === target.label))
      .map((item) => item.id)
    return ids.length > 0 && (!single || ids.length === 1) ? { ids } : target
  }
  const goal = (g: Goal): Goal => {
    switch (g.kind) {
      case 'reach': case 'avoid': return { ...g, target: pin(g.target) }
      case 'follow': case 'queue': case 'interact': return { ...g, target: pin(g.target, true) }
      case 'wander': return { ...g, inside: pin(g.inside) }
      case 'wait': return g.inside ? { ...g, inside: pin(g.inside) } : g
      case 'sequence': return { ...g, goals: g.goals.map(goal) }
    }
  }
  // Rooms and doors can share tags with people ("audience" on the concert floor), so a change
  // aimed at people by tag is limited to people; otherwise the engine tries to move the room.
  const people = <S extends Target>(s: S): S => ('binding' in s || s.ids || s.kind ? s : { ...s, kind: 'agent' })
  const op = (o: Op): Op => {
    if (o.op === 'assign_goal') return { ...o, targets: people(o.targets), goal: goal(o.goal) }
    if (o.op === 'clear_goal' || o.op === 'remove') return { ...o, targets: people(o.targets) }
    if (o.op === 'schedule' || o.op === 'define_rule') return { ...o, operations: o.operations.map(op) } as Op
    return o
  }
  return { ...request, operations: request.operations.map(op) }
}

/** A refusal from the simulator, in words a person can act on. */
export function explainRefusal(message: string): string {
  if (/matched no/i.test(message)) return 'Nobody matches that right now: the people it names aren’t there yet, or no longer exist. Try again once they are, or name a different group.'
  return `The simulator refused it: ${message}`
}

/** A short title for a scenario the assistant wrote, from the person's own words. */
export function titleFrom(prompt: string): string {
  const words = prompt.trim().replace(/\s+/g, ' ')
  return words.length <= 40 ? words : `${words.slice(0, 38).trimEnd()}…`
}
