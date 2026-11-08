import { RunReportSchema, type RunReport } from '@crowd-control/contract'

/** Reading a run's saved safety report and asking the server to write one. */

/** The measured facts a report was written from (as the server sends them). */
export type ReportFacts = {
  scenario: string
  startedAt: string
  units: 'people/m²' | 'relative'
  measuredSeconds: number
  measurements: number
  end: { present: number; departed: number; immobile: number; clearance: { t50: number | null; t90: number | null; t100: number | null } } | null
  busiest: { zoneId: string; peakDensity: number; at: number }[]
}

export type SavedReport = { report: RunReport; facts: ReportFacts }

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

async function readReport(response: Response): Promise<SavedReport | null> {
  const payload = await response.json().catch(() => null) as { report?: unknown; facts?: ReportFacts; error?: string } | null
  if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`)
  if (payload?.report === null || payload?.report === undefined) return null
  const report = RunReportSchema.safeParse(payload.report)
  if (!report.success || !payload.facts) throw new Error('the report came back in a form that couldn’t be read')
  return { report: report.data, facts: payload.facts }
}

/** The report written earlier for a run, or null if none has been written. */
export async function loadReport(fetcher: Fetcher, runId: string): Promise<SavedReport | null> {
  return readReport(await fetcher(`/api/runs/${encodeURIComponent(runId)}/report`))
}

/** Writes (or rewrites) a run's report; the server keeps it for next time. */
export async function writeReport(fetcher: Fetcher, runId: string, metres: boolean): Promise<SavedReport> {
  const saved = await readReport(await fetcher(`/api/runs/${encodeURIComponent(runId)}/report`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ units: metres ? 'm' : 'model' }),
  }))
  if (!saved) throw new Error('no report came back')
  return saved
}
