import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  CompileOutputSchema,
  CreateInterventionRequestSchema,
  PlannerReplySchema,
  PlannerRequestSchema,
  SCHEMA_VERSION,
  parseContract,
  parseScenarioPlan,
  serviceResultSchema,
  type Frame,
  type Capabilities,
  type InterventionSummary,
  type InventoryItem,
  type MetricSample,
  type PlannerReply,
  type ScenarioPlan,
  type WorkerCommand,
} from '@crowd-control/contract'
import scenarioPlanFixture from '../../contract/fixtures/scenario-plan.json'
import compiledFixture from '../../contract/fixtures/compile-output.json'
import { createMockEndpoint, type MockEndpoint } from './worker/mockEndpoint.ts'
import { describeOperation, describeOperations, describePlan, displayName } from './planner/describe.ts'
import {
  appendChatHistory,
  readChatHistory,
  type ChatHistoryEntry,
  type CreateFollowupRequest,
} from '@crowd-control/history'

const simulationId = 'worked-demo'
const offlineSamplePrompt = 'Start with 8 people wandering in the hall. At 10 seconds, 2 late arrivals enter from the foyer and join them. At 30 seconds, sound an alarm and send everyone outside.'
const plannerCapabilities = {
  operations: ['add', 'spawn', 'remove', 'set', 'assign_goal', 'clear_goal', 'schedule', 'define_rule', 'remove_rule', 'emit'],
  goals: ['reach', 'avoid', 'wait', 'wander', 'follow', 'queue', 'interact', 'sequence'],
  geometry: ['rectangle', 'circle', 'polygon', 'thick_line'],
  layouts: ['generate', 'upload', 'lookup'],
  entityMetrics: ['contactLoadRatio'],
  editableHistory: true,
} as const
const followupCapabilities: Capabilities = {
  operations: ['spawn', 'set', 'schedule'],
  goals: [],
  geometry: [],
  layouts: ['generate'],
  entityMetrics: [],
  editableHistory: false,
} as const

function App() {
  const [prompt, setPrompt] = useState('')
  const [followupPrompt, setFollowupPrompt] = useState('')
  const [initialHistory] = useState(() => {
    try {
      return readChatHistory(window.localStorage, simulationId)
    } catch {
      return { ok: false as const, error: 'Browser storage is unavailable; applied intervention history cannot be restored.' }
    }
  })
  const [previewPlan, setPreviewPlan] = useState<ScenarioPlan | null>(null)
  const [previewSource, setPreviewSource] = useState<'gemini' | 'sample' | null>(null)
  const [previewFollowup, setPreviewFollowup] = useState<CreateFollowupRequest | null>(null)
  const [previewFollowupPrompt, setPreviewFollowupPrompt] = useState('')
  const [otherReply, setOtherReply] = useState<PlannerReply | null>(null)
  const [followupReply, setFollowupReply] = useState<PlannerReply | null>(null)
  const [error, setError] = useState(initialHistory.ok ? '' : initialHistory.error)
  const [scenarioStatus, setScenarioStatus] = useState('')
  const [reviewStatus, setReviewStatus] = useState('')
  const [followupStatus, setFollowupStatus] = useState('')
  const [databaseStatus, setDatabaseStatus] = useState('')
  const [requesting, setRequesting] = useState(false)
  const [frame, setFrame] = useState<Frame | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [historyEntries, setHistoryEntries] = useState<ChatHistoryEntry[]>(initialHistory.ok ? initialHistory.value.entries : [])
  const [currentInterventions, setCurrentInterventions] = useState<InterventionSummary[]>([])
  const [latestMetrics, setLatestMetrics] = useState<MetricSample | undefined>()
  const pendingRequests = useRef(new Map<string, { request: CreateFollowupRequest; prompt: string }>())
  const activeRunId = useRef<string | null>(null)
  const runStartedAt = useRef<string | null>(null)
  const storedRunId = useRef<string | null>(null)
  const runCreationPending = useRef(false)
  const pendingMetricSamples = useRef<MetricSample[]>([])
  const pendingDatabaseInterventions = useRef<Array<{
    simulationId: string
    prompt: string
    request: CreateFollowupRequest
    acknowledgement: ChatHistoryEntry['acknowledgement']
    recordedAt: string
  }>>([])
  const telemetryFlushPending = useRef(false)
  const telemetryHasSaved = useRef(false)
  const loadCommandId = useRef<string | null>(null)
  const inventoryQueryCommandId = useRef<string | null>(null)
  const initialInventoryQuery = useRef(false)
  const endpoint = useRef<MockEndpoint | null>(null)

  useEffect(() => {
    const worker = createMockEndpoint()
    const pending = pendingRequests.current
    endpoint.current = worker
    let disposed = false
    const ensureRunStored = async () => {
      const runId = activeRunId.current
      const startedAt = runStartedAt.current
      if (!runId || !startedAt) return false
      if (storedRunId.current === runId) return true
      if (runCreationPending.current) return false
      runCreationPending.current = true
      try {
        const response = await fetch('/api/runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId, simulationId, startedAt }),
        })
        if (!response.ok) throw new Error(`Run save failed with HTTP ${response.status}.`)
        storedRunId.current = runId
        if (!disposed) setDatabaseStatus('Run saved to Tiger Data. Metrics and applied changes will upload in the background.')
        return true
      } catch (error) {
        console.warn('[Tiger Data] Could not save run; queued data will retry.', error)
        if (!disposed) setDatabaseStatus('Tiger Data is unavailable. Run data is queued and will retry.')
        return false
      } finally {
        runCreationPending.current = false
      }
    }
    const flushTelemetry = async () => {
      const runId = activeRunId.current
      if (!runId || telemetryFlushPending.current) return
      telemetryFlushPending.current = true
      try {
        if (!await ensureRunStored()) return
        const metrics = pendingMetricSamples.current.slice(0, 20)
        if (metrics.length) {
          const response = await fetch(`/api/runs/${runId}/metrics`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ simulationId, samples: metrics }),
          })
          if (!response.ok) throw new Error(`Metric upload failed with HTTP ${response.status}.`)
          pendingMetricSamples.current.splice(0, metrics.length)
          if (!telemetryHasSaved.current) {
            telemetryHasSaved.current = true
            if (!disposed) setDatabaseStatus('Run metrics and applied changes are saving to Tiger Data.')
          }
        }
        const intervention = pendingDatabaseInterventions.current[0]
        if (intervention) {
          const response = await fetch(`/api/runs/${runId}/interventions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(intervention),
          })
          if (!response.ok) throw new Error(`Intervention upload failed with HTTP ${response.status}.`)
          pendingDatabaseInterventions.current.shift()
          if (!telemetryHasSaved.current) {
            telemetryHasSaved.current = true
            if (!disposed) setDatabaseStatus('Run metrics and applied changes are saving to Tiger Data.')
          }
        }
      } catch (error) {
        console.warn('[Tiger Data] Telemetry upload failed; queued data will retry.', error)
        if (!disposed) setDatabaseStatus('Tiger Data upload failed. Queued run data will retry.')
      } finally {
        telemetryFlushPending.current = false
      }
    }
    const telemetryTimer = window.setInterval(() => { void flushTelemetry() }, 5000)
    const queryInventory = (initial = false) => {
      const commandId = crypto.randomUUID()
      inventoryQueryCommandId.current = commandId
      initialInventoryQuery.current = initial
      worker.send({
        schemaVersion: SCHEMA_VERSION,
        simulationId,
        commandId,
        type: 'query',
        query: { kind: 'inventory' },
      })
    }
    const unsubscribe = worker.subscribe((message) => {
      if (message.type === 'frame') {
        setFrame(message.frame)
      } else if (message.type === 'metrics') {
        setLatestMetrics(message.sample)
        pendingMetricSamples.current.push(message.sample)
        if (pendingMetricSamples.current.length >= 20) void flushTelemetry()
      } else if (message.type === 'query_result' && message.commandId === inventoryQueryCommandId.current) {
        if (message.result.kind === 'inventory') {
          setInventory(message.result.items)
          setLoaded(true)
          if (initialInventoryQuery.current) {
            setReviewStatus(`Sample loaded at tick ${message.stamp.tick}.\n${message.result.items.length} entities are ready for follow-up planning.`)
          }
        }
        inventoryQueryCommandId.current = null
      } else if (message.type === 'ack') {
        if (message.commandId === loadCommandId.current) {
          setReviewStatus('Sample loaded. Reading the mock worker inventory…')
          loadCommandId.current = null
          void flushTelemetry()
          queryInventory(true)
        } else if (message.applied) {
          const applied = message.applied
          const pendingRequest = pendingRequests.current.get(applied.requestId)
          if (pendingRequest) {
            const entry: ChatHistoryEntry = {
              prompt: pendingRequest.prompt,
              request: pendingRequest.request,
              acknowledgement: applied,
              recordedAt: new Date().toISOString(),
            }
            pendingDatabaseInterventions.current.push({
              simulationId,
              prompt: pendingRequest.prompt,
              request: pendingRequest.request,
              acknowledgement: applied,
              recordedAt: entry.recordedAt,
            })
            const label = pendingRequest.request.label ?? describeOperation(pendingRequest.request.operations[0]!, [])
            setCurrentInterventions((current) => [...current, {
              id: applied.interventionId,
              revision: applied.revision,
              label,
              at: applied.at,
              deleted: false,
            }])
            try {
              const saved = appendChatHistory(window.localStorage, simulationId, entry)
              if (saved.ok) {
                setHistoryEntries(saved.value.entries)
              } else {
                setHistoryEntries((current) => [...current, entry])
                setFollowupStatus(saved.error)
              }
            } catch {
              setHistoryEntries((current) => [...current, entry])
              setFollowupStatus('The intervention was applied, but browser storage could not save its history.')
            }
            pendingRequests.current.delete(applied.requestId)
            setFollowupStatus(`Applied successfully at ${applied.at.toFixed(1)} seconds (history revision ${applied.historyRevision}).`)
            setPreviewFollowup(null)
            void flushTelemetry()
            queryInventory()
          }
        }
      } else if (message.type === 'error') {
        if (message.error.requestId && pendingRequests.current.has(message.error.requestId)) {
          setFollowupStatus(message.error.message)
          pendingRequests.current.delete(message.error.requestId)
        } else {
          setReviewStatus(message.error.message)
        }
      }
    })
    return () => {
      disposed = true
      window.clearInterval(telemetryTimer)
      unsubscribe()
      worker.dispose()
      endpoint.current = null
      pending.clear()
    }
  }, [])

  async function preview(event: FormEvent<HTMLFormElement>, promptText: string, isFollowup: boolean) {
    event.preventDefault()
    setError('')
    if (isFollowup) setFollowupStatus('')
    else setScenarioStatus('')
    if (isFollowup) {
      setPreviewFollowup(null)
    } else {
      setPreviewPlan(null)
      setPreviewSource(null)
    }
    if (isFollowup) setFollowupReply(null)
    else setOtherReply(null)

    const request = parseContract(PlannerRequestSchema, {
      schemaVersion: SCHEMA_VERSION,
      simulationId,
      requestId: crypto.randomUUID(),
      prompt: promptText.trim(),
      context: {
        capabilities: isFollowup ? followupCapabilities : plannerCapabilities,
        ...(isFollowup ? { layout: scenarioPlanFixture.layout } : {}),
        inventory: isFollowup ? inventory : [],
        ...(isFollowup && latestMetrics ? { summary: latestMetrics } : {}),
        interventions: isFollowup ? currentInterventions : [],
      },
    })
    if (!request.ok) {
      setError(`Could not prepare the planner request: ${request.error.message}`)
      return
    }

    setRequesting(true)
    if (isFollowup) setFollowupStatus('Asking the server-side Gemini planner…')
    else setScenarioStatus('Asking the server-side Gemini planner…')
    try {
      const response = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.value),
        signal: AbortSignal.timeout(50_000),
      })
      if (isFollowup) setFollowupStatus('')
      else setScenarioStatus('')
      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        setError('The planner server returned an unreadable response.')
        return
      }
      const result = parseContract(serviceResultSchema(PlannerReplySchema), payload)
      if (!result.ok) {
        setError(`The planner server returned an invalid response: ${result.error.message}`)
        return
      }
      if (!result.value.ok) {
        setError(result.value.error.message)
        return
      }

      const reply = result.value.value
      if (import.meta.env.DEV) console.info('[Gemini planner] Validated reply:', reply)
      if (isFollowup && reply.kind === 'followup') {
        if (!('operations' in reply.request) || reply.request.simulationId !== simulationId || reply.request.requestId !== request.value.requestId) {
          setError('The planner returned an unsupported follow-up action. No change was applied.')
          return
        }
        const checked = parseContract(
          CreateInterventionRequestSchema,
          reply.request,
          { capabilities: followupCapabilities },
        )
        if (!checked.ok) {
          setError(`The follow-up failed local validation: ${checked.error.message}`)
          return
        }
        setPreviewFollowup(checked.value)
        setPreviewFollowupPrompt(promptText.trim())
        setFollowupStatus('Review the proposed change. The simulation will remain unchanged until you apply it.')
      } else if (!isFollowup && reply.kind === 'scenario') {
        setPreviewPlan(reply.plan)
        setPreviewSource('gemini')
        setReviewStatus('Plan ready for review. Applying custom scenarios waits for the compiler handoff.')
      } else if (!isFollowup && reply.kind === 'followup') {
        setOtherReply({
          kind: 'clarification',
          message: 'This is a new scenario, but the planner returned a change for an already-running simulation. Retry your scenario request.',
        })
        setScenarioStatus('')
      } else if (isFollowup && reply.kind === 'scenario') {
        setFollowupReply({
          kind: 'clarification',
          message: 'A sample is already running, but the planner returned a new scenario instead of a follow-up change. Try describing a change to an entity in the loaded sample.',
        })
        setFollowupStatus('')
      } else {
        if (isFollowup) setFollowupReply(reply)
        else setOtherReply(reply)
        if (isFollowup) setFollowupStatus('')
        else setScenarioStatus('')
      }
    } catch (requestError) {
      const timedOut = requestError instanceof DOMException && requestError.name === 'TimeoutError'
      setError(timedOut
        ? 'The planner request timed out. Please retry.'
        : 'Could not reach the planner server. Confirm it is running and try again.')
      if (isFollowup) setFollowupStatus('')
      else setScenarioStatus('')
    } finally {
      setRequesting(false)
    }
  }

  function applyFollowup() {
    if (!previewFollowup) return
    const checked = parseContract(
      CreateInterventionRequestSchema,
      previewFollowup,
      { capabilities: followupCapabilities },
    )
    if (!checked.ok) {
      setError(`The follow-up failed local validation: ${checked.error.message}`)
      return
    }

    const commandId = crypto.randomUUID()
    pendingRequests.current.set(checked.value.requestId, {
      request: checked.value,
      prompt: previewFollowupPrompt,
    })
    setError('')
    setFollowupStatus('Applying the reviewed change to the mock worker…')
    endpoint.current?.send({
      schemaVersion: SCHEMA_VERSION,
      simulationId,
      commandId,
      type: 'apply_request',
      request: checked.value,
    } satisfies WorkerCommand)
  }

  function showSamplePreview() {
    setPrompt(offlineSamplePrompt)
    setError('')
    setReviewStatus('')
    setScenarioStatus('')
    setOtherReply(null)
    setFollowupReply(null)
    setPreviewFollowup(null)
    const parsed = parseScenarioPlan(scenarioPlanFixture)
    if (!parsed.ok) {
      setPreviewPlan(null)
      setPreviewSource(null)
      setError(`The sample plan failed validation: ${parsed.error.message}`)
      return
    }
    setPreviewPlan(parsed.value)
    setPreviewSource('sample')
  }

  function applySample() {
    const parsed = parseContract(CompileOutputSchema, compiledFixture)
    if (!parsed.ok) {
      setError(`The sample simulation failed validation: ${parsed.error.message}`)
      return
    }

    setError('')
    setReviewStatus('Loading the precompiled sample into the mock worker…')
    setFollowupStatus('')
    setFollowupReply(null)
    setFollowupPrompt('')
    setPreviewFollowup(null)
    setPreviewFollowupPrompt('')
    setLoaded(false)
    const runId = crypto.randomUUID()
    activeRunId.current = runId
    runStartedAt.current = new Date().toISOString()
    storedRunId.current = null
    runCreationPending.current = false
    pendingMetricSamples.current = []
    pendingDatabaseInterventions.current = []
    telemetryHasSaved.current = false
    setDatabaseStatus('Starting run record in Tiger Data…')
    setFrame(null)
    setLatestMetrics(undefined)
    setInventory([])
    setCurrentInterventions([])
    const commandId = crypto.randomUUID()
    loadCommandId.current = commandId
    endpoint.current?.send({
      schemaVersion: SCHEMA_VERSION,
      simulationId,
      commandId,
      type: 'load',
      compiled: parsed.value,
      history: { historyRevision: 0, records: [], outcomes: [] },
    })
  }

  const summary = previewPlan ? describePlan(previewPlan) : null

  return (
    <main className="app-shell">
      <header className="page-heading">
        <p className="eyebrow">HackTrent 2026 · Planner demo</p>
        <h1>Crowd Control</h1>
        <p>Describe a crowd scenario and review the plan before applying it.</p>
      </header>

      <section className="panel" aria-labelledby="chat-heading">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Step 1 · Scenario</p>
            <h2 id="chat-heading">Describe your scenario</h2>
          </div>
          <span className="mode-badge">Gemini via server</span>
        </div>
        <p className="notice">
          Your prompt goes to the local API. The Gemini key stays on the server, and its
          reply is validated before it appears here. Generated plans can be previewed, but applying custom scenarios waits for the compiler handoff.
        </p>
        <form onSubmit={(event) => preview(event, prompt, false)}>
          <label htmlFor="prompt">What would you like to simulate?</label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="For example: Start with a crowd in the hall, then send everyone outside when the alarm sounds."
            required
            rows={4}
          />
          <div className="button-row">
            <button type="submit" disabled={requesting}>
              {requesting ? 'Planning…' : 'Ask AI planner'}
            </button>
            <button type="button" className="secondary-button" onClick={showSamplePreview} disabled={requesting}>
              Preview offline sample
            </button>
          </div>
        </form>

        {error && <p className="message error" role="alert">{error}</p>}

        {otherReply?.kind === 'clarification' && (
          <section className="preview-card" aria-labelledby="reply-heading">
            <p className="eyebrow">Planner response</p>
            <h3 id="reply-heading">One detail needs clarification</h3>
            <p>{otherReply.message}</p>
          </section>
        )}
        {otherReply?.kind === 'answer' && (
          <section className="preview-card" aria-labelledby="reply-heading">
            <p className="eyebrow">Planner response</p>
            <h3 id="reply-heading">Answer</h3>
            <p>{otherReply.text}</p>
          </section>
        )}
        {otherReply && otherReply.kind !== 'clarification' && otherReply.kind !== 'answer' && (
          <p className="message" role="status">
            The planner returned a {otherReply.kind} reply that is not supported in this view.
          </p>
        )}

        {scenarioStatus && <p className="message" role="status">{scenarioStatus}</p>}
      </section>

      <section className="panel" aria-labelledby="review-heading">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Step 2 · Review</p>
            <h2 id="review-heading">Review the plan</h2>
          </div>
          {previewSource && <span className="mode-badge">{previewSource === 'sample' ? 'Offline fixture' : 'Gemini plan'}</span>}
        </div>
        {previewPlan && summary ? (
          <div className="preview-card" aria-labelledby="preview-heading">
            <h3 id="preview-heading">{previewSource === 'sample' ? (loaded ? 'Sample scenario · loaded' : 'Sample scenario plan') : 'Scenario plan preview'}</h3>
            <p>
              {summary.population} people start in {summary.locations.length ? summary.locations.join(', ') : 'the described venue'}.
            </p>
            <ul>
              <li>{previewPlan.initialOperations.length} initial operations</li>
              <li>{previewPlan.timeline.length} scheduled events</li>
              <li>{previewPlan.rules.length} {previewPlan.rules.length === 1 ? 'event rule' : 'event rules'}</li>
            </ul>
            {previewSource === 'sample' ? (
              <>
                <button type="button" onClick={applySample} disabled={loaded}>
                  {loaded ? 'Sample loaded' : 'Load sample to mock worker'}
                </button>
                <p className="fine-print">
                  Loads the matching precompiled sample only. Mock output is development data, not a safety assessment.
                </p>
              </>
            ) : (
              <>
                <button type="button" disabled title="Waiting for the compiler handoff">
                  Apply after compiler integration
                </button>
                <p className="fine-print">
                  Nothing has changed in the simulation. The compiler that turns this plan into a runnable scene is not connected yet.
                </p>
              </>
            )}
          </div>
        ) : (
          <p className="muted">Your validated plan will appear here after you ask the planner or preview the offline sample.</p>
        )}
        {reviewStatus && <p className="message" role="status" style={{ whiteSpace: 'pre-line' }}>{reviewStatus}</p>}
      </section>

      <section className="panel status-panel" aria-labelledby="status-heading">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Step 3</p>
            <h2 id="status-heading">Mock simulation</h2>
          </div>
          <span className="mode-badge">Development data</span>
        </div>
        {frame ? (
          <p role="status">
            {loaded ? 'Running' : 'Loaded'} at tick {frame.tick}: {frame.agents.length} people in the mock worker.
          </p>
        ) : (
          <p className="muted">Only the offline sample can currently be loaded into the mock worker.</p>
        )}
        {databaseStatus && <p className="message" role="status">{databaseStatus}</p>}
        {loaded && (
          <>
            <section className="followup-panel" aria-labelledby="followup-heading">
              <p className="eyebrow">Step 4 · Follow-up</p>
              <h3 id="followup-heading">Change the running sample</h3>
              <p className="muted">Describe a supported change to this mock simulation, such as adding people to a zone or changing a portal. Review the proposal before applying it.</p>
              <form onSubmit={(event) => preview(event, followupPrompt, true)}>
                <label htmlFor="followup-prompt">What should change?</label>
                <textarea
                  id="followup-prompt"
                  value={followupPrompt}
                  onChange={(event) => setFollowupPrompt(event.target.value)}
                  placeholder="For example: Close the hall door now and reopen it in 30 seconds."
                  required
                  rows={3}
                />
                <button type="submit" disabled={requesting}>
                  {requesting ? 'Planning…' : 'Ask for a follow-up'}
                </button>
              </form>

              {followupReply?.kind === 'clarification' && (
                <section className="preview-card" aria-labelledby="followup-reply-heading">
                  <p className="eyebrow">Planner response</p>
                  <h4 id="followup-reply-heading">One detail needs clarification</h4>
                  <p>{followupReply.message}</p>
                </section>
              )}
              {followupReply?.kind === 'answer' && (
                <section className="preview-card" aria-labelledby="followup-reply-heading">
                  <p className="eyebrow">Planner response</p>
                  <h4 id="followup-reply-heading">Answer</h4>
                  <p>{followupReply.text}</p>
                </section>
              )}
              {followupReply && followupReply.kind !== 'clarification' && followupReply.kind !== 'answer' && (
                <p className="message" role="status">
                  The planner returned a {followupReply.kind} reply that is not supported in this view.
                </p>
              )}
              {followupStatus && <p className="message" role="status">{followupStatus}</p>}

              {previewFollowup && (
                <section className="preview-card" aria-labelledby="followup-preview-heading">
                  <p className="eyebrow">Review · Mock worker</p>
                  <h4 id="followup-preview-heading">Intervention preview</h4>
                  <p>{displayName(previewFollowup.label ?? 'Proposed change')}{previewFollowup.at === undefined ? ' · apply now' : ` · at ${previewFollowup.at} seconds`}</p>
                  <ul>
                    {describeOperations(previewFollowup.operations, inventory).map((description, index) => (
                      <li key={`${index}-${description}`}>{description}</li>
                    ))}
                  </ul>
                  <button type="button" onClick={applyFollowup}>Apply to mock worker</button>
                  <p className="fine-print">
                    No change has been applied yet. The mock supports adding people to zones and set/schedule interventions; replay, edit, and delete are not available.
                  </p>
                </section>
              )}
            </section>

            <section aria-labelledby="history-heading">
              <h3 id="history-heading">Applied interventions · mock history</h3>
              <p className="fine-print">
                This is a saved interaction log. The mock simulation itself resets on refresh; saved changes are not replayed.
              </p>
              {historyEntries.length ? (
                <ul className="history-list">
                  {historyEntries.map((entry) => (
                    <li className="history-entry" key={entry.request.requestId}>
                      <strong>{displayName(entry.request.label ?? describeOperation(entry.request.operations[0]!, inventory))}</strong>
                      <p className="eyebrow">You wrote</p>
                      <blockquote className="history-prompt">{entry.prompt}</blockquote>
                      <ul>
                        {describeOperations(entry.request.operations, inventory).map((description, index) => (
                          <li key={`${index}-${description}`}>{description}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No follow-up interventions have been applied yet.</p>
              )}
            </section>
          </>
        )}
      </section>

      <footer>Schema version {SCHEMA_VERSION} · Generated plans are previews until compiler integration is complete.</footer>
    </main>
  )
}

export default App
