import { DoorOpen, MapPin, MousePointer2, PersonStanding, SquareDashedMousePointer, TriangleAlert } from 'lucide-react'
import type { ScenarioPlan } from '@crowd-control/contract'
import type { Pick } from '../render/hitTest.ts'
import type { AppliedChange, SimulationView } from '../worker/simulationClient.ts'
import { formatClock } from './incidents.ts'
import { DANGER, isDown, isOpen, nameOf, presentPeople, selectionActions, type MapAction } from './mapActions.ts'
import { objectOf, isHazard, placeFacts, placeReasons, placeUsage } from './places.ts'
import { describePoint, sceneGeometry, type MapPoint } from './points.ts'

/**
 * What the pointer does on the map. Select and Box choose things to inspect; Point marks spots
 * to mention to the assistant; Trip, Doors and Danger change the simulation with one click. In
 * every tool but Box, dragging pans the map.
 */
export type MapTool = 'select' | 'box' | 'point' | 'trip' | 'doors' | 'danger'

const TOOLS: { id: MapTool; label: string; hint: string; key: string; Icon: typeof MousePointer2; group: 'choose' | 'change' }[] = [
  { id: 'select', label: 'Select', hint: 'Click a person, door, room or marked object to see it. Drag to pan; Shift-click or Shift-drag to select several', key: 'V', Icon: MousePointer2, group: 'choose' },
  { id: 'box', label: 'Box', hint: 'Drag a box to select the people and doors inside it; hold Shift to add to the selection', key: 'B', Icon: SquareDashedMousePointer, group: 'choose' },
  { id: 'point', label: 'Point', hint: 'Click the floor to mark a point (A, B, C…), then mention it to the assistant: “put the check-in at point A”', key: 'P', Icon: MapPin, group: 'choose' },
  { id: 'trip', label: 'Trip', hint: 'Click a person to make them fall, or to help them up', key: 'F', Icon: PersonStanding, group: 'change' },
  { id: 'doors', label: 'Doors', hint: 'Click a door to close it, or to open it again', key: 'D', Icon: DoorOpen, group: 'change' },
  { id: 'danger', label: 'Danger', hint: `Click the floor to place a danger: people within ${DANGER.m.notice} m move ${DANGER.m.keep} m away from it and stay clear`, key: 'X', Icon: TriangleAlert, group: 'change' },
]

/** A floating toolbar above the playback bar: choose things | change things. */
export function MapToolbar({ tool, onTool }: { tool: MapTool; onTool: (tool: MapTool) => void }) {
  return (
    <div className="sim-float sim-tools" role="radiogroup" aria-label="Map tool">
      {TOOLS.map(({ id, label, hint, key, Icon, group }, index) => (
        <span key={id} className="sim-tool">
          {index > 0 && group !== TOOLS[index - 1]!.group && <span className="sim-tools-divider" aria-hidden="true" />}
          <button type="button" role="radio" aria-checked={tool === id} onClick={() => onTool(id)}
            title={`${label} (${key}): ${hint}`} aria-keyshortcuts={key}>
            <Icon size={16} strokeWidth={2} aria-hidden="true" />
            <span>{label}</span>
            <kbd aria-hidden="true">{key}</kbd>
          </button>
        </span>
      ))}
    </div>
  )
}

const STATE_TEXT: Record<string, string> = {
  idle: 'Standing', reacting: 'Reacting', moving: 'Walking', waiting: 'Waiting', queueing: 'Queueing',
  interacting: 'Being served', blocked: 'Blocked: no open route', immobile: 'Down', departed: 'Has left', failed: 'Goal failed',
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * Details of what is selected, with the actions that apply to it. One item shows its own
 * facts; several show totals, and each action says how many it affects.
 */
export function SelectionDetails({ selection, view, plan, points, onAction, onClear, onRemovePoint }: {
  selection: readonly Pick[]; view: SimulationView; plan: ScenarioPlan | null; points: readonly MapPoint[]
  onAction: (action: MapAction) => void; onClear: () => void; onRemovePoint: (id: string) => void
}) {
  const { scene } = view
  const frame = view.current?.frame ?? null
  if (selection.length === 0 || !scene) {
    return (
      <p className="sim-muted">
        Click a person, door, room or marked object on the map (a blue dot marks things people use; red, a danger). Use Box (B) or Shift-drag to select several, Point (P) to mark spots for the assistant, and Trip (F), Doors (D) or Danger (X) to change things with one click.
      </p>
    )
  }
  const actions = selectionActions(scene, frame, selection)
  const buttons = actions.length > 0 && (
    <div className="sim-actions">
      {actions.map(({ button, action }) => (
        <button key={button} type="button" className="sim-action" onClick={() => onAction(action)}>{button}</button>
      ))}
    </div>
  )

  if (selection.length === 1 && selection[0]!.kind === 'point') {
    const id = selection[0]!.id
    return (
      <div className="sim-selected">
        {pointDetails(id, points, scene)}
        {points.some((p) => p.id === id) && (
          <div className="sim-actions">
            <button type="button" className="sim-action" onClick={() => onRemovePoint(id)}>Remove point</button>
          </div>
        )}
      </div>
    )
  }
  if (selection.length === 1) {
    const [only] = selection
    return <div className="sim-selected">{single(only!, view, plan)}{buttons}</div>
  }

  const people = presentPeople(frame, selection)
  const down = people.filter((id) => isDown(scene, frame, id)).length
  const doors = selection.filter((pick) => pick.kind === 'portal')
  const closed = doors.filter((pick) => !isOpen(scene, pick.id)).length
  const rooms = selection.filter((pick) => pick.kind === 'zone')
  const inRooms = rooms.reduce((sum, pick) => sum + (view.metrics?.zones.find((z) => z.zoneId === pick.id)?.occupancy ?? 0), 0)
  const left = selection.filter((pick) => pick.kind === 'agent').length - people.length
  return (
    <div className="sim-selected">
      <div className="sim-selected-head">
        <p className="sim-selected-name">{plural(selection.length, 'item', 'items')} selected</p>
        <button type="button" className="sim-link" onClick={onClear}>Clear</button>
      </div>
      <dl className="sim-facts">
        {people.length > 0 && <div><dt>People</dt><dd>{people.length}{down > 0 ? `, ${down} down` : ''}</dd></div>}
        {left > 0 && <div><dt>Left</dt><dd>{plural(left, 'person has', 'people have')} left</dd></div>}
        {doors.length > 0 && <div><dt>Doors</dt><dd>{doors.length}{closed > 0 ? `, ${closed} closed` : ''}</dd></div>}
        {rooms.length > 0 && <div><dt>Rooms</dt><dd>{rooms.map((pick) => nameOf(scene, pick.id)).join(', ')}</dd></div>}
        {rooms.length > 0 && <div><dt>In rooms</dt><dd>{plural(inRooms, 'person', 'people')}</dd></div>}
      </dl>
      {buttons}
    </div>
  )
}

/** Where a marked point is: its area and the nearest door and object, and how to use it. */
function pointDetails(id: string, points: readonly MapPoint[], scene: NonNullable<SimulationView['scene']>) {
  const point = points.find((p) => p.id === id)
  if (!point) return <p className="sim-muted">That point was removed.</p>
  const { area, doors, things } = describePoint(point, sceneGeometry(scene))
  const distance = (d: number) => formatSize(Math.round(d * 10) / 10, scene.map.units)
  return (
    <>
      <p className="sim-selected-name">Point {point.id}</p>
      <dl className="sim-facts">
        <div><dt>In</dt><dd>{area ? nameOf(scene, area.id) : 'Not on the floor'}</dd></div>
        {doors[0] && <div><dt>Nearest door</dt><dd>{nameOf(scene, doors[0].item.id)}, {distance(doors[0].distance)}</dd></div>}
        {things[0] && <div><dt>Next to</dt><dd>{nameOf(scene, things[0].item.id)}</dd></div>}
      </dl>
      <p className="sim-point-tip">Mention it to the assistant, like <q>put the check-in at point {point.id}</q> or <q>people come in by the door near point {point.id}</q>.</p>
    </>
  )
}

/** Why people go somewhere, as a short list; nothing when no goal names it. */
function Reasons({ reasons, title = 'Why people go here' }: { reasons: string[]; title?: string }) {
  if (reasons.length === 0) return null
  return (
    <div className="sim-reasons">
      <p className="sim-reasons-title">{title}</p>
      <ul>{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
    </div>
  )
}

/** Facts about one selected person, door, room or object. */
function single(pick: Pick, view: SimulationView, plan: ScenarioPlan | null) {
  const scene = view.scene!
  const frame = view.current?.frame ?? null
  const name = nameOf(scene, pick.id)
  const reasons = pick.kind === 'agent' ? [] : placeReasons(scene, plan, view.changes, pick.id)
  if (pick.kind === 'object') {
    const entity = objectOf(scene, pick.id)
    const about = placeFacts(scene, pick.id)
    const usage = placeUsage(scene, frame, pick.id)
    const hazard = isHazard(entity)
    return (
      <>
        <p className="sim-selected-name">{entity?.label ?? name}</p>
        <p className={`sim-place-kind${hazard ? ' is-hazard' : ''}`}>{about?.kind ?? 'Object'}</p>
        <dl className="sim-facts">
          {about?.facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          {hazard
            ? <div><dt>Within {scene.map.units === 'm' ? `${DANGER.m.keep + 2} m` : `${DANGER.model.keep + 1} widths`}</dt><dd>{plural(usage.near, 'person', 'people')}</dd></div>
            : <>
                <div><dt>Using it</dt><dd>{usage.using}</dd></div>
                <div><dt>Waiting</dt><dd>{usage.waiting}</dd></div>
              </>}
        </dl>
        <Reasons reasons={reasons} title={hazard ? 'What happened here' : undefined} />
      </>
    )
  }
  if (pick.kind === 'agent') {
    const agent = frame?.agents.find((a) => a.id === pick.id)
    if (!agent) return <p className="sim-muted">{name} is no longer in the simulation.</p>
    return (
      <>
        <p className="sim-selected-name">{name === pick.id ? `Person ${name}` : name}</p>
        <dl className="sim-facts">
          <div><dt>Status</dt><dd>{isDown(scene, frame, pick.id) ? 'Down' : STATE_TEXT[agent.state] ?? agent.state}</dd></div>
          {agent.controller && <div><dt>Doing</dt><dd>{agent.controller.replaceAll('-', ' ')}</dd></div>}
        </dl>
      </>
    )
  }
  if (pick.kind === 'portal') {
    const record = scene.map.portals.find((p) => p.id === pick.id)
    return (
      <>
        <p className="sim-selected-name">{name}</p>
        <dl className="sim-facts">
          <div><dt>Status</dt><dd>{isOpen(scene, pick.id) ? 'Open' : 'Closed'}</dd></div>
          {record && <div><dt>Connects</dt><dd>{record.connects.map((id) => nameOf(scene, id)).join(' ↔ ')}</dd></div>}
          {record && <div><dt>Width</dt><dd>{formatSize(Math.max(record.width, record.height), scene.map.units)}</dd></div>}
          {placeFacts(scene, pick.id)?.facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
        <Reasons reasons={reasons} />
      </>
    )
  }
  const zone = view.metrics?.zones.find((z) => z.zoneId === pick.id)
  return (
    <>
      <p className="sim-selected-name">{name}</p>
      <dl className="sim-facts">
        <div><dt>People</dt><dd>{zone?.occupancy ?? 0}</dd></div>
        {scene.map.units === 'm' && zone && <div><dt>Density</dt><dd>{zone.density.toFixed(2)} people/m²</dd></div>}
      </dl>
      <Reasons reasons={reasons} />
    </>
  )
}

function formatSize(value: number, units: 'm' | 'model') {
  return units === 'm' ? `${value.toFixed(2).replace(/\.?0+$/, '')} m` : `${value} body widths`
}

/** Everything changed in this run, oldest first, with the simulation time it took effect. */
export function ChangesList({ changes }: { changes: AppliedChange[] }) {
  if (changes.length === 0) {
    return <p className="sim-muted">No changes yet. Falls, doors and dangers from the map, and changes from the assistant, are listed here.</p>
  }
  return (
    <ol className="sim-changes">
      {changes.map((change) => (
        <li key={change.interventionId}>
          <span>{change.label}</span>
          <time>{formatClock(change.at, false)}</time>
        </li>
      ))}
    </ol>
  )
}
