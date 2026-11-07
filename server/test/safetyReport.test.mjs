import assert from 'node:assert/strict'
import test from 'node:test'
import { createGeminiSafetyReporter } from '../dist/safetyReport.js'

const evidence = {
  runId: '37c6729d-9e21-4c8f-a414-fdbf8c56d66c',
  simulationId: 'worked-demo',
  startedAt: '2026-01-01T00:00:00.000Z',
  sampleCount: 21,
  peakDensityByZone: [{ zoneId: 'hall', peakDensity: 2.5, at: 12 }],
  interventions: [],
}

const generatedReport = {
  executiveSummary: 'The saved run contains 21 metric samples and a recorded peak density in the hall.',
  findings: [{
    title: 'Recorded hall density peak',
    observation: 'The highest saved density for the hall was 2.5 at 12 seconds.',
    at: 12,
    zoneId: 'hall',
    recommendation: 'Review the hall layout and collect additional samples around this point.',
  }],
  limitations: ['This run has no saved event log.', 'The venue dimensions and validated safety thresholds are unavailable.'],
}

function geminiResponse(value, status = 200) {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }],
  }), { status, headers: { 'Content-Type': 'application/json' } })
}

test('requires server Gemini credentials without contacting the provider', async () => {
  let called = false
  const generate = createGeminiSafetyReporter({
    fetcher: async () => { called = true; return geminiResponse(generatedReport) },
  })

  assert.deepEqual(await generate(evidence), {
    ok: false,
    status: 503,
    error: 'AI reporting is not configured. Set GEMINI_API_KEY and GEMINI_MODEL on the server.',
  })
  assert.equal(called, false)
})

test('generates a schema-valid, server-disclaimed report from saved evidence', async () => {
  let promptText = ''
  let generationConfig
  const generate = createGeminiSafetyReporter({
    apiKey: 'server-only-key',
    model: 'gemini-test',
    fetcher: async (_url, init) => {
      const body = JSON.parse(init.body)
      promptText = body.contents[0].parts[0].text
      generationConfig = body.generationConfig
      return geminiResponse(generatedReport)
    },
  })

  const result = await generate(evidence)

  assert.equal(result.ok, true)
  assert.equal(result.report.runId, evidence.runId)
  assert.equal(result.report.executiveSummary, generatedReport.executiveSummary)
  assert.equal(result.report.findings[0].zoneId, 'hall')
  assert.equal(result.report.disclaimer, 'AI-generated planning observations only; not a certified safety or egress assessment.')
  assert.match(promptText, /Do not invent hazard thresholds/)
  assert.match(promptText, /"peakDensity":2.5/)
  assert.equal(generationConfig.responseSchema.properties.limitations.type, 'ARRAY')
})

test('rejects malformed or out-of-range AI reports', async () => {
  const generate = createGeminiSafetyReporter({
    apiKey: 'server-only-key',
    model: 'gemini-test',
    fetcher: async () => geminiResponse({
      ...generatedReport,
      findings: [{ ...generatedReport.findings[0], at: -1 }],
    }),
  })

  const result = await generate(evidence)

  assert.equal(result.ok, false)
  assert.match(result.error, /invalid safety report after one correction attempt/)
})

test('rejects report findings that cite unobserved zones or simulation times', async () => {
  const generate = createGeminiSafetyReporter({
    apiKey: 'server-only-key',
    model: 'gemini-test',
    fetcher: async () => geminiResponse({
      ...generatedReport,
      findings: [{ ...generatedReport.findings[0], at: 11, zoneId: 'unrecorded-zone' }],
    }),
  })

  const result = await generate(evidence)

  assert.equal(result.ok, false)
  assert.match(result.error, /times or zones absent from the saved evidence/)
})

test('retries once when Gemini returns limitations as a string', async () => {
  let calls = 0
  let correctionPrompt = ''
  const generate = createGeminiSafetyReporter({
    apiKey: 'server-only-key',
    model: 'gemini-test',
    fetcher: async (_url, init) => {
      calls += 1
      correctionPrompt = JSON.parse(init.body).contents[0].parts[0].text
      return geminiResponse(calls === 1
        ? { ...generatedReport, limitations: 'The event records are not available.' }
        : generatedReport)
    },
  })

  const result = await generate(evidence)

  assert.equal(result.ok, true)
  assert.equal(calls, 2)
  assert.match(correctionPrompt, /limitations MUST be an array of strings/)
  assert.match(correctionPrompt, /previous response was invalid/)
})
