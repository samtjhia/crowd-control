import { readFileSync } from 'node:fs'
import type { Capabilities, CompileInput, CompileOutput, Limits, ScenarioPlan } from '@crowd-control/contract'

/** Test helpers only; not exported from the package. */
export const fixture = <T>(name: string) =>
  JSON.parse(readFileSync(new URL(`../../contract/fixtures/${name}.json`, import.meta.url), 'utf8')) as T

export const capabilities: Capabilities = {
  operations: ['add', 'spawn', 'remove', 'set', 'assign_goal', 'clear_goal', 'schedule', 'define_rule', 'remove_rule', 'emit'],
  goals: ['reach', 'avoid', 'wait', 'wander', 'follow', 'queue', 'interact', 'sequence'],
  geometry: ['rectangle', 'circle', 'polygon', 'thick_line'],
  layouts: ['generate', 'upload', 'lookup'],
  entityMetrics: [],
  editableHistory: true,
}

export const limits: Limits = {
  maxAgents: 2000, maxGridCells: 1_000_000, maxOperationsPerBatch: 100, maxSelectorDepth: 4, maxSelectorWork: 1000,
  maxGoalDepth: 4, maxRuleCascades: 100, maxRuleCounters: 2000, maxPendingJobs: 1000, maxUploadBytes: 10_000_000,
  maxSourcePixels: 1_000_000, maxPages: 10,
}

/** The Technical PRD §8 worked example as compiler input. */
export function workedExample(): CompileInput {
  return {
    plan: fixture<ScenarioPlan>('scenario-plan'),
    assets: [],
    model: fixture<CompileOutput>('compile-output').resolvedModel,
    capabilities,
    limits,
  }
}
