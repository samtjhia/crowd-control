import assert from 'node:assert/strict'
import test from 'node:test'
import { geminiEnabled, isGeminiGeneration } from '../dist/features.js'

test('PROD TRUE disables Gemini, FALSE and an unset flag enable it', () => {
  assert.equal(geminiEnabled('TRUE'), false)
  assert.equal(geminiEnabled(' true '), false)
  assert.equal(geminiEnabled('FALSE'), true)
  assert.equal(geminiEnabled(undefined), true)
  assert.throws(() => geminiEnabled('yes'), /PROD must be TRUE or FALSE/)
})

test('production gate covers planner and report generation without blocking ordinary APIs', () => {
  for (const url of ['/api/plan', '/api/plan?test=1', '/api/runs/example/report', '/api/runs/example/report?units=m']) {
    assert.equal(isGeminiGeneration('POST', url), true, url)
    assert.equal(isGeminiGeneration('GET', url), false, 'reading cached data does not invoke Gemini')
  }
  for (const url of ['/health', '/api/runs', '/api/scenarios', '/api/venues', '/api/runs/example/metrics']) {
    assert.equal(isGeminiGeneration('POST', url), false, url)
  }
})
