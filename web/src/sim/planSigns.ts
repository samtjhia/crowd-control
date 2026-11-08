import type { Frame, RenderScene } from '@crowd-control/contract'
import type { Incident, SignKind } from './incidents.ts'

/** How long a zone event's sign stays posted on the plan, in simulation seconds. */
export const ZONE_SIGN_SECONDS = 10

export type PlanSign = {
  id: string
  kind: SignKind
  /** World coordinates of the sign's anchor. */
  x: number
  y: number
  /** Body radius in world units for agent anchors (sign sits above the body), else 0. */
  lift: number
}

export type VenueNotice = { id: string; kind: SignKind; title: string; time: number }

/**
 * Signs posted on the plan, so every event wears the same sign on plan, timeline and log:
 * - live state: exit doors (green, red when closed), other closed doors, anyone down;
 * - zone events (arrivals and the like): the event's sign in its zone for a few seconds;
 * - venue-wide events (the alarm): a standing notice in the plan's corner.
 * Door and fall events are already shown by live state, so they are not doubled.
 * The canvas underneath is untouched.
 */
export function planSigns(scene: RenderScene, frame: Frame | null, incidents: Incident[], now: number): { signs: PlanSign[]; notices: VenueNotice[] } {
  const signs: PlanSign[] = []
  const notices: VenueNotice[] = []
  for (const portal of scene.map.portals) {
    const isExit = portal.tags?.includes('exit') ?? false
    if (!isExit && portal.open) continue
    signs.push({
      id: `portal-${portal.id}`, kind: portal.open ? 'exit' : 'closed',
      x: portal.x + portal.width / 2, y: portal.y + portal.height / 2, lift: 0,
    })
  }
  if (frame) {
    const radius = new Map(scene.agents.map((agent) => [agent.id, agent.radius]))
    for (const agent of frame.agents) {
      if (agent.state !== 'immobile') continue
      signs.push({ id: `down-${agent.id}`, kind: 'warning', x: agent.x, y: agent.y, lift: radius.get(agent.id) ?? 0.5 })
    }
  }
  const rooms = new Map(scene.map.rooms.map((room) => [room.id, room]))
  const shownByState = new Set(['Fall', 'Helped up', 'Door closed', 'Door opened', 'Left the venue', 'Removed'])
  for (const incident of incidents) {
    if (shownByState.has(incident.title)) continue
    const room = incident.source ? rooms.get(incident.source) : undefined
    if (room) {
      if (now - incident.time > ZONE_SIGN_SECONDS || incident.time > now) continue
      // Inside the zone's top-right corner, clear of the room label at top-left.
      signs.push({ id: `event-${incident.id}`, kind: incident.sign, x: room.x + room.width - 0.6, y: room.y + 0.6, lift: 0 })
    } else if (!incident.source) {
      notices.push({ id: incident.id, kind: incident.sign, title: incident.title, time: incident.time })
    }
  }
  return { signs, notices }
}
