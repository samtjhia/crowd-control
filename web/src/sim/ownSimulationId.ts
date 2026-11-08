import type { Scenario } from './scenario.ts'

/**
 * Gives a scenario the assistant wrote a simulation ID of its own. The planner returns plans
 * under the ID of the scenario they were asked from, so without this a run of "check-in at
 * point B" would look like (and replay as) a run of the venue's demo.
 */
export function ownSimulationId(scenario: Scenario): Scenario {
  if (scenario.plan.simulationId.startsWith(scenario.id)) return scenario
  return { ...scenario, plan: { ...scenario.plan, simulationId: `${scenario.id}-${Math.random().toString(36).slice(2, 8)}` } }
}
