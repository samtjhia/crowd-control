import { z } from 'zod'
import { RunReportSchema, type RunReport, type ServiceError, type ServiceResult } from '@crowd-control/contract'
import type { RunFacts } from './database.ts'

/**
 * The AI safety report: one page a facilities lead could hand to a committee, written by Gemini
 * from a saved run's measured facts only (busiest spots, clearance times, each change and its
 * before/after crowding). Gemini is told not to invent causes or numbers, and the report says it
 * is a planning estimate, not certified safety advice.
 */

export type ReportWriterOptions = { apiKey?: string; model?: string; fetcher?: typeof fetch }

const unavailable = (message: string, retryable: boolean): ServiceResult<never> => ({
  ok: false,
  error: { code: 'PLANNER_UNAVAILABLE', message, retryable } satisfies ServiceError,
})

function textOf(payload: unknown): string | undefined {
  const parts = (payload as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] })?.candidates?.[0]?.content?.parts
  const text = Array.isArray(parts) ? parts.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('') : ''
  return text || undefined
}

export function createReportWriter(options: ReportWriterOptions) {
  const fetcher = options.fetcher ?? fetch
  return async (facts: RunFacts): Promise<ServiceResult<RunReport>> => {
    if (!options.apiKey || !options.model) return unavailable('The report writer is not configured. Set GEMINI_API_KEY and GEMINI_MODEL in the server .env file.', false)
    const prompt = (feedback?: string) => [
      'You write a one-page crowd safety report for Crowd Control, a crowd-simulation planning tool. The reader is a non-expert (a school principal, an event organiser) who will hand it to a safety committee.',
      'Use ONLY the facts below. Do not invent numbers, places, causes or events. When the facts are thin (few measurements, no one left), say what is missing rather than guessing.',
      'The title is a short headline of the main finding (for example "Foyer gets crowded once the west exit closes"), not "Crowd safety report".',
      'Write plainly. Name places by their area names as given. Give times as m:ss from the start of the run. Density is people per square metre when units are "people/m²"; otherwise it is relative and should be described as "relative crowding" without units.',
      'Findings: the most important observations first (where and when it got most crowded, how long clearing took, what each change did). Rate each finding high (needs action), medium (worth watching) or low (fine).',
      'Recommendations: concrete, practical actions tied to the findings (open another exit earlier, stagger arrivals, add a second check-in desk). No more than six.',
      'Caveats: always include that this is a simulated planning estimate, not certified safety advice, and any limits of this run (short duration, few measurements).',
      'Return exactly one JSON object matching this JSON Schema:',
      JSON.stringify(z.toJSONSchema(RunReportSchema)),
      `Facts:\n${JSON.stringify(facts)}`,
      ...(feedback ? [`Your previous reply was not valid: ${feedback}. Return a corrected JSON object.`] : []),
    ].join('\n\n')

    let feedback: string | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response
      try {
        response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': options.apiKey },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt(feedback) }] }], generationConfig: { responseMimeType: 'application/json' } }),
          signal: AbortSignal.timeout(60_000),
        })
      } catch {
        return unavailable('Could not reach Gemini to write the report. Try again.', true)
      }
      if (!response.ok) {
        if (response.status === 429) return unavailable('Gemini rate limit reached (HTTP 429). Try again after the limit resets.', true)
        return unavailable(`Gemini could not write the report (HTTP ${response.status}).`, response.status >= 500)
      }
      const text = textOf(await response.json().catch(() => null))
      let output: unknown
      try {
        output = text ? JSON.parse(text) : undefined
      } catch {
        feedback = 'the response was not JSON'
        continue
      }
      const report = RunReportSchema.safeParse(output)
      if (report.success) return { ok: true, value: report.data }
      feedback = report.error.issues.slice(0, 3).map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    }
    return unavailable('Gemini could not write a valid report. Try again.', true)
  }
}
