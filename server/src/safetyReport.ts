import { SafetyReportSchema, type SafetyReport } from '@crowd-control/contract'

export type SafetyReportEvidence = {
  runId: string
  simulationId: string
  startedAt: string
  sampleCount: number
  peakDensityByZone: Array<{ zoneId: string; peakDensity: number; at: number }>
  interventions: Array<{
    requestId: string
    prompt: string
    at: number
    comparisons: Array<{
      zoneId: string
      beforeDensity: number | null
      afterDensity: number | null
      beforeSamples: number
      afterSamples: number
    }>
  }>
}

export type SafetyReporterOptions = {
  apiKey?: string
  model?: string
  fetcher?: typeof fetch
}

export type SafetyReportResult =
  | { ok: true; report: SafetyReport }
  | { ok: false; status: 503; error: string }

const geminiResponseSchema = {
  type: 'OBJECT',
  properties: {
    executiveSummary: { type: 'STRING' },
    findings: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          observation: { type: 'STRING' },
          at: { type: 'NUMBER', nullable: true },
          zoneId: { type: 'STRING', nullable: true },
          recommendation: { type: 'STRING' },
        },
        required: ['title', 'observation', 'at', 'zoneId', 'recommendation'],
      },
    },
    limitations: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['executiveSummary', 'findings', 'limitations'],
}

function extractText(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null || !('candidates' in payload) || !Array.isArray(payload.candidates)) return
  const candidate = payload.candidates[0]
  if (typeof candidate !== 'object' || candidate === null || !('content' in candidate)) return
  const content = candidate.content
  if (typeof content !== 'object' || content === null || !('parts' in content) || !Array.isArray(content.parts)) return
  const text = content.parts
    .map((part: unknown) => typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string' ? part.text : '')
    .join('')
  return text || undefined
}

export function createGeminiSafetyReporter(options: SafetyReporterOptions) {
  const fetcher = options.fetcher ?? fetch

  return async (evidence: SafetyReportEvidence): Promise<SafetyReportResult> => {
    if (!options.apiKey || !options.model) {
      return { ok: false, status: 503, error: 'AI reporting is not configured. Set GEMINI_API_KEY and GEMINI_MODEL on the server.' }
    }

    const reportContentSchema = SafetyReportSchema.omit({
      runId: true,
      generatedAt: true,
      disclaimer: true,
    })
    const observedTimes = new Set([
      ...evidence.peakDensityByZone.map((zone) => zone.at),
      ...evidence.interventions.map((intervention) => intervention.at),
    ])
    const observedZones = new Set([
      ...evidence.peakDensityByZone.map((zone) => zone.zoneId),
      ...evidence.interventions.flatMap((intervention) => intervention.comparisons.map((comparison) => comparison.zoneId)),
    ])
    let validationFeedback: string | undefined

    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response
      try {
        response = await fetcher(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model)}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': options.apiKey },
            body: JSON.stringify({
              contents: [{
                role: 'user',
                parts: [{
                  text: [
                    'Create a concise, evidence-grounded crowd-simulation planning report from the supplied saved-run data.',
                    'Return one JSON object matching the response schema exactly. In particular, limitations MUST be an array of strings, even when there is only one limitation.',
                    'Each finding must have title, observation, at (simulation seconds or null), zoneId (known zone ID or null), and recommendation.',
                    'Use only facts present in the evidence. Mention specific zones, values and simulation times only when supplied.',
                    'Do not invent hazard thresholds, causes, events, injuries, venue facts, or physical units. Do not describe a density value as safe or unsafe.',
                    'If samples are absent or sparse, say the evidence is limited and recommend collecting more data. Recommendations must be cautious and tied to observations.',
                    'Limitations must note that event records and calibrated venue dimensions/validated safety thresholds are not available in this report evidence.',
                    `Saved run evidence:\n${JSON.stringify(evidence)}`,
                    ...(validationFeedback ? [`Your previous response was invalid: ${validationFeedback}\nReturn a corrected complete JSON object.`] : []),
                  ].join('\n\n'),
                }],
              }],
              generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: geminiResponseSchema,
              },
            }),
            signal: AbortSignal.timeout(45_000),
          },
        )
      } catch {
        return { ok: false, status: 503, error: 'Could not reach Gemini to generate the report. Try again.' }
      }

      if (!response.ok) {
        if (response.status === 429) {
          return { ok: false, status: 503, error: 'Gemini rate limit or quota reached. Try again after the limit resets.' }
        }
        console.warn(`Gemini safety report returned HTTP ${response.status} for model ${options.model}.`)
        return { ok: false, status: 503, error: `Gemini could not generate the report (HTTP ${response.status}).` }
      }

      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        return { ok: false, status: 503, error: 'Gemini returned an unreadable safety report.' }
      }
      const text = extractText(payload)
      if (!text) {
        validationFeedback = 'the response contained no report text'
        if (attempt === 0) continue
        return { ok: false, status: 503, error: 'Gemini returned no safety report after one correction attempt.' }
      }

      let output: unknown
      try {
        output = JSON.parse(text)
      } catch {
        validationFeedback = 'the report was not valid JSON'
        if (attempt === 0) continue
        return { ok: false, status: 503, error: 'Gemini returned invalid report JSON after one correction attempt.' }
      }

      const parsed = reportContentSchema.safeParse(output)
      if (!parsed.success) {
        validationFeedback = parsed.error.message
        if (attempt === 0) continue
        return { ok: false, status: 503, error: `Gemini returned an invalid safety report after one correction attempt: ${parsed.error.message}` }
      }
      if (parsed.data.findings.some((finding) =>
        (finding.at !== null && !observedTimes.has(finding.at))
        || (finding.zoneId !== null && !observedZones.has(finding.zoneId)))) {
        validationFeedback = 'a finding referenced a time or zone absent from the saved evidence'
        if (attempt === 0) continue
        return { ok: false, status: 503, error: 'Gemini returned findings that reference times or zones absent from the saved evidence after one correction attempt.' }
      }

      return {
        ok: true,
        report: SafetyReportSchema.parse({
          ...parsed.data,
          runId: evidence.runId,
          generatedAt: new Date().toISOString(),
          disclaimer: 'AI-generated planning observations only; not a certified safety or egress assessment.',
        }),
      }
    }

    return { ok: false, status: 503, error: 'Gemini could not produce a valid safety report.' }
  }
}
