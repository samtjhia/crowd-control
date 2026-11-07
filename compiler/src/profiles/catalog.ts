import type { AgentProfile, ModelPreset, Result, ScenarioPlan } from '@crowd-control/contract'
import { spawnsIn } from '../operations.ts'
import { fail, ok } from '../result.ts'

/** The profile a spawn gets when its template names none. */
export const DEFAULT_PROFILE = 'person'

/** Outline and opacity every agent falls back to; spawn appearance fills in the rest (§8). */
const OUTLINE = { stroke: '#0F172A', strokeWidthPx: 1, opacity: 1 } as const

/**
 * The profiles a plan may name. The planner never defines bodies or speeds itself: it picks
 * one of these by name, and each is derived from the model preset so units always agree.
 * Fields a profile leaves out fall back to the preset's `defaultAgent` when the engine loads
 * the scene (preset → profile → template overrides, Contracts §8).
 */
const CATALOG: { [id: string]: (model: ModelPreset) => AgentProfile } = {
  person: ({ defaultAgent }) => ({
    radius: defaultAgent.physical.radius,
    preferredSpeed: defaultAgent.navigation.preferredSpeed,
    appearance: { ...OUTLINE },
  }),
  /** Product PRD "slower walkers": same body, 60% of the usual pace. */
  'slow-walker': ({ defaultAgent }) => ({
    radius: defaultAgent.physical.radius,
    preferredSpeed: defaultAgent.navigation.preferredSpeed * 0.6,
    maximumSpeed: defaultAgent.navigation.maximumSpeed * 0.6,
    appearance: { ...OUTLINE },
  }),
}

/** Profile names the planner may use, for prompts and error messages. */
export const PROFILE_IDS = Object.keys(CATALOG)

/**
 * The profiles this plan uses, in catalog order: those named by any spawn (initial, timeline
 * or rule), plus `person` for spawns that name none. Unknown names fail with the spawn's path.
 * Each call builds fresh objects, so scenes never share profile data.
 */
export function resolveProfiles(plan: ScenarioPlan, model: ModelPreset): Result<{ [id: string]: AgentProfile }> {
  const used = new Set<string>()
  for (const { spawn, path } of spawnsIn(plan)) {
    const id = spawn.template.profile ?? DEFAULT_PROFILE
    if (!Object.hasOwn(CATALOG, id)) {
      return fail('NOT_FOUND', `Unknown profile "${id}"; available profiles are ${PROFILE_IDS.join(', ')}`, { path: `${path}.template.profile`, affectedIds: [id] })
    }
    used.add(id)
  }
  const profiles: { [id: string]: AgentProfile } = {}
  for (const id of PROFILE_IDS) if (used.has(id)) profiles[id] = CATALOG[id]!(model)
  return ok(profiles)
}
