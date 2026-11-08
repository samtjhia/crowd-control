import type { EntityBlueprint, Frame, InventoryItem, Operation, RenderScene, ScenarioPlan, Selector, Vec2 } from '@crowd-control/contract'
import { describeGoal, describeWho } from '../planner/describe.ts'
import type { AppliedChange } from '../worker/simulationClient.ts'

/**
 * Points of interest: what a table, counter, check-in desk or danger is, who is using it right
 * now, and why people go there. Used by the Selected panel when one of them is clicked.
 */

type Goal = Extract<Operation, { op: 'assign_goal' }>['goal']

/**
 * A place people can use, with what it does, for the assistant: a table or counter (\`interaction\`:
 * how many at once, for how long), something with a queue (\`capacity\`), a check-in desk (a door
 * that takes \`traversalTime\` seconds per person), or a danger.
 */
export type Place = {
  id: string
  label?: string
  tags: string[]
  door?: { traversalTime: number; connects: [string, string] }
  interaction?: { duration: number; slots: number }
  capacity?: { maximumOccupants: number; serviceRate?: number }
  hazard?: boolean
}

/** The places among map entities: objects, and doors that take time to pass (check-in desks). */
export function placesOf(entities: readonly EntityBlueprint[]): Place[] {
  return entities.flatMap((entity): Place[] => {
    const base = { id: entity.id, ...(entity.label !== undefined && { label: entity.label }), tags: [...(entity.tags ?? [])] }
    const portal = entity.components?.portal
    if (entity.kind === 'portal') return portal?.traversalTime ? [{ ...base, door: { traversalTime: portal.traversalTime, connects: [portal.connects[0], portal.connects[1]] } }] : []
    if (entity.kind !== 'object') return []
    const { interaction, capacity } = entity.components ?? {}
    return [{ ...base, ...(interaction && { interaction }), ...(capacity && { capacity }), ...(base.tags.includes('hazard') && { hazard: true }) }]
  })
}

/** The places on a loaded map, including anything added during the run (dangers). */
export function placesInScene(scene: RenderScene): Place[] {
  const doors: EntityBlueprint[] = scene.map.portals.map((portal) => ({
    id: portal.id, kind: 'portal', ...(portal.label !== undefined && { label: portal.label }), ...(portal.tags && { tags: portal.tags }),
    components: { portal: { connects: portal.connects, open: portal.open, ...(portal.traversalTime !== undefined && { traversalTime: portal.traversalTime }) } },
  }))
  const seen = new Set<string>()
  const objects = [...(scene.map.entities ?? []), ...scene.entities].filter((entity) => !seen.has(entity.id) && seen.add(entity.id))
  return placesOf([...doors, ...objects])
}

/** Rooms, doors and objects on the map as planner-style inventory, so goals read with real names. */
export function sceneInventory(scene: RenderScene): InventoryItem[] {
  const items: InventoryItem[] = []
  const add = (id: string, kind: InventoryItem['kind'], label: string | undefined, tags: string[] | undefined) => {
    if (!items.some((item) => item.id === id)) items.push({ id, kind, ...(label !== undefined && { label }), tags: [...(tags ?? [])], componentNames: [] })
  }
  for (const room of scene.map.rooms) add(room.id, 'zone', room.label, room.tags)
  for (const portal of scene.map.portals) add(portal.id, 'portal', portal.label, portal.tags)
  for (const entity of [...(scene.map.entities ?? []), ...scene.entities]) add(entity.id, entity.kind, entity.label, entity.tags)
  return items
}

/** The object entity with this ID, from the map or added during the run. */
export function objectOf(scene: RenderScene, id: string): EntityBlueprint | undefined {
  return [...scene.entities, ...(scene.map.entities ?? [])].find((entity) => entity.id === id && entity.kind === 'object')
}

export const isHazard = (entity: EntityBlueprint | undefined) => entity?.tags?.includes('hazard') ?? false

const seconds = (s: number) => (s >= 90 ? `${Math.round(s / 60)} min` : `${Math.round(s * 10) / 10} s`)

/** What kind of place it is, in a word or two, and its properties as label/value pairs. */
export function placeFacts(scene: RenderScene, id: string): { kind: string; facts: [string, string][] } | null {
  const portal = scene.map.portals.find((p) => p.id === id)
  if (portal) {
    return portal.traversalTime
      ? { kind: 'Check-in point', facts: [['Each person', `${seconds(portal.traversalTime)} to get through`]] }
      : null
  }
  const entity = objectOf(scene, id)
  if (!entity) return null
  if (isHazard(entity)) return { kind: 'Danger', facts: [['Effect', 'People nearby keep their distance']] }
  const facts: [string, string][] = []
  const interaction = entity.components?.interaction
  const capacity = entity.components?.capacity
  if (interaction) {
    facts.push(['At once', `${interaction.slots} ${interaction.slots === 1 ? 'person' : 'people'}`])
    facts.push(['Each visit', seconds(interaction.duration)])
  }
  if (capacity) {
    facts.push(['Holds', `${capacity.maximumOccupants} at most`])
    if (capacity.serviceRate) facts.push(['Serves', `1 every ${seconds(1 / capacity.serviceRate)}`])
  }
  return { kind: interaction || capacity ? 'Used by people' : 'Object', facts }
}

/** Bounds of a door or object, in world units. */
function boundsOf(scene: RenderScene, id: string): { x: number; y: number; width: number; height: number } | null {
  const portal = scene.map.portals.find((p) => p.id === id)
  if (portal) return portal
  const shape = objectOf(scene, id)?.shape
  if (!shape) return null
  if (shape.kind === 'rectangle') return shape
  if (shape.kind === 'circle') return { x: shape.center.x - shape.radius, y: shape.center.y - shape.radius, width: shape.radius * 2, height: shape.radius * 2 }
  const xs = shape.points.map((p) => p.x), ys = shape.points.map((p) => p.y)
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}

function gap(box: { x: number; y: number; width: number; height: number }, p: Vec2): number {
  return Math.hypot(Math.max(box.x - p.x, 0, p.x - box.x - box.width), Math.max(box.y - p.y, 0, p.y - box.y - box.height))
}

/**
 * Who is at a place right now: people beside it being served, and people beside it waiting
 * their turn. For a danger, everyone within `reach` (people keeping away count too).
 */
export function placeUsage(scene: RenderScene, frame: Frame | null, id: string): { using: number; waiting: number; near: number } {
  const box = boundsOf(scene, id)
  if (!box || !frame) return { using: 0, waiting: 0, near: 0 }
  const beside = 1.2
  const around = scene.map.units === 'm' ? 8 : 4
  let using = 0, waiting = 0, near = 0
  for (const agent of frame.agents) {
    if (agent.state === 'departed') continue
    const d = gap(box, agent)
    if (d <= around) near++
    if (d > beside) continue
    if (agent.state === 'interacting') using++
    else if (agent.state === 'queueing' || agent.state === 'waiting') waiting++
  }
  return { using, waiting, near }
}

/** Whether a goal sends people to (or away from) this place: by its ID, or by tags it carries. */
function mentions(goal: Goal, id: string, tags: string[]): boolean {
  const names = (selector: Selector | undefined) => {
    if (!selector || 'binding' in selector) return false
    if (selector.ids) return selector.ids.includes(id)
    return selector.tags !== undefined && selector.tags.every((tag) => tags.includes(tag))
  }
  switch (goal.kind) {
    case 'reach': case 'avoid': case 'follow': case 'queue': case 'interact': return names(goal.target)
    case 'wander': return false
    case 'wait': return false
    case 'sequence': return goal.goals.some((step) => mentions(step, id, tags))
  }
}

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * Why people go to a place: every goal in the scenario, its timeline and rules, and the changes
 * made since, that names it, as plain sentences ("People tagged arrival: go to Hall, then go to
 * the nearest table…"). A danger placed from the map says so.
 */
export function placeReasons(scene: RenderScene, plan: ScenarioPlan | null, changes: readonly Pick<AppliedChange, 'operations' | 'at'>[], id: string): string[] {
  const inventory = sceneInventory(scene)
  const tags = inventory.find((item) => item.id === id)?.tags ?? []
  const reasons: string[] = []
  const visit = (operations: readonly Operation[], prefix: string, at?: number) => {
    for (const operation of operations) {
      if (operation.op === 'assign_goal' && mentions(operation.goal, id, tags)) {
        // "At 45 s, everyone: …" continues a sentence; otherwise the group starts one.
        const who = describeWho(operation.targets, inventory)
        reasons.push(`${prefix}${prefix.endsWith(', ') ? who : sentence(who)}: ${describeGoal(operation.goal, inventory)}.`)
      } else if (operation.op === 'schedule') {
        visit(operation.operations, 'at' in operation && operation.at !== undefined ? `At ${operation.at} s, ` : `${operation.after} s later, `)
      } else if (operation.op === 'define_rule') {
        const when = operation.when.kind === 'event' ? (operation.when.name === 'alarm' ? 'When the alarm sounds' : `When “${operation.when.name}” happens`) : 'When a condition is met'
        visit(operation.operations, `${when}, `)
      } else if (operation.op === 'add' && operation.entity.id === id) {
        reasons.push(at === undefined ? 'Placed by the scenario.' : `Placed during the run, at ${Math.round(at)} s.`)
      }
    }
  }
  if (plan) {
    visit(plan.initialOperations, '')
    visit(plan.timeline, '')
    visit(plan.rules, '')
  }
  for (const change of changes) visit(change.operations, '', change.at)
  return reasons
}
