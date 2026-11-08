import { parseCompileInput, type CompiledMap, type CompileInput, type CompileOutput, type Result } from '@crowd-control/contract'
import { compileBehaviour } from './behaviour/compile.ts'
import { chainLayout, designPopulation } from './layout/chain.ts'
import { variedChainLayout } from './layout/varied.ts'
import { rasterize, unreachable } from './rasterize/rows.ts'
import { resolveProfiles } from './profiles/catalog.ts'
import { fail } from './result.ts'
import { finish } from './scene/finish.ts'
import { placeStartingObjects } from './scene/objects.ts'
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
 *
 * `varyLayout` turns on seeded layout variation for generated plans (Technical PRD §10): the
 * plan's seed picks the room proportions and door positions. Without it, generated layouts use
 * the preset's fixed proportions and centred doors, as in the worked example. Prepared venues
 * are measured and never vary.
 */
export function compile(input: unknown, options: CompileOptions = {}): Result<CompileOutput> {
  const parsed = parseCompileInput(input)
  if (!parsed.ok) return parsed
  const valid = parsed.value
  switch (valid.plan.layout.mode) {
    case 'generate':
      return compileGenerated(valid, options.varyLayout ?? false)
    case 'lookup':
      return compileLookup(valid)
    case 'upload':
      return compileUpload(valid)
  }
}

export type CompileOptions = { varyLayout?: boolean }

/** Generated chain layouts (§8). Map rows/legend, starting crowd, controllers, jobs and rules. */
function compileGenerated(input: CompileInput, vary: boolean): Result<CompileOutput> {
  const { layout } = input.plan
  if (layout.mode !== 'generate') throw new Error('compileGenerated needs a generated layout')
  const population = designPopulation(input.plan)
  const sized = vary
    ? variedChainLayout(layout.spaces, layout.connections, population, input.model, input.plan.seed)
    : chainLayout(layout.spaces, layout.connections, population, input.model)
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

/**
 * Uploaded floor plans (Technical PRD §7): a reviewed map saved by the floor-plan editor,
 * found among the assets by its asset ID and page. A plan traced without a scale is in body
 * widths ('model' units) and cannot be run with a metre preset (SCALE_CALIBRATION_REQUIRED).
 */
function compileUpload(input: CompileInput): Result<CompileOutput> {
  const { layout } = input.plan
  if (layout.mode !== 'upload') throw new Error('compileUpload needs an upload layout')
  const asset = input.assets.find(({ source }) => source.mode === 'upload' && source.assetId === layout.assetId && source.page === layout.page)
  if (!asset || asset.source.mode !== 'upload') {
    return fail('MAP_NOT_FOUND', `No reviewed floor plan ${layout.assetId} (page ${layout.page}). Open it in the floor-plan editor and save it first.`, { path: 'plan.layout' })
  }
  if (input.model.units === 'm' && (asset.grid.units !== 'm' || asset.source.calibration === null)) {
    return fail('SCALE_CALIBRATION_REQUIRED', 'This floor plan has no scale, so it can only run in body widths. Set its scale in the editor for measurements in metres.', { path: 'model.units' })
  }
  if (asset.grid.units !== input.model.units) {
    return fail('UNSUPPORTED_CAPABILITY', `This floor plan is in ${asset.grid.units === 'm' ? 'metres' : 'body widths'}, but the model preset "${input.model.id}" uses ${input.model.units === 'm' ? 'metres' : 'model units'}`, { path: 'model.units' })
  }
  const prepared = mapFromPrepared(asset)
  if (!prepared.ok) return prepared
  return populate(input, prepared.value.map, prepared.value.areas)
}

/** Shared by every layout source: profiles, the starting crowd, behaviour, then the checked scene. */
function populate(input: CompileInput, layoutMap: CompiledMap, areas: SpawnArea[]): Result<CompileOutput> {
  const withObjects = placeStartingObjects(input.plan.initialOperations, layoutMap)
  if (!withObjects.ok) return withObjects
  const map = withObjects.value
  const profiles = resolveProfiles(input.plan, input.model)
  if (!profiles.ok) return profiles
  const agents = placeInitialAgents(input.plan.initialOperations, areas, profiles.value, input.model)
  if (!agents.ok) return agents
  const behaviour = compileBehaviour(input.plan, { rooms: map.rooms, portals: map.portals, objects: map.entities ?? [], agents: agents.value })
  if (!behaviour.ok) return behaviour
  return finish(input, map, profiles.value, behaviour.value)
}
