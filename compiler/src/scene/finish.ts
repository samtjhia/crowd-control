import {
  CompileOutputSchema, parseContract, SCHEMA_VERSION,
  type CompiledMap, type CompiledScene, type CompileInput, type CompileOutput, type InventoryItem, type Result,
} from '@crowd-control/contract'
import type { Behaviour } from '../behaviour/compile.ts'
import { fail } from '../result.ts'

/** Recorded in every scene so saved runs can tell which compiler built them. */
export const COMPILER_VERSION = 'compiler-v1'
/** The engine's seeded random generator; the engine rejects scenes naming any other. */
export const RANDOM_VERSION = 'lcg32-v1'

const AGENT_COMPONENTS = ['physical', 'navigation', 'behavior', 'mobility']

/**
 * What the planner may target next: every room, door and starting person with its real ID
 * (Technical PRD §5 "the LLM receives its inventory and targets actual IDs").
 */
export function inventoryOf(scene: CompiledScene): InventoryItem[] {
  const item = (id: string, kind: InventoryItem['kind'], label: string | undefined, tags: string[] | undefined, componentNames: string[]): InventoryItem =>
    ({ id, kind, ...(label !== undefined && { label }), tags: [...(tags ?? [])], componentNames })
  return [
    ...scene.map.rooms.map((room) => item(room.id, 'zone', room.label, room.tags, [])),
    ...scene.map.portals.map((portal) => item(portal.id, 'portal', portal.label, portal.tags, ['portal'])),
    ...scene.agents.map((agent) => item(agent.id, 'agent', agent.label, agent.tags, [...AGENT_COMPONENTS])),
  ]
}

/**
 * Assembles the scene from a compiled map and behaviour, adds the inventory and resolved model,
 * then validates the whole output against the contract before anyone else sees it. A failure
 * here is a compiler bug, reported as an error rather than handed to the engine.
 */
export function finish(input: CompileInput, map: CompiledMap, profiles: CompiledScene['profiles'], behaviour: Behaviour): Result<CompileOutput> {
  const { plan, model, limits } = input
  const cells = (map.width / map.cellSize) * (map.height / map.cellSize)
  if (cells > limits.maxGridCells) {
    return fail('RESOURCE_LIMIT', `The map needs ${cells} grid cells; the limit is ${limits.maxGridCells}`, { path: 'plan.layout' })
  }
  const scene: CompiledScene = {
    schemaVersion: SCHEMA_VERSION,
    simulationId: plan.simulationId,
    seed: plan.seed,
    model: { units: model.units, dt: model.dt },
    map,
    profiles,
    controllers: behaviour.controllers,
    agents: behaviour.agents,
    jobs: behaviour.jobs,
    rules: behaviour.rules,
    versions: { compiler: COMPILER_VERSION, model: model.version, random: RANDOM_VERSION },
  }
  const output = { scene, resolvedModel: JSON.parse(JSON.stringify(model)) as typeof model, inventory: inventoryOf(scene) }
  const checked = parseContract(CompileOutputSchema, output)
  if (!checked.ok) {
    return fail(checked.error.code, `The compiler produced an invalid scene: ${checked.error.message}`, { ...(checked.error.path !== undefined && { path: checked.error.path }) })
  }
  return checked
}
