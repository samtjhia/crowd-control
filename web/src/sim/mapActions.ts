import type { Frame, Operation, RenderScene } from '@crowd-control/contract'

/**
 * What clicking on the map asks the simulation to do. Each action is an ordinary follow-up
 * request (`set` operations), the same path chat edits take, so the engine records it as an
 * intervention and it appears in the Changes list (Technical PRD §5 "Generic mobility loss").
 */
export type MapAction = { label: string; operations: Operation[] }

/** A generic fall: zero mobility plus the fallen pose. The person keeps their goal. */
export function fall(id: string, name: string): MapAction {
  return {
    label: `${name} falls`,
    operations: [{ op: 'set', targets: { ids: [id] }, values: { components: { mobility: { speedMultiplier: 0 } }, appearance: { pose: 'fallen' } } }],
  }
}

/** Explicit recovery: mobility back to normal, upright again; they resume their goal. */
export function recover(id: string, name: string): MapAction {
  return {
    label: `${name} gets up`,
    operations: [{ op: 'set', targets: { ids: [id] }, values: { components: { mobility: { speedMultiplier: 1 } }, appearance: { pose: 'upright' } } }],
  }
}

export function setDoor(id: string, name: string, open: boolean): MapAction {
  return {
    label: `${open ? 'Open' : 'Close'} ${name}`,
    operations: [{ op: 'set', targets: { ids: [id] }, values: { components: { portal: { open } } } }],
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

/** The action a click performs with a tool, or null when the tool doesn't apply there. */
export function actionFor(tool: 'trip' | 'doors', scene: RenderScene, frame: Frame | null, kind: 'agent' | 'portal' | 'zone', id: string): MapAction | null {
  const name = nameOf(scene, id)
  if (tool === 'trip' && kind === 'agent') return isDown(scene, frame, id) ? recover(id, name) : fall(id, name)
  if (tool === 'doors' && kind === 'portal') return setDoor(id, name, !isOpen(scene, id))
  return null
}
