import type { ApplyAck, CreateInterventionRequest, MetricSample, ScenarioPlan } from '@crowd-control/contract'
import type { SaveState } from '../site/saveState.ts'

/**
 * Saves simulator runs to the signed-in person's account (the server's /api/runs, Tiger Data),
 * so they appear in Past runs: the run, its metric samples, and every change applied
 * from the map or the assistant.
 *
 * A run is created only once something has happened (time has passed or a change was made),
 * so loading or resetting a scenario never leaves empty runs. Everything is queued and sent in
 * order; a failed upload stays queued and is retried on the next flush.
 */

/** Posts JSON to the server; resolves with the HTTP status and the server's error, if any. */
export type Poster = (path: string, body: unknown) => Promise<{ ok: boolean; status: number; error?: string }>

type Change = { prompt: string; request: CreateInterventionRequest; ack: ApplyAck }
/** What a run is: its title and its scenario, saved with it so it can be replayed on any device. */
export type RunAbout = { title?: string; plan?: ScenarioPlan }

type Run = {
  runId: string
  simulationId: string
  startedAt: string
  about: RunAbout
  created: boolean
  lastTime: number
  samples: MetricSample[]
  changes: (Change & { recordedAt: string })[]
}

/** The server takes at most 100 samples, and 64 KiB, per request; batches stay inside both. */
const BATCH = 100
const BATCH_BYTES = 48 * 1024

/** The next samples to send: as many as fit, and always at least one. */
export function nextBatch(samples: readonly MetricSample[]): MetricSample[] {
  let bytes = 0
  let count = 0
  while (count < Math.min(BATCH, samples.length)) {
    bytes += JSON.stringify(samples[count]).length + 1
    if (count > 0 && bytes > BATCH_BYTES) break
    count++
  }
  return samples.slice(0, count)
}

export class RunRecorder {
  private runs: Run[] = []
  private flushing: Promise<void> | null = null
  private state: SaveState = { kind: 'off' }
  private readonly post: Poster
  private readonly onState: (state: SaveState) => void
  private readonly newId: () => string

  constructor(post: Poster, onState: (state: SaveState) => void, newId: () => string = () => crypto.randomUUID()) {
    this.post = post
    this.onState = onState
    this.newId = newId
  }

  /** A new run: a scenario was loaded or reset. Earlier runs finish uploading what they queued. */
  start(simulationId: string, about: RunAbout = {}) {
    this.runs.push({ runId: this.newId(), simulationId, startedAt: new Date().toISOString(), about, created: false, lastTime: -1, samples: [], changes: [] })
    this.setState({ kind: 'waiting' })
  }

  /** A metric sample; repeats and the moment before anything has run are ignored. */
  sample(sample: MetricSample) {
    const run = this.runs.at(-1)
    if (!run || sample.time <= run.lastTime) return
    run.lastTime = sample.time
    if (sample.time > 0) run.samples.push(sample)
  }

  /** A change applied to the current run. */
  change(change: Change) {
    const run = this.runs.at(-1)
    if (!run || change.request.simulationId !== run.simulationId) return
    run.changes.push({ ...change, recordedAt: new Date().toISOString() })
  }

  /** The run on screen now, and whether it has reached the account yet. */
  current(): { runId: string; saved: boolean } | null {
    const run = this.runs.at(-1)
    return run ? { runId: run.runId, saved: run.created } : null
  }

  /** Sends whatever is queued; safe to call often. Resolves when this flush is done. */
  flush(): Promise<void> {
    this.flushing ??= this.send().finally(() => { this.flushing = null })
    return this.flushing
  }

  private async send() {
    try {
      for (const run of [...this.runs]) {
        const pending = run.samples.length > 0 || run.changes.length > 0
        if (!pending) continue
        if (run === this.runs.at(-1)) this.setState({ kind: 'saving' })
        if (!run.created) {
          // The scenario rides along unless it is too big for one request; then the run still saves.
          const plan = run.about.plan && JSON.stringify(run.about.plan).length < BATCH_BYTES ? { plan: run.about.plan } : {}
          await this.expect(this.post('/api/runs', { runId: run.runId, simulationId: run.simulationId, startedAt: run.startedAt, ...(run.about.title && { title: run.about.title.slice(0, 200) }), ...plan }), 'the run')
          run.created = true
        }
        while (run.samples.length > 0) {
          const batch = nextBatch(run.samples)
          await this.expect(this.post(`/api/runs/${run.runId}/metrics`, { simulationId: run.simulationId, samples: batch }), 'its measurements')
          run.samples.splice(0, batch.length)
        }
        while (run.changes.length > 0) {
          const { prompt, request, ack, recordedAt } = run.changes[0]!
          await this.expect(this.post(`/api/runs/${run.runId}/interventions`, { simulationId: run.simulationId, prompt, request, acknowledgement: ack, recordedAt }), 'a change')
          run.changes.shift()
        }
      }
      // Finished runs with nothing left to send are done with.
      const current = this.runs.at(-1)
      this.runs = this.runs.filter((run) => run === current || run.samples.length > 0 || run.changes.length > 0)
      if (current?.created) this.setState({ kind: 'saved' })
    } catch (error) {
      this.setState({ kind: 'failed', message: error instanceof Error ? error.message : 'the server didn’t answer.' })
    }
  }

  private async expect(reply: ReturnType<Poster>, what: string) {
    let result: Awaited<ReturnType<Poster>>
    try {
      result = await reply
    } catch {
      throw new Error('can’t reach the server. It will retry.')
    }
    if (result.ok) return
    if (result.status === 401) throw new Error('your sign-in has expired. Sign in again to keep saving.')
    if (result.status === 503) throw new Error('the run database is unavailable right now. It will retry.')
    throw new Error(`the server didn’t accept ${what}${result.error ? ` (${result.error})` : ''}.`)
  }

  private setState(state: SaveState) {
    if (JSON.stringify(state) === JSON.stringify(this.state)) return
    this.state = state
    this.onState(state)
  }
}
