import { parseCompileInput, type CompileInput, type CompileOutput, type Result } from '@crowd-control/contract'
import { fail } from './result.ts'

/**
 * Turns a semantic scenario plan (C's planner output) plus prepared assets and a model
 * preset into a compiled scene the engine can load (Technical PRD §8, Contracts §8).
 *
 * The plan describes intent: spaces and their relative sizes, who spawns where, goals,
 * timeline and rules. The compiler supplies everything the plan deliberately leaves out:
 * exact geometry, the navigation grid, starting positions, resolved settings and named
 * controllers. It never invents real-building dimensions: those come from prepared maps.
 *
 * Input is untrusted (it may come straight from an LLM), so it is validated against the
 * contract, including the capabilities and limits it carries, before anything else runs.
 */
export function compile(input: unknown): Result<CompileOutput> {
  const parsed = parseCompileInput(input)
  if (!parsed.ok) return parsed
  const valid = parsed.value
  switch (valid.plan.layout.mode) {
    case 'generate':
      return compileGenerated(valid)
    case 'lookup':
      return compileLookup(valid)
    case 'upload':
      return fail('UNSUPPORTED_CAPABILITY', 'Uploaded floor plans are not supported yet; they arrive with the upload editor', { path: 'plan.layout.mode' })
  }
}

/** Generated chain layouts (§8): built in step 1. */
function compileGenerated(_input: CompileInput): Result<CompileOutput> {
  return fail('UNSUPPORTED_CAPABILITY', 'Generated layouts are not built yet', { path: 'plan.layout' })
}

/** Prepared venue lookup: built in step 8. */
function compileLookup(_input: CompileInput): Result<CompileOutput> {
  return fail('UNSUPPORTED_CAPABILITY', 'Prepared venue lookup is not built yet', { path: 'plan.layout' })
}
