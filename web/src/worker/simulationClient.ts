import {
  SCHEMA_VERSION,
  type ApplyAck,
  type CompileOutput,
  type ContractError,
  type DensityGrid,
  type EventRecord,
  type Frame,
  type HistoryState,
  type MetricSample,
  type Operation,
  type RenderScene,
  type Stamp,
  type WorkerCommand,
  type WorkerEndpoint,
  type WorkerMessage,
  type Result,
} from '@crowd-control/contract'

export type TimedFrame = { frame: Frame; receivedAt: number }

/** A change applied to this run (a fall, a door, later chat edits), newest last. */
export type AppliedChange = { interventionId: string; label: string; at: number }

/** Immutable snapshot of what the screen should show. A new object is created on every change. */
export type SimulationView = {
  endpointKind: WorkerEndpoint['kind']
  simulationId: string | null
  streamId: string | null
  scene: RenderScene | null
  sceneVersion: number
  historyRevision: number
  current: TimedFrame | null
  previous: TimedFrame | null
  metrics: MetricSample | null
  density: DensityGrid | null
  events: EventRecord[]
  playing: boolean
  speed: number
  lastError: ContractError | null
  /** Changes applied in this stream; cleared when a new stream starts (load or reset). */
  changes: AppliedChange[]
}

export type CommandBody = WorkerCommand extends infer C
  ? C extends WorkerCommand ? Omit<C, 'schemaVersion' | 'simulationId' | 'commandId'> : never
  : never

const MAX_EVENTS = 500
const MAX_PENDING_STREAMS = 4
const EMPTY_HISTORY: HistoryState = { historyRevision: 0, records: [], outcomes: [] }

/**
 * B's worker client: owns the transport-level rules from Contracts §12 so the renderer
 * and React only ever see a consistent picture.
 * - commandId correlates each command with its ack/error/query result.
 * - A new streamId (load/reset/restore/replay commit) retires the previous stream; its
 *   late frames, metrics and events are discarded.
 * - Frames are held until the scene metadata they reference has arrived.
 * - Frames from a superseded history revision are ignored.
 */
export class SimulationClient {
  private readonly endpoint: WorkerEndpoint
  private readonly now: () => number
  private readonly listeners = new Set<() => void>()
  private readonly retired = new Set<string>()
  private readonly pendingFrames = new Map<string, Frame>()
  private readonly pending = new Map<string, { type: CommandBody['type']; multiplier?: number; resolve: (message: WorkerMessage) => void }>()
  private readonly detach: () => void
  private metricsTick = -1
  private nextCommand = 1
  private nextRequest = 1
  private view: SimulationView

  constructor(endpoint: WorkerEndpoint, now: () => number = () => performance.now()) {
    this.endpoint = endpoint
    this.now = now
    this.view = {
      endpointKind: endpoint.kind, simulationId: null, streamId: null, scene: null, sceneVersion: 0, historyRevision: 0,
      current: null, previous: null, metrics: null, density: null, events: [], playing: false, speed: 1, lastError: null, changes: [],
    }
    this.detach = endpoint.subscribe((message) => this.receive(message))
  }

  /** For React's useSyncExternalStore. */
  readonly getView = (): SimulationView => this.view
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  load(compiled: CompileOutput, history: HistoryState = EMPTY_HISTORY) {
    this.update({ simulationId: compiled.scene.simulationId, lastError: null })
    return this.command({ type: 'load', compiled, history })
  }
  /** Shows an error that happened before the worker was involved, e.g. a plan that failed to compile. */
  reportError(error: ContractError) { this.update({ lastError: error }) }
  /**
   * Applies a change now as a follow-up request (the same path chat edits use). On success it
   * joins `changes`; on failure the error is returned and shown as `lastError`.
   */
  async apply(label: string, operations: Operation[]): Promise<Result<ApplyAck>> {
    const simulationId = this.view.simulationId
    if (!simulationId) return { ok: false, error: { code: 'NOT_FOUND', message: 'No simulation is loaded' } }
    const requestId = `ui-${this.nextRequest++}-${Math.random().toString(36).slice(2, 8)}`
    const reply = await this.command({ type: 'apply_request', request: { schemaVersion: SCHEMA_VERSION, simulationId, requestId, label, operations } })
    if (reply.type === 'error') return { ok: false, error: reply.error }
    if (reply.type !== 'ack' || !reply.applied) return { ok: false, error: { code: 'INVALID_SCHEMA', message: 'The worker did not confirm the change' } }
    const { interventionId, at } = reply.applied
    this.update({ lastError: null, changes: [...this.view.changes, { interventionId, label, at }] })
    return { ok: true, value: reply.applied }
  }
  play() { return this.command({ type: 'resume' }) }
  pause() { return this.command({ type: 'pause' }) }
  step(ticks = 1) { return this.command({ type: 'step', ticks }) }
  setSpeed(multiplier: number) { return this.command({ type: 'speed', multiplier }) }
  reset() { return this.command({ type: 'reset' }) }

  /** Sends a command and resolves with its correlated ack, error, query result or snapshot. */
  command(body: CommandBody): Promise<WorkerMessage> {
    const simulationId = this.view.simulationId
    if (!simulationId) return Promise.reject(new Error('Load a simulation before sending commands'))
    const commandId = `ui-${this.nextCommand++}`
    return new Promise((resolve) => {
      this.pending.set(commandId, { type: body.type, ...('multiplier' in body ? { multiplier: body.multiplier } : {}), resolve })
      this.endpoint.send({ schemaVersion: SCHEMA_VERSION, simulationId, commandId, ...body } as WorkerCommand)
    })
  }

  dispose() {
    this.detach()
    this.listeners.clear()
    this.pending.clear()
  }

  private receive(message: WorkerMessage) {
    if (message.simulationId !== this.view.simulationId) return
    switch (message.type) {
      case 'ack':
      case 'query_result':
      case 'snapshot':
        this.settle(message.commandId, message)
        return
      case 'error':
        this.update({ lastError: message.error })
        if (message.commandId) this.settle(message.commandId, message)
        return
      case 'scene':
        this.receiveScene(message.stamp.streamId, message.stamp.sceneVersion, message.stamp.historyRevision, message.scene)
        return
      case 'frame':
        this.receiveFrame(message.frame)
        return
      case 'metrics':
        if (this.acceptTelemetry(message.stamp) && message.stamp.tick >= this.metricsTick && message.stamp.tick >= (this.view.current?.frame.tick ?? 0)) {
          this.metricsTick = message.stamp.tick
          this.update({ metrics: message.sample, density: message.density ?? this.view.density })
        }
        return
      case 'events':
        if (this.acceptTelemetry(message.stamp)) this.update({ events: [...this.view.events, ...message.events].slice(-MAX_EVENTS) })
        return
    }
  }

  private acceptTelemetry(stamp: Stamp): boolean {
    return stamp.streamId === this.view.streamId && stamp.sceneVersion === this.view.sceneVersion
      && stamp.historyRevision === this.view.historyRevision
      && (!this.view.current || stamp.topologyVersion === this.view.current.frame.topologyVersion)
  }

  private settle(commandId: string, message: WorkerMessage) {
    const entry = this.pending.get(commandId)
    if (!entry) return
    this.pending.delete(commandId)
    if (message.type === 'ack') {
      if (entry.type === 'resume') this.update({ playing: true })
      if (entry.type === 'pause' || entry.type === 'load' || entry.type === 'reset') this.update({ playing: false })
      if (entry.type === 'speed' && entry.multiplier !== undefined) this.update({ speed: entry.multiplier })
    }
    entry.resolve(message)
  }

  private receiveScene(streamId: string, sceneVersion: number, historyRevision: number, scene: RenderScene) {
    if (this.retired.has(streamId) || (streamId === this.view.streamId && (sceneVersion < this.view.sceneVersion || historyRevision < this.view.historyRevision))) return
    if (streamId !== this.view.streamId || sceneVersion !== this.view.sceneVersion || historyRevision !== this.view.historyRevision) {
      this.metricsTick = -1
      this.update({ metrics: null, density: null })
    }
    if (streamId !== this.view.streamId) {
      if (this.view.streamId) this.retired.add(this.view.streamId)
      // A new stream (load or reset) has its own history: a reset goes back to the initial
      // revision, so the old stream's higher revision must not make its frames look stale.
      this.update({ streamId, current: null, previous: null, metrics: null, density: null, events: [], changes: [], historyRevision })
    } else if (sceneVersion < this.view.sceneVersion) {
      return
    }
    this.update({ scene, sceneVersion, historyRevision: Math.max(this.view.historyRevision, historyRevision) })
    const waiting = this.pendingFrames.get(streamId)
    if (waiting && waiting.sceneVersion <= sceneVersion) {
      this.pendingFrames.delete(streamId)
      this.receiveFrame(waiting)
    }
    for (const id of this.pendingFrames.keys()) if (this.retired.has(id)) this.pendingFrames.delete(id)
  }

  private receiveFrame(frame: Frame) {
    if (this.retired.has(frame.streamId)) return
    if (frame.streamId !== this.view.streamId || frame.sceneVersion > this.view.sceneVersion) {
      this.pendingFrames.delete(frame.streamId)
      this.pendingFrames.set(frame.streamId, frame)
      while (this.pendingFrames.size > MAX_PENDING_STREAMS) this.pendingFrames.delete(this.pendingFrames.keys().next().value!)
      return
    }
    if (frame.historyRevision < this.view.historyRevision) return
    const current = this.view.current
    if (current && frame.tick < current.frame.tick) return
    this.update({
      previous: current,
      current: { frame, receivedAt: this.now() },
      historyRevision: frame.historyRevision,
    })
  }

  private update(patch: Partial<SimulationView>) {
    this.view = { ...this.view, ...patch }
    for (const listener of [...this.listeners]) listener()
  }
}
