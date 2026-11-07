import assert from 'node:assert/strict'
import test from 'node:test'
import { compile } from './compile.ts'
import { CompileOutputSchema, type CompileOutput } from '@crowd-control/contract'
import { capabilities, fixture, inline, limits, workedExample } from './testing.ts'

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
})

function compiled(input = workedExample()): CompileOutput {
  const result = compile(input)
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) throw new Error('unreachable')
  return result.value
}

test('Checkpoint A: the worked example compiles end to end to the PRD scene', () => {
  const output = compiled()
  const expected = fixture<CompileOutput>('compile-output')
  const { controllers, agents, jobs, rules, versions, ...scene } = output.scene
  const { controllers: c, agents: a, jobs: j, rules: r, versions: v, ...expectedScene } = expected.scene
  assert.deepEqual(scene, expectedScene) // header, seed, model, the whole map, profiles
  assert.deepEqual(inline(output.scene), inline(expected.scene)) // same goals, our own controller names
  assert.deepEqual(versions, { ...v, compiler: 'compiler-v1' })
  assert.deepEqual(output.inventory, expected.inventory)
  assert.deepEqual(output.resolvedModel, expected.resolvedModel)
})

test('the output satisfies the contract schema and is deterministic', () => {
  const output = compiled()
  assert.equal(CompileOutputSchema.safeParse(output).success, true)
  assert.deepEqual(compiled(), output)
})

test('the output shares nothing with the input', () => {
  const input = workedExample()
  const output = compiled(input)
  output.resolvedModel.defaultAgent.physical.radius = 9
  output.scene.map.rooms[0]!.appearance!.fill = '#000000'
  output.scene.agents[0]!.appearance!.fill = '#000000'
  output.scene.agents[0]!.tags.push('changed')
  assert.deepEqual(input, workedExample())
})

test('a map larger than the grid-cell limit is refused', () => {
  const result = compile({ ...workedExample(), limits: { ...limits, maxGridCells: 100 } })
  assert.equal(result.ok ? null : result.error.code, 'RESOURCE_LIMIT')
})
