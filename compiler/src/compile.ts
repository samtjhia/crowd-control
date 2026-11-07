import { parseCompileInput, type CompiledMap, type CompileInput, type CompileOutput, type Result } from '@crowd-control/contract'
import { compileBehaviour } from './behaviour/compile.ts'
import { chainLayout, designPopulation } from './layout/chain.ts'
import { rasterize, unreachable } from './rasterize/rows.ts'
import { resolveProfiles } from './profiles/catalog.ts'
import { fail } from './result.ts'
import { finish } from './scene/finish.ts'
import { mapFromPrepared } from './scene/prepared.ts'
import { placeInitialAgents, rectArea, type SpawnArea } from './spawn/lattice.ts'

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

/** Generated chain layouts (§8). Map rows/legend, starting crowd, controllers, jobs and rules. */
function compileGenerated(input: CompileInput): Result<CompileOutput> {
  const { layout } = input.plan
  if (layout.mode !== 'generate') throw new Error('compileGenerated needs a generated layout')
  const sized = chainLayout(layout.spaces, layout.connections, designPopulation(input.plan), input.model)
  if (!sized.ok) return sized
  const { rooms, portals, worldWidth, worldHeight, cellSize } = sized.value
  const grid = rasterize([...rooms, ...portals], worldWidth, worldHeight, cellSize)
  if (!grid.ok) return grid
  const cutOff = unreachable(grid.value, rooms[0]!.id)
  if (cutOff.length > 0) {
    return fail('LAYOUT_CONSTRAINTS_UNSATISFIABLE', `Not every space connects: ${cutOff.join(', ')} cannot be reached`, { affectedIds: cutOff })
  }
  const map: CompiledMap = {
    units: input.model.units, cellSize, width: worldWidth, height: worldHeight, rooms, portals,
    rows: grid.value.rows, legend: grid.value.legend, source: { mode: 'generate', accuracy: 'approximate' },
  }
  return populate(input, map, rooms.map(rectArea))
}

/**
 * Prepared venues (Technical PRD §2 "Lookup"): resolve venue + floor to a reviewed map among
 * the supplied assets and record its revision. Geometry is measured, never resized to fit the
 * crowd; if people don't fit, placement fails instead.
 */
function compileLookup(input: CompileInput): Result<CompileOutput> {
  const { layout } = input.plan
  if (layout.mode !== 'lookup') throw new Error('compileLookup needs a lookup layout')
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
  const asset = input.assets.find(({ source }) => source.mode === 'lookup' && same(source.venue, layout.venue) && same(source.floor, layout.floor))
  if (!asset) {
    const known = input.assets.flatMap(({ source }) => (source.mode === 'lookup' ? [`${source.venue} (${source.floor})`] : []))
    return fail('MAP_NOT_FOUND', `No prepared map for ${layout.venue}, ${layout.floor}${known.length > 0 ? `; available: ${known.join(', ')}` : ''}`, { path: 'plan.layout' })
  }
  if (asset.grid.units !== input.model.units) {
    return fail('UNSUPPORTED_CAPABILITY', `${layout.venue} is measured in ${asset.grid.units === 'm' ? 'metres' : 'model units'}, but the model preset "${input.model.id}" uses ${input.model.units === 'm' ? 'metres' : 'model units'}`, { path: 'model.units' })
  }
  const prepared = mapFromPrepared(asset)
  if (!prepared.ok) return prepared
  return populate(input, prepared.value.map, prepared.value.areas)
}

/** Shared by every layout source: profiles, the starting crowd, behaviour, then the checked scene. */
function populate(input: CompileInput, map: CompiledMap, areas: SpawnArea[]): Result<CompileOutput> {
  const profiles = resolveProfiles(input.plan, input.model)
  if (!profiles.ok) return profiles
  const agents = placeInitialAgents(input.plan.initialOperations, areas, profiles.value, input.model)
  if (!agents.ok) return agents
  const behaviour = compileBehaviour(input.plan, { rooms: map.rooms, portals: map.portals, agents: agents.value })
  if (!behaviour.ok) return behaviour
  return finish(input, map, profiles.value, behaviour.value)
}
