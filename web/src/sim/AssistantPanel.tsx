import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, LoaderCircle, Play, SendHorizontal, X } from 'lucide-react'
import type { CreateInterventionRequest, InterventionSummary, InventoryItem, LayoutSource, ScenarioPlan } from '@crowd-control/contract'
import { describeOperations, describePlan, displayName } from '../planner/describe.ts'
import type { SimulationClient, SimulationView } from '../worker/simulationClient.ts'
import { askPlanner, buildRequest, titleFrom, type AskKind } from './assistant.ts'

type Message =
  | { id: number; from: 'you'; text: string; kind: AskKind }
  | { id: number; from: 'assistant'; text: string; tone: 'info' | 'error' }
  | { id: number; from: 'assistant'; plan: ScenarioPlan; prompt: string; status: 'ready' | 'running' | 'discarded'; note?: string }
  | { id: number; from: 'assistant'; change: CreateInterventionRequest; prompt: string; status: 'ready' | 'applied' | 'discarded'; note?: string }

/** A message before it gets an ID (Omit applied to each kind of message separately). */
type NewMessage = Message extends infer M ? (M extends Message ? Omit<M, 'id'> : never) : never

const SUGGESTIONS: Record<AskKind, string[]> = {
  change: ['Close the exit for 30 seconds', 'Add 20 more people in the busiest room', 'At 20 seconds, close the main door'],
  scenario: ['200 people leave a concert through two exits after an alarm at 30 seconds', 'A hall twice the size of its foyer, 40 people, fire drill at 20 seconds'],
}

type Props = {
  client: SimulationClient
  view: SimulationView
  /** The current venue's layout and name, when it is a real venue (lookup or upload). */
  venue: { layout: LayoutSource; name: string } | null
  /** Compiles and loads a scenario the assistant wrote; returns an error message, or null when it is running. */
  onRunPlan: (plan: ScenarioPlan, title: string) => string | null
}

/**
 * The Assistant panel: describe a change to the running simulation, or a whole new scenario,
 * in plain language. The planner's answer is shown as a preview; nothing changes until the
 * person presses Apply or Run. Applied changes go through the same request path as the map's
 * click tools, so they appear in the Changes list.
 */
export function AssistantPanel({ client, view, venue, onRunPlan }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [kind, setKind] = useState<AskKind>('change')
  const [keepVenue, setKeepVenue] = useState(true)
  const [busy, setBusy] = useState(false)
  const nextId = useRef(1)
  const list = useRef<HTMLOListElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [messages, busy])

  const add = (message: NewMessage) => setMessages((all) => [...all, { ...message, id: nextId.current++ } as Message])
  const update = (id: number, patch: Partial<Message>) => setMessages((all) => all.map((m) => (m.id === id ? ({ ...m, ...patch } as Message) : m)))

  /** What the planner can see: the entities loaded, the latest numbers, and changes made so far. */
  const inventory = async (): Promise<InventoryItem[]> => {
    if (!view.simulationId) return []
    const reply = await client.command({ type: 'query', query: { kind: 'inventory' } })
    return reply.type === 'query_result' && reply.result.kind === 'inventory' ? reply.result.items : []
  }

  const send = async (event?: FormEvent) => {
    event?.preventDefault()
    const prompt = text.trim()
    if (!prompt || busy) return
    setText('')
    add({ from: 'you', text: prompt, kind })
    setBusy(true)
    try {
      const interventions: InterventionSummary[] = view.changes.map((change) => ({ id: change.interventionId, revision: 1, label: change.label, at: change.at, deleted: false }))
      const useVenue = venue && (kind === 'change' || keepVenue)
      const request = buildRequest({
        simulationId: view.simulationId ?? 'assistant',
        prompt, kind,
        ...(useVenue && { layout: venue.layout }),
        inventory: kind === 'change' || useVenue ? await inventory() : [],
        ...(kind === 'change' && view.metrics && { summary: view.metrics }),
        interventions: kind === 'change' ? interventions : [],
      })
      if (!request.ok) {
        add({ from: 'assistant', text: `Couldn’t prepare that request: ${request.error.message}`, tone: 'error' })
        return
      }
      const outcome = await askPlanner(request.value, kind)
      if (outcome.type === 'scenario') add({ from: 'assistant', plan: outcome.plan, prompt, status: 'ready' })
      else if (outcome.type === 'change') add({ from: 'assistant', change: outcome.request, prompt, status: 'ready' })
      else add({ from: 'assistant', text: outcome.text, tone: outcome.tone })
    } finally {
      setBusy(false)
      input.current?.focus()
    }
  }

  const run = (id: number, plan: ScenarioPlan, prompt: string) => {
    const error = onRunPlan(plan, titleFrom(prompt))
    update(id, error ? { note: error } : { status: 'running', note: undefined })
  }

  const apply = async (id: number, change: CreateInterventionRequest, prompt: string) => {
    const result = await client.apply(change.label ?? titleFrom(prompt), change.operations, change.at)
    update(id, result.ok ? { status: 'applied', note: undefined } : { note: `The simulator refused it: ${result.error.message}` })
  }

  return (
    <div className="sim-chat">
      {messages.length === 0 ? (
        <div className="sim-chat-empty">
          <p className="sim-chat-title">Talk to the simulation</p>
          <p className="sim-muted">
            {kind === 'change'
              ? 'Describe a change to this run. You’ll see what it would do before anything changes.'
              : 'Describe a whole scenario: the place, the crowd, and what happens when. You’ll see the plan before it runs.'}
          </p>
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
          {messages.map((message) => <MessageView key={message.id} message={message} onRun={run} onApply={apply}
            onDiscard={(id) => update(id, { status: 'discarded' })} />)}
          {busy && <li className="sim-message sim-message-assistant sim-thinking"><LoaderCircle size={14} aria-hidden="true" /> Thinking…</li>}
        </ol>
      )}

      <form className="sim-chat-form" onSubmit={send}>
        <div className="sim-ask-kind" role="radiogroup" aria-label="What to ask for">
          {(['change', 'scenario'] as const).map((option) => (
            <button key={option} type="button" role="radio" aria-checked={kind === option} onClick={() => setKind(option)}>
              {option === 'change' ? 'Change this run' : 'New scenario'}
            </button>
          ))}
        </div>
        {kind === 'scenario' && venue && (
          <label className="sim-keep-venue">
            <input type="checkbox" checked={keepVenue} onChange={(event) => setKeepVenue(event.target.checked)} />
            Keep {venue.name}
          </label>
        )}
        <div className="sim-composer">
          <label className="visually-hidden" htmlFor="sim-chat-input">Message</label>
          <textarea id="sim-chat-input" ref={input} rows={1} value={text} placeholder={kind === 'change' ? 'Describe a change…' : 'Describe a scenario…'}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} />
          <button type="submit" className="sim-send" disabled={busy || !text.trim()} aria-label="Send"><SendHorizontal size={15} /></button>
        </div>
      </form>
    </div>
  )
}

function MessageView({ message, onRun, onApply, onDiscard }: {
  message: Message
  onRun: (id: number, plan: ScenarioPlan, prompt: string) => void
  onApply: (id: number, change: CreateInterventionRequest, prompt: string) => void
  onDiscard: (id: number) => void
}) {
  if (message.from === 'you') return <li className="sim-message sim-message-you">{message.text}</li>
  if ('text' in message) return <li className={`sim-message sim-message-assistant${message.tone === 'error' ? ' is-error' : ''}`}>{message.text}</li>

  if ('plan' in message) {
    const { locations, population } = describePlan(message.plan)
    const steps = describeOperations(message.plan.timeline, [])
    return (
      <li className="sim-message sim-message-assistant sim-proposal">
        <p className="sim-proposal-title">New scenario</p>
        <ul>
          <li>{population} {population === 1 ? 'person' : 'people'} in {locations.map(displayName).join(', ') || 'the plan'}</li>
          {steps.map((step, k) => <li key={k}>{step}</li>)}
          {message.plan.rules.length > 0 && <li>{message.plan.rules.length} {message.plan.rules.length === 1 ? 'rule' : 'rules'}, such as reacting to an alarm</li>}
        </ul>
        {message.note && <p className="sim-proposal-note">{message.note}</p>}
        <ProposalActions status={message.status} done="Running" doneLabel="Running in the simulator"
          onAccept={() => onRun(message.id, message.plan, message.prompt)} acceptLabel="Run it" onDiscard={() => onDiscard(message.id)} />
      </li>
    )
  }

  const steps = describeOperations(message.change.operations, [])
  return (
    <li className="sim-message sim-message-assistant sim-proposal">
      <p className="sim-proposal-title">Change{message.change.at !== undefined ? ` at ${message.change.at} s` : ''}</p>
      <ul>{steps.map((step, k) => <li key={k}>{step}</li>)}</ul>
      {message.note && <p className="sim-proposal-note">{message.note}</p>}
      <ProposalActions status={message.status === 'applied' ? 'running' : message.status} done="Applied" doneLabel="Applied: see Changes"
        onAccept={() => onApply(message.id, message.change, message.prompt)} acceptLabel="Apply" onDiscard={() => onDiscard(message.id)} />
    </li>
  )
}

function ProposalActions({ status, doneLabel, onAccept, acceptLabel, onDiscard }: {
  status: 'ready' | 'running' | 'discarded'; done: string; doneLabel: string; onAccept: () => void; acceptLabel: string; onDiscard: () => void
}) {
  if (status === 'running') return <p className="sim-proposal-state"><Check size={13} aria-hidden="true" /> {doneLabel}</p>
  if (status === 'discarded') return <p className="sim-proposal-state is-muted"><X size={13} aria-hidden="true" /> Discarded</p>
  return (
    <div className="sim-proposal-actions">
      <button type="button" className="sim-action" onClick={onAccept}>
        <Play size={12} aria-hidden="true" /> {acceptLabel}
      </button>
      <button type="button" className="sim-link" onClick={onDiscard}>Discard</button>
    </div>
  )
}
