import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Capabilities, CompileInput, CompileOutput, Limits, ScenarioPlan } from '@crowd-control/contract'
import { compile } from './compile.ts'

const fixture = <T>(name: string) => JSON.parse(readFileSync(new URL(`../../contract/fixtures/${name}.json`, import.meta.url), 'utf8')) as T

const capabilities: Capabilities = {
  operations: ['add', 'spawn', 'remove', 'set', 'assign_goal', 'clear_goal', 'schedule', 'define_rule', 'remove_rule', 'emit'],
  goals: ['reach', 'avoid', 'wait', 'wander', 'follow', 'queue', 'interact', 'sequence'],
  geometry: ['rectangle', 'circle', 'polygon', 'thick_line'],
  layouts: ['generate', 'upload', 'lookup'],
  entityMetrics: [],
  editableHistory: true,
}
const limits: Limits = {
  maxAgents: 2000, maxGridCells: 1_000_000, maxOperationsPerBatch: 100, maxSelectorDepth: 4, maxSelectorWork: 1000,
  maxGoalDepth: 4, maxRuleCascades: 100, maxRuleCounters: 2000, maxPendingJobs: 1000, maxUploadBytes: 10_000_000,
  maxSourcePixels: 1_000_000, maxPages: 10,
}

/** The Technical PRD §8 worked example as compiler input. */
function workedExample(): CompileInput {
  return {
    plan: fixture<ScenarioPlan>('scenario-plan'),
    assets: [],
    model: fixture<CompileOutput>('compile-output').resolvedModel,
    capabilities,
    limits,
  }
}

test('malformed input is rejected before compiling, with the failing path', () => {
  const missingPlan = compile({ ...workedExample(), plan: undefined })
  assert.equal(missingPlan.ok, false)
  if (missingPlan.ok) return
  assert.equal(missingPlan.error.code, 'INVALID_SCHEMA')

  const badWeight = workedExample()
  if (badWeight.plan.layout.mode !== 'generate') throw new Error('fixture should be generated')
  ;(badWeight.plan.layout.spaces[0] as { areaWeight: number }).areaWeight = 0
  const result = compile(badWeight)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.error.code, 'INVALID_SCHEMA')
  assert.match(result.error.path ?? '', /areaWeight/)

  assert.equal(compile('not an object').ok, false)
})

test('the capabilities and limits carried in the input are enforced', () => {
  const noWander = compile({ ...workedExample(), capabilities: { ...capabilities, goals: capabilities.goals.filter((goal) => goal !== 'wander') } })
  assert.equal(noWander.ok ? null : noWander.error.code, 'UNSUPPORTED_CAPABILITY')

  const tooMany = compile({ ...workedExample(), limits: { ...limits, maxAgents: 5 } })
  assert.equal(tooMany.ok ? null : tooMany.error.code, 'RESOURCE_LIMIT')
})

test('each layout mode is routed; uploads fail clearly until the upload editor exists', () => {
  const upload = workedExample()
  upload.plan.layout = { mode: 'upload', assetId: 'plan-1', page: 1 }
  const uploaded = compile(upload)
  assert.equal(uploaded.ok ? null : uploaded.error.code, 'UNSUPPORTED_CAPABILITY')
  assert.match(uploaded.ok ? '' : uploaded.error.message, /upload editor/)

  // The valid worked example passes validation and reaches the generated-layout stage.
  const generated = compile(workedExample())
  assert.match(generated.ok ? '' : generated.error.message, /Generated layouts/)
})
