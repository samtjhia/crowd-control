import assert from 'node:assert/strict'
import test from 'node:test'
import { compile } from './compile.ts'
import { capabilities, limits, workedExample } from './testing.ts'

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
