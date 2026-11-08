import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuthFetch } from '../site/useAuthFetch.ts'
import { Check, LoaderCircle, Play, RotateCcw, SendHorizontal, X } from 'lucide-react'
import type { CreateInterventionRequest, InterventionSummary, InventoryItem, ScenarioPlan } from '@crowd-control/contract'
import { describeOperations, describePlan, displayName } from '../planner/describe.ts'
import type { SimulationClient, SimulationView } from '../worker/simulationClient.ts'
import { askPlanner, buildRequest, capacityNote, explainRefusal, pinGoalTargets, placesNote, titleFrom, type AskKind } from './assistant.ts'
import { formatClock } from './incidents.ts'
import { placesInScene } from './places.ts'
import { loadPoints, pointsKeyForLayout, pointsKeyForSource, pointsNote, preparedGeometry, sceneGeometry } from './points.ts'
import { loadThread, saveThread, type Message } from './assistantStore.ts'
import type { VenueOption } from './scenario.ts'

/** A message before it gets an ID (Omit applied to each kind of message separately). */
type NewMessage = Message extends infer M ? (M extends Message ? Omit<M, 'id'> : never) : never

const SUGGESTIONS: Record<AskKind, string[]> = {
  change: ['Close the exit for 30 seconds', 'Add 20 more people in the busiest room', 'At 20 seconds, close the main door'],
  scenario: ['200 people leave a concert through two exits after an alarm at 30 seconds', 'A fire drill: every classroom empties to the yards when the alarm sounds'],
  why: ['Why did it get so crowded?', 'Why did people take so long to leave?', 'What happened after the alarm?'],
}

const KINDS: { kind: AskKind; label: string; placeholder: string; intro: string }[] = [
  { kind: 'change', label: 'Change this run', placeholder: 'Describe a change…', intro: 'Describe a change to this run. You’ll see what it would do before anything changes.' },
  { kind: 'scenario', label: 'New scenario', placeholder: 'Describe a scenario…', intro: 'Describe a whole scenario: the crowd, and what happens when. You’ll see the plan before it runs.' },
  { kind: 'why', label: 'Ask why', placeholder: 'Ask about this run…', intro: 'Ask about what has happened in this run so far. The answer uses only its measurements and events.' },
]

/** "Make up a building" in the Where picker. */
const GENERATE = 'generate'

type Props = {
  client: SimulationClient
  view: SimulationView
  /** The scenario this conversation is about; each scenario has its own. */
  scenarioId: string
  scenarioTitle: string
  /** Venues a new scenario can use, and the one loaded now (null for a made-up building). */
  venues: VenueOption[]
  currentVenueId: string | null
  /** Tries to build a plan without loading it; returns why it can't be built, or null. */
  onCheckPlan: (plan: ScenarioPlan) => string | null
  /** Compiles and loads a scenario the assistant wrote; returns why it can't, or the new scenario's ID. */
  onRunPlan: (plan: ScenarioPlan, title: string) => { error: string } | { id: string }
}

/**
 * The Assistant panel: describe a change to the running simulation, or a whole new scenario,
 * in plain language. The planner's answer is shown as a preview; nothing changes until the
 * person presses Apply or Run. A new scenario is test-built before it is shown, and if it can't
 * be built the reason goes back to the planner once for a corrected plan. Applied changes go
 * through the same request path as the map's click tools, so they appear in the Changes list.
 */
export function AssistantPanel({ client, view, scenarioId, scenarioTitle, venues, currentVenueId, onCheckPlan, onRunPlan }: Props) {
  const [messages, setMessages] = useState<Message[]>(() => loadThread(scenarioId))
  const [text, setText] = useState('')
  const [kind, setKind] = useState<AskKind>('change')
  const [where, setWhere] = useState<string>(currentVenueId ?? GENERATE)
  const [busy, setBusy] = useState(false)
  // The planner API needs the signed-in person's Auth0 token.
  const authFetch = useAuthFetch()
  const nextId = useRef(messages.reduce((max, m) => Math.max(max, m.id), 0) + 1)
  const list = useRef<HTMLOListElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  // A new scenario defaults to wherever the simulator is now.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setWhere(currentVenueId ?? GENERATE) }, [currentVenueId])
  useEffect(() => { saveThread(scenarioId, messages) }, [scenarioId, messages])
  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [messages, busy])

  const add = (message: NewMessage) => setMessages((all) => [...all, { ...message, id: nextId.current++ } as Message])
  const update = (id: number, patch: Partial<Message>) => setMessages((all) => all.map((m) => (m.id === id ? ({ ...m, ...patch } as Message) : m)))

  /** What is loaded right now, by real ID: rooms, doors and people. */
  const liveInventory = async (): Promise<InventoryItem[]> => {
    if (!view.simulationId) return []
    const reply = await client.command({ type: 'query', query: { kind: 'inventory' } })
    return reply.type === 'query_result' && reply.result.kind === 'inventory' ? reply.result.items : []
  }
  const venueFor = (id: string | null) => venues.find((venue) => venue.id === id) ?? null

  /**
   * Asks for a new scenario in the chosen place. Before showing it, test-build it; if it can't be
   * built, send the reason back once and show the corrected plan (or the reason, if that fails too).
   */
  const askScenario = async (prompt: string, place: string | null, problems: string[] = []): Promise<void> => {
    const venue = venueFor(place)
    const capacity = venue ? capacityNote(venue.capacities) : ''
    const places = venue ? placesNote(venue.places) : ''
    // Points marked on that venue ("point A"), described by area, doors and objects.
    const marked = venue ? pointsNote(loadPoints(pointsKeyForLayout(venue.layout)), preparedGeometry(venue.map)) : ''
    const wording = [
      prompt,
      ...(capacity ? [capacity] : []),
      ...(places ? [places] : []),
      ...(marked ? [marked] : []),
      ...(problems.length > 0 ? [`Your previous plans could not be built by the simulator: ${problems.join(' ')}\nReturn a corrected complete plan that keeps to what was asked but fits.`] : []),
    ].join('\n\n')
    const request = buildRequest({
      simulationId: view.simulationId ?? 'assistant', prompt: wording, kind: 'scenario',
      ...(venue && { layout: venue.layout }), inventory: venue?.inventory ?? [], interventions: [],
    })
    if (!request.ok) return add({ from: 'assistant', text: `Couldn’t prepare that request: ${request.error.message}`, tone: 'error' })
    const outcome = await askPlanner(request.value, 'scenario', authFetch)
    if (outcome.type === 'message') return add({ from: 'assistant', text: outcome.text, tone: outcome.tone })
    if (outcome.type !== 'scenario') return add({ from: 'assistant', text: 'That came back as a change rather than a scenario. Try again.', tone: 'info' })
    // The person chose where: the planner sometimes invents a lookalike building instead, whose
    // rooms and desks don't match the IDs it used, so the plan always runs in the chosen venue.
    const plan = venue ? { ...outcome.plan, layout: venue.layout } : outcome.plan
    const problem = onCheckPlan(plan)
    // Up to two corrections, each told every problem found so far.
    if (problem && problems.length < 2) {
      add({ from: 'assistant', text: `That plan didn’t fit: ${problem} Asking for a corrected version…`, tone: 'info' })
      return askScenario(prompt, place, [...problems, problem])
    }
    add({ from: 'assistant', plan, prompt, where: place, status: 'ready', ...(problem && { note: `This still can’t be built: ${problem}` }) })
  }

  const askChange = async (prompt: string) => {
    const interventions: InterventionSummary[] = view.changes.map((change) => ({ id: change.interventionId, revision: 1, label: change.label, at: change.at, deleted: false }))
    const inventory = await liveInventory()
    const venue = venueFor(currentVenueId)
    // What the tables, desks and any dangers on the map do, so the change can use them by ID.
    const places = view.scene ? placesNote(placesInScene(view.scene)) : ''
    // Points marked on this venue ("point A"), described by area, doors and objects.
    const marked = view.scene && view.simulationId ? pointsNote(loadPoints(pointsKeyForSource(view.scene.map.source, view.simulationId)), sceneGeometry(view.scene)) : ''
    const request = buildRequest({
      simulationId: view.simulationId ?? 'assistant', prompt: [prompt, places, marked].filter(Boolean).join('\n\n'), kind: 'change',
      ...(venue && { layout: venue.layout }), inventory, ...(view.metrics && { summary: view.metrics }), interventions,
    })
    if (!request.ok) return add({ from: 'assistant', text: `Couldn’t prepare that request: ${request.error.message}`, tone: 'error' })
    const outcome = await askPlanner(request.value, 'change', authFetch)
    if (outcome.type === 'change') add({ from: 'assistant', change: pinGoalTargets(outcome.request, inventory), prompt, inventory, status: 'ready' })
    else if (outcome.type === 'message') add({ from: 'assistant', text: outcome.text, tone: outcome.tone })
    else add({ from: 'assistant', text: 'That came back as a whole new scenario rather than a change. Switch to “New scenario” if that’s what you want.', tone: 'info' })
  }

  /**
   * A question about this run: the planner gets its measurements and events so far, and must
   * answer from them alone, citing the events it relied on (shown under the answer).
   */
  const askWhy = async (prompt: string) => {
    if (!view.simulationId || !view.current) return add({ from: 'assistant', tone: 'info', text: 'Press Play first: there’s nothing to ask about until the run has started.' })
    const [samples, events] = await Promise.all([
      client.command({ type: 'query', query: { kind: 'metrics' } }),
      client.command({ type: 'query', query: { kind: 'events' } }),
    ])
    const metricSamples = samples.type === 'query_result' && samples.result.kind === 'metrics' ? samples.result.samples : []
    const eventRecords = events.type === 'query_result' && events.result.kind === 'events' ? events.result.events : []
    const interventions: InterventionSummary[] = view.changes.map((change) => ({ id: change.interventionId, revision: 1, label: change.label, at: change.at, deleted: false }))
    const request = buildRequest({
      simulationId: view.simulationId, prompt, kind: 'why', inventory: await liveInventory(), interventions,
      ...(view.metrics && { summary: view.metrics }), metricSamples, events: eventRecords,
    })
    if (!request.ok) return add({ from: 'assistant', text: `Couldn’t prepare that question: ${request.error.message}`, tone: 'error' })
    const outcome = await askPlanner(request.value, 'why', authFetch)
    if (outcome.type !== 'message') return add({ from: 'assistant', tone: 'info', text: 'That came back as a change rather than an answer.' })
    // Cited events, as "Door closed (00:04)", in the order they happened.
    const cited = (outcome.evidence ?? []).flatMap((id) => eventRecords.filter((e) => e.id === id))
      .sort((a, b) => a.time - b.time)
      .map((e) => `${e.name.replaceAll('_', ' ')}${e.source ? ` · ${e.source.replaceAll('_', ' ')}` : ''} (${formatClock(e.time, false)})`)
    add({ from: 'assistant', text: outcome.text, tone: outcome.tone, ...(cited.length > 0 && { evidence: cited }) })
  }

  const send = async (event?: FormEvent) => {
    event?.preventDefault()
    const prompt = text.trim()
    if (!prompt || busy) return
    setText('')
    add({ from: 'you', text: prompt, kind })
    setBusy(true)
    try {
      if (kind === 'scenario') await askScenario(prompt, where === GENERATE ? null : where)
      else if (kind === 'why') await askWhy(prompt)
      else await askChange(prompt)
    } finally {
      setBusy(false)
      input.current?.focus()
    }
  }

  /**
   * Runs a scenario the assistant wrote. It becomes its own scenario with its own conversation,
   * which starts with the request that made it, so changes to it are asked about there.
   */
  const run = (id: number, plan: ScenarioPlan, prompt: string) => {
    const result = onRunPlan(plan, titleFrom(prompt))
    if ('error' in result) return update(id, { note: result.error })
    // Saved now: this panel is replaced by the new scenario's before its effects would run.
    saveThread(scenarioId, messages.map((m) => (m.id === id ? ({ ...m, status: 'running', note: undefined } as Message) : m)))
    saveThread(result.id, [
      { id: 1, from: 'you', text: prompt, kind: 'scenario' },
      { id: 2, from: 'assistant', tone: 'info', text: `Started this scenario from your request in “${scenarioTitle}”. Ask for changes to it here.` },
    ])
  }

  /** Asks the planner again for a plan that can be built, sending the reason this one can't. */
  const askAgain = async (id: number, plan: ScenarioPlan, prompt: string, place: string | null) => {
    const reason = onCheckPlan(plan)
    update(id, { status: 'discarded' })
    setBusy(true)
    try {
      await askScenario(prompt, place, reason ? [reason] : [])
    } finally {
      setBusy(false)
    }
  }

  const apply = async (id: number, change: CreateInterventionRequest, prompt: string) => {
    // A time already passed (the planner often writes "at": 0 for "now") means now, not a replay.
    const now = client.getView().current?.frame.time ?? 0
    const when = change.at !== undefined && change.at > now ? change.at : undefined
    const result = await client.apply(change.label ?? titleFrom(prompt), change.operations, when, prompt)
    update(id, result.ok ? { status: 'applied', note: undefined } : { note: explainRefusal(result.error.message) })
  }

  return (
    <div className="sim-chat">
      <div className="sim-chat-about">
        <p>Chat about <strong>{scenarioTitle}</strong></p>
        {messages.length > 0 && (
          <button type="button" className="sim-link" onClick={() => setMessages([])} disabled={busy} title="Clears this scenario’s conversation; other scenarios keep theirs">Start over</button>
        )}
      </div>
      {messages.length === 0 ? (
        <div className="sim-chat-empty">
          <p className="sim-chat-title">Talk to the simulation</p>
          <p className="sim-muted">{KINDS.find((k) => k.kind === kind)!.intro}</p>
          <ul className="sim-suggestions" aria-label="Example requests">
            {SUGGESTIONS[kind].map((suggestion) => (
              <li key={suggestion}>
                <button type="button" onClick={() => { setText(suggestion); input.current?.focus() }}>
                  <span className="sim-prompt-avatar" aria-hidden="true">You</span>{suggestion}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ol className="sim-messages" ref={list} aria-live="polite">
          {messages.map((message) => (
            <MessageView key={message.id} message={message} venues={venues} busy={busy} onRun={run} onApply={apply} onAskAgain={askAgain}
              onDiscard={(id) => update(id, { status: 'discarded' })} />
          ))}
          {busy && <li className="sim-message sim-message-assistant sim-thinking"><LoaderCircle size={14} aria-hidden="true" /> Thinking…</li>}
        </ol>
      )}

      <form className="sim-chat-form" onSubmit={send}>
        <div className="sim-ask-kind" role="radiogroup" aria-label="What to ask for">
          {KINDS.map((option) => (
            <button key={option.kind} type="button" role="radio" aria-checked={kind === option.kind} onClick={() => setKind(option.kind)}>
              {option.label}
            </button>
          ))}
        </div>
        {kind === 'scenario' && (
          <label className="sim-where">
            <span>Where</span>
            <select value={where} onChange={(event) => setWhere(event.target.value)}>
              <option value={GENERATE}>Make up a building</option>
              {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
            </select>
          </label>
        )}
        <div className="sim-composer">
          <label className="visually-hidden" htmlFor="sim-chat-input">Message</label>
          <textarea id="sim-chat-input" ref={input} rows={1} value={text} placeholder={KINDS.find((k) => k.kind === kind)!.placeholder}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} />
          <button type="submit" className="sim-send" disabled={busy || !text.trim()} aria-label="Send"><SendHorizontal size={15} /></button>
        </div>
      </form>
    </div>
  )
}

function MessageView({ message, venues, busy, onRun, onApply, onAskAgain, onDiscard }: {
  message: Message
  venues: VenueOption[]
  busy: boolean
  onRun: (id: number, plan: ScenarioPlan, prompt: string) => void
  onApply: (id: number, change: CreateInterventionRequest, prompt: string) => void
  onAskAgain: (id: number, plan: ScenarioPlan, prompt: string, where: string | null) => void
  onDiscard: (id: number) => void
}) {
  if (message.from === 'you') return <li className="sim-message sim-message-you">{message.text}</li>
  if ('text' in message) {
    return (
      <li className={`sim-message sim-message-assistant${message.tone === 'error' ? ' is-error' : ''}`}>
        {message.text}
        {message.evidence && message.evidence.length > 0 && (
          <span className="sim-evidence"><span>Based on</span> {message.evidence.join(', ')}</span>
        )}
      </li>
    )
  }

  if ('plan' in message) {
    const { locations, population } = describePlan(message.plan)
    const venue = venues.find((v) => v.id === message.where)
    const steps = describeOperations(message.plan.timeline, venue?.inventory ?? [])
    // A note on a ready plan means it can't be built as it is: offer to ask again.
    const needsFix = message.status === 'ready' && message.note !== undefined
    return (
      <li className="sim-message sim-message-assistant sim-proposal">
        <p className="sim-proposal-title">New scenario{venue ? ` in ${venue.name}` : ''}</p>
        <ul>
          <li>{population} {population === 1 ? 'person' : 'people'} in {locations.map(displayName).join(', ') || 'the plan'}</li>
          {steps.map((step, k) => <li key={k}>{step}</li>)}
          {message.plan.rules.length > 0 && <li>{message.plan.rules.length} {message.plan.rules.length === 1 ? 'rule' : 'rules'}, such as reacting to an alarm</li>}
        </ul>
        {message.note && <p className="sim-proposal-note">{message.note}</p>}
        {needsFix ? (
          <div className="sim-proposal-actions">
            <button type="button" className="sim-action" onClick={() => onAskAgain(message.id, message.plan, message.prompt, message.where)} disabled={busy}>
              <RotateCcw size={12} aria-hidden="true" /> Ask again
            </button>
            <button type="button" className="sim-link" onClick={() => onDiscard(message.id)}>Discard</button>
          </div>
        ) : (
          <ProposalActions status={message.status} doneLabel="Running in the simulator"
            onAccept={() => onRun(message.id, message.plan, message.prompt)} acceptLabel="Run it" onDiscard={() => onDiscard(message.id)} />
        )}
      </li>
    )
  }

  const steps = describeOperations(message.change.operations, message.inventory)
  return (
    <li className="sim-message sim-message-assistant sim-proposal">
      <p className="sim-proposal-title">Change{message.change.at !== undefined ? ` at ${message.change.at} s` : ''}</p>
      <ul>{steps.map((step, k) => <li key={k}>{step}</li>)}</ul>
      {message.note && <p className="sim-proposal-note">{message.note}</p>}
      <ProposalActions status={message.status === 'applied' ? 'running' : message.status} doneLabel={message.note ? 'Applied earlier' : 'Applied: see Changes'}
        onAccept={() => onApply(message.id, message.change, message.prompt)} acceptLabel="Apply" onDiscard={() => onDiscard(message.id)} />
    </li>
  )
}

function ProposalActions({ status, doneLabel, onAccept, acceptLabel, onDiscard }: {
  status: 'ready' | 'running' | 'discarded'; doneLabel: string; onAccept: () => void; acceptLabel: string; onDiscard: () => void
}) {
  if (status === 'running') return <p className="sim-proposal-state"><Check size={13} aria-hidden="true" /> {doneLabel}</p>
  if (status === 'discarded') return <p className="sim-proposal-state is-muted"><X size={13} aria-hidden="true" /> Discarded</p>
  return (
    <div className="sim-proposal-actions">
      <button type="button" className="sim-action" onClick={onAccept}><Play size={12} aria-hidden="true" /> {acceptLabel}</button>
      <button type="button" className="sim-link" onClick={onDiscard}>Discard</button>
    </div>
  )
}
