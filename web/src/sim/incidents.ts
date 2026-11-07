import type { EventRecord } from '@crowd-control/contract'

/**
 * Safety-sign families, used with their real-world meaning:
 * exit = safe condition (green square), warning = fall or hazard (yellow triangle),
 * closed = closure or critical (red square), instruction = scheduled or applied change (blue circle).
 */
export type SignKind = 'exit' | 'warning' | 'closed' | 'instruction'

export type Incident = {
  id: string
  /** First event in this row; equals `time` unless departures were grouped. */
  startTime: number
  time: number
  sign: SignKind
  title: string
  detail: string | null
  /** Entity the event came from (zone, door or person), or null for venue-wide events. */
  source: string | null
  /** Consecutive departures collapse into one row. */
  count: number
}

const titled = (name: string) => name.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

function describe(event: EventRecord): Omit<Incident, 'id' | 'startTime' | 'time' | 'count' | 'source'> {
  const source = event.source ?? null
  switch (event.name) {
    // The alarm is the scenario's critical turning point: red, like a fire alarm call point.
    case 'alarm': return { sign: 'closed', title: 'Alarm', detail: source }
    case 'fall': return { sign: 'warning', title: 'Fall', detail: source }
    case 'recover': return { sign: 'exit', title: 'Helped up', detail: source }
    case 'portal_closed': return { sign: 'closed', title: 'Door closed', detail: source }
    case 'portal_opened': return { sign: 'exit', title: 'Door opened', detail: source }
    case 'departed': return { sign: 'exit', title: 'Left the venue', detail: source }
    case 'removed': return { sign: 'instruction', title: 'Removed', detail: source }
    case 'spawned': {
      const data = event.data
      const count = data && typeof data === 'object' && !Array.isArray(data) && typeof data.count === 'number' ? data.count : null
      return { sign: 'instruction', title: 'Arrivals', detail: [count === null ? null : `${count} people`, source].filter(Boolean).join(' · ') || null }
    }
    default: return { sign: 'instruction', title: titled(event.name), detail: source }
  }
}

/** Chronological incidents; runs of departures collapse into a single counted row. */
export function toIncidents(events: EventRecord[]): Incident[] {
  const incidents: Incident[] = []
  for (const event of events) {
    const last = incidents.at(-1)
    if (event.name === 'departed' && last?.title === 'Left the venue') {
      last.count += 1
      last.time = event.time
      last.detail = `${last.count} people`
      continue
    }
    incidents.push({ id: event.id, startTime: event.time, time: event.time, count: 1, source: event.source ?? null, ...describe(event) })
  }
  return incidents
}

/** Incidents worth a timeline marker: everything except individual departures. */
export function timelineMarkers(incidents: Incident[]): Incident[] {
  return incidents.filter((incident) => incident.title !== 'Left the venue')
}

/** Timeline extent in simulation seconds: at least a minute, then the next half-minute past now. */
export function timelineExtent(now: number): number {
  return Math.max(60, Math.ceil((now + 10) / 30) * 30)
}

/** Tick spacing in seconds that keeps at least `minGapPx` between labels on a track `trackPx` wide. */
export function tickStep(extent: number, trackPx: number, minGapPx = 64): number {
  const steps = [10, 15, 30, 60, 120, 300, 600, 1800]
  return steps.find((step) => (step / extent) * trackPx >= minGapPx) ?? steps.at(-1)!
}

export function formatClock(seconds: number, tenths = true): string {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  return `${String(minutes).padStart(2, '0')}:${tenths ? rest.toFixed(1).padStart(4, '0') : String(Math.floor(rest)).padStart(2, '0')}`
}
