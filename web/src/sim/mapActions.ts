import type { Frame, Operation, RenderScene, Vec2 } from '@crowd-control/contract'
import type { Pick } from '../render/hitTest.ts'

/**
 * What clicking on the map asks the simulation to do. Each action is an ordinary follow-up
 * request (`set` operations), the same path chat edits take, so the engine records it as an
 * intervention and it appears in the Changes list (Technical PRD §5 "Generic mobility loss").
 * A group action targets every ID at once, so it is one change, not one per person.
 */
export type MapAction = { label: string; operations: Operation[] }

/** A generic fall: zero mobility plus the fallen pose. People keep their goals. */
export function fall(ids: string[], who: string): MapAction {
  return {
    label: `${who} ${ids.length === 1 ? 'falls' : 'fall'}`,
    operations: [{ op: 'set', targets: { ids }, values: { components: { mobility: { speedMultiplier: 0 } }, appearance: { pose: 'fallen' } } }],
  }
}

/** Explicit recovery: mobility back to normal, upright again; they resume their goals. */
export function recover(ids: string[], who: string): MapAction {
  return {
    label: `${who} ${ids.length === 1 ? 'gets' : 'get'} up`,
    operations: [{ op: 'set', targets: { ids }, values: { components: { mobility: { speedMultiplier: 1 } }, appearance: { pose: 'upright' } } }],
  }
}

export function setDoors(ids: string[], what: string, open: boolean): MapAction {
  return {
    label: `${open ? 'Open' : 'Close'} ${what}`,
    operations: [{ op: 'set', targets: { ids }, values: { components: { portal: { open } } } }],
  }
}

/** Whether a person is currently down (fallen pose or no mobility). */
export function isDown(scene: RenderScene, frame: Frame | null, id: string): boolean {
  const pose = scene.agents.find((agent) => agent.id === id)?.appearance.pose
  const state = frame?.agents.find((agent) => agent.id === id)?.state
  return pose === 'fallen' || state === 'immobile'
}

/** Whether a door is open, from its portal record or its portal entity. */
export function isOpen(scene: RenderScene, id: string): boolean {
  return scene.map.portals.find((portal) => portal.id === id)?.open
    ?? scene.entities.find((entity) => entity.id === id)?.components?.portal?.open
    ?? true
}

/** A readable name for anything on the map: its label, else its ID (`hall_door` reads "hall door"). */
export function nameOf(scene: RenderScene, id: string): string {
  const agent = scene.agents.find((a) => a.id === id)
  if (agent) return agent.label ?? id
  return scene.map.rooms.find((r) => r.id === id)?.label
    ?? scene.map.portals.find((p) => p.id === id)?.label
    ?? scene.entities.find((e) => e.id === id)?.label
    ?? id.replaceAll('_', ' ')
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Who or what an action names in the Changes list: "a3", "12 people", "hall door", "2 doors". */
function describe(scene: RenderScene, ids: string[], one: string, many: string): string {
  return ids.length === 1 ? nameOf(scene, ids[0]!) : count(ids.length, one, many)
}

/** People in a selection who are still in the simulation (departed people drop out). */
export function presentPeople(frame: Frame | null, picks: readonly Pick[]): string[] {
  const present = new Set(frame?.agents.filter((agent) => agent.state !== 'departed').map((agent) => agent.id) ?? [])
  return picks.filter((pick) => pick.kind === 'agent' && present.has(pick.id)).map((pick) => pick.id)
}

/**
 * The actions that make sense for everything selected, each applied only to the items it
 * fits: standing people can fall, fallen people can get up, open doors can close, closed
 * doors can open. A button reads "Make them fall" for one person and "Make 12 fall" for many.
 */
export function selectionActions(scene: RenderScene, frame: Frame | null, picks: readonly Pick[]): { button: string; action: MapAction }[] {
  const people = presentPeople(frame, picks)
  const down = people.filter((id) => isDown(scene, frame, id))
  const standing = people.filter((id) => !isDown(scene, frame, id))
  const doors = picks.filter((pick) => pick.kind === 'portal').map((pick) => pick.id)
  const open = doors.filter((id) => isOpen(scene, id))
  const closed = doors.filter((id) => !isOpen(scene, id))
  const single = people.length + doors.length === 1
  const actions: { button: string; action: MapAction }[] = []
  if (standing.length > 0) actions.push({ button: single ? 'Make them fall' : `Make ${standing.length} fall`, action: fall(standing, describe(scene, standing, 'person', 'people')) })
  if (down.length > 0) actions.push({ button: single ? 'Help them up' : `Help ${down.length} up`, action: recover(down, describe(scene, down, 'person', 'people')) })
  if (open.length > 0) actions.push({ button: single ? 'Close door' : `Close ${count(open.length, 'door', 'doors')}`, action: setDoors(open, describe(scene, open, 'door', 'doors'), false) })
  if (closed.length > 0) actions.push({ button: single ? 'Open door' : `Open ${count(closed.length, 'door', 'doors')}`, action: setDoors(closed, describe(scene, closed, 'door', 'doors'), true) })
  return actions
}

/** The action a single click performs with a tool, or null when the tool doesn't apply there. */
export function actionFor(tool: 'trip' | 'doors', scene: RenderScene, frame: Frame | null, kind: Pick['kind'], id: string): MapAction | null {
  const name = nameOf(scene, id)
  if (tool === 'trip' && kind === 'agent') return isDown(scene, frame, id) ? recover([id], name) : fall([id], name)
  if (tool === 'doors' && kind === 'portal') return setDoors([id], name, !isOpen(scene, id))
  return null
}

/**
 * How big a danger is and how people react, by map units: its radius, how far away people
 * notice it, and how far they keep from it. Body-width maps use about half the metre numbers.
 */
export const DANGER = { m: { radius: 1.5, notice: 12, keep: 6 }, model: { radius: 0.75, notice: 6, keep: 3 } } as const

/**
 * Drops a danger (a fire, a spill, a threat) at a point: a red circle on the map tagged
 * `hazard`, and everyone who notices it (within `notice`) moves until they are `keep` away
 * and stays clear. People further off carry on. One change, so it can be seen in Changes.
 */
export function placeDanger(scene: RenderScene, frame: Frame | null, at: Vec2): MapAction {
  const size = DANGER[scene.map.units === 'm' ? 'm' : 'model']
  const taken = new Set([...scene.map.rooms, ...scene.map.portals, ...(scene.map.entities ?? []), ...scene.entities, ...scene.agents].map((thing) => thing.id))
  let n = 1
  while (taken.has(`danger_${n}`)) n++
  const id = `danger_${n}`
  const near = (frame?.agents ?? []).filter((agent) => agent.state !== 'departed' && Math.hypot(agent.x - at.x, agent.y - at.y) <= size.notice).map((agent) => agent.id)
  const operations: Operation[] = [{
    op: 'add',
    entity: {
      id, kind: 'object', label: `Danger ${n}`, tags: ['hazard'],
      shape: { kind: 'circle', center: { x: at.x, y: at.y }, radius: size.radius },
      appearance: { fill: '#DC2626', opacity: 0.35, stroke: '#B91C1C', strokeWidthPx: 2 },
    },
  }]
  if (near.length > 0) operations.push({ op: 'assign_goal', targets: { ids: near }, goal: { kind: 'avoid', target: { ids: [id] }, distance: size.keep, urgency: 1 } })
  return { label: `Danger ${n} placed${near.length > 0 ? `, ${count(near.length, 'person keeps', 'people keep')} away` : ''}`, operations }
}

/** Adds a pick to the selection, or removes it if it is already there (Shift-click). */
export function toggle(picks: readonly Pick[], pick: Pick): Pick[] {
  return picks.some((p) => p.kind === pick.kind && p.id === pick.id)
    ? picks.filter((p) => !(p.kind === pick.kind && p.id === pick.id))
    : [...picks, pick]
}

/** Adds picks to the selection without duplicates (Shift-drag). */
export function union(picks: readonly Pick[], added: readonly Pick[]): Pick[] {
  const result = [...picks]
  for (const pick of added) if (!result.some((p) => p.kind === pick.kind && p.id === pick.id)) result.push(pick)
  return result
}
