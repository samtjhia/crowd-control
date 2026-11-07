import type { AgentBlueprint, AgentTemplate, CompiledGoal, EntitySelector, Goal, PortalRecord, Result, RoomRecord, Selector } from '@crowd-control/contract'
import { fail, ok } from '../result.ts'

/** What exists before the simulation starts: the map's rooms and doors plus the starting crowd. */
export type StaticWorld = { rooms: RoomRecord[]; portals: PortalRecord[]; agents: AgentBlueprint[] }

type Known = { id: string; kind: 'zone' | 'portal' | 'agent'; tags: string[]; label?: string }

/** Selector filters the compiler can resolve today; `inside`, `near`, `where` and `sample` come later. */
const STATIC_FIELDS = new Set(['ids', 'kind', 'tags', 'label'])

/** True when `selector` uses only filters that can be checked against IDs, kind, tags and label. */
export function isSimpleSelector(selector: Selector): selector is EntitySelector {
  return !('binding' in selector) && Object.keys(selector).every((key) => STATIC_FIELDS.has(key))
}

function known(id: string, kind: Known['kind'], tags: string[] | undefined, label: string | undefined): Known {
  return { id, kind, tags: tags ?? [], ...(label !== undefined && { label }) }
}

function matches(entity: Known, selector: EntitySelector): boolean {
  return (selector.ids === undefined || selector.ids.includes(entity.id))
    && (selector.kind === undefined || selector.kind === entity.kind)
    && (selector.tags === undefined || selector.tags.every((tag) => entity.tags.includes(tag)))
    && (selector.label === undefined || selector.label === entity.label)
}

/** Whether agents spawned from `template` would match `selector` (their IDs are unknown until they exist). */
export function templateMatches(template: AgentTemplate, selector: EntitySelector): boolean {
  return selector.ids === undefined && matches(known('', 'agent', template.tags, template.label), selector)
}

/** The starting agents a selector picks out. */
export function selectAgents(agents: AgentBlueprint[], selector: EntitySelector): AgentBlueprint[] {
  return agents.filter((agent) => matches(known(agent.id, 'agent', agent.tags, agent.label), selector))
}

function resolve(selector: Selector, world: StaticWorld, path: string): Result<Known[]> {
  if (!isSimpleSelector(selector)) {
    return fail('UNSUPPORTED_CAPABILITY', 'Goal targets can only use ids, kind, tags and label for now', { path })
  }
  const all: Known[] = [
    ...world.rooms.map((room) => known(room.id, 'zone', room.tags, room.label)),
    ...world.portals.map((portal) => known(portal.id, 'portal', portal.tags, portal.label)),
    ...world.agents.map((agent) => known(agent.id, 'agent', agent.tags, agent.label)),
  ]
  const missing = selector.ids?.filter((id) => !all.some((entity) => entity.id === id)) ?? []
  if (missing.length > 0) return fail('NOT_FOUND', `Goal target ${missing.map((id) => `"${id}"`).join(', ')} does not exist`, { path, affectedIds: missing })
  const found = all.filter((entity) => matches(entity, selector))
  if (found.length === 0) return fail('NOT_FOUND', 'No room, door or person matches this goal target', { path })
  return ok(found)
}

function oneZone(selector: Selector, world: StaticWorld, path: string): Result<string> {
  const found = resolve(selector, world, path)
  if (!found.ok) return found
  if (found.value.some((entity) => entity.kind !== 'zone')) return fail('NOT_FOUND', 'This goal needs a room', { path })
  if (found.value.length > 1) return fail('AMBIGUOUS_SELECTOR', `This goal needs one room but ${found.value.length} match`, { path, affectedIds: found.value.map((zone) => zone.id) })
  return ok(found.value[0]!.id)
}

function oneEntity(selector: Selector, world: StaticWorld, path: string): Result<string> {
  const found = resolve(selector, world, path)
  if (!found.ok) return found
  if (found.value.length > 1) return fail('AMBIGUOUS_SELECTOR', `This goal needs one target but ${found.value.length} match`, { path, affectedIds: found.value.map((entity) => entity.id) })
  return ok(found.value[0]!.id)
}

type Destination = { targetZone: string } | { targetEntityId: string } | { targetIds: string[] }

/** One room → targetZone, one other entity → targetEntityId, several → a fixed candidate set. */
function destination(selector: Selector, world: StaticWorld, path: string): Result<Destination> {
  const found = resolve(selector, world, path)
  if (!found.ok) return found
  if (found.value.length > 1) return ok({ targetIds: found.value.map((entity) => entity.id) })
  const only = found.value[0]!
  return ok(only.kind === 'zone' ? { targetZone: only.id } : { targetEntityId: only.id })
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }
}

/**
 * Turns a planner goal into an engine goal (Contracts §8): selectors become one zone, one
 * entity or a fixed candidate set. Only static targets resolve here (rooms, doors and the
 * starting crowd); anything else fails rather than guessing.
 */
export function compileGoal(goal: Goal, world: StaticWorld, path: string): Result<CompiledGoal> {
  switch (goal.kind) {
    case 'reach': {
      const target = destination(goal.target, world, `${path}.target`)
      if (!target.ok) return target
      return ok({ kind: 'reach', ...target.value, ...optional('selection', goal.selection), ...optional('stopDistance', goal.stopDistance), ...optional('urgency', goal.urgency) })
    }
    case 'avoid': {
      const target = destination(goal.target, world, `${path}.target`)
      if (!target.ok) return target
      return ok({ kind: 'avoid', ...target.value, distance: goal.distance, ...optional('urgency', goal.urgency) })
    }
    case 'wait': {
      if (goal.inside === undefined) return ok({ kind: 'wait', duration: goal.duration })
      const zone = oneZone(goal.inside, world, `${path}.inside`)
      if (!zone.ok) return zone
      return ok({ kind: 'wait', duration: goal.duration, insideZone: zone.value })
    }
    case 'wander': {
      const zone = oneZone(goal.inside, world, `${path}.inside`)
      if (!zone.ok) return zone
      return ok({ kind: 'wander', insideZone: zone.value, ...optional('duration', goal.duration), ...optional('changeTargetEvery', goal.changeTargetEvery) })
    }
    case 'follow':
    case 'queue':
    case 'interact': {
      const target = oneEntity(goal.target, world, `${path}.target`)
      if (!target.ok) return target
      if (goal.kind === 'follow') return ok({ kind: 'follow', targetEntityId: target.value, distance: goal.distance })
      if (goal.kind === 'queue') return ok({ kind: 'queue', targetEntityId: target.value, ...optional('maximumWait', goal.maximumWait) })
      return ok({ kind: 'interact', targetEntityId: target.value })
    }
    case 'sequence': {
      const goals: CompiledGoal[] = []
      for (const [index, child] of goal.goals.entries()) {
        const compiled = compileGoal(child, world, `${path}.goals.${index}`)
        if (!compiled.ok) return compiled
        goals.push(compiled.value)
      }
      return ok({ kind: 'sequence', goals, ...optional('repeat', goal.repeat) })
    }
  }
}
