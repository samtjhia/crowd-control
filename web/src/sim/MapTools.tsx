import { DoorOpen, MousePointer2, PersonStanding } from 'lucide-react'
import type { Pick } from '../render/hitTest.ts'
import type { AppliedChange, SimulationView } from '../worker/simulationClient.ts'
import { formatClock } from './incidents.ts'
import { isDown, isOpen, nameOf, presentPeople, selectionActions, type MapAction } from './mapActions.ts'

/** What a click on the map does: inspect, trip/help up a person, or close/open a door. */
export type MapTool = 'select' | 'trip' | 'doors'

const TOOLS: { id: MapTool; label: string; hint: string; key: string; Icon: typeof MousePointer2 }[] = [
  { id: 'select', label: 'Select', hint: 'Click a person, door or room to see details. Shift-click or Shift-drag to select several', key: 'V', Icon: MousePointer2 },
  { id: 'trip', label: 'Trip', hint: 'Click a person to make them fall, or to help them up', key: 'F', Icon: PersonStanding },
  { id: 'doors', label: 'Doors', hint: 'Click a door to close it, or to open it again', key: 'D', Icon: DoorOpen },
]

export function MapToolbar({ tool, onTool }: { tool: MapTool; onTool: (tool: MapTool) => void }) {
  return (
    <div className="sim-float sim-tools" role="radiogroup" aria-label="Map tool">
      {TOOLS.map(({ id, label, hint, key, Icon }) => (
        <button key={id} type="button" role="radio" aria-checked={tool === id} onClick={() => onTool(id)}
          title={`${label} (${key}): ${hint}`} aria-keyshortcuts={key}>
          <Icon size={15} strokeWidth={2} aria-hidden="true" />
          <span>{label}</span>
        </button>
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
export function SelectionDetails({ selection, view, onAction, onClear }: {
  selection: readonly Pick[]; view: SimulationView; onAction: (action: MapAction) => void; onClear: () => void
}) {
  const { scene } = view
  const frame = view.current?.frame ?? null
  if (selection.length === 0 || !scene) {
    return (
      <p className="sim-muted">
        Click a person, door or room on the map. Shift-click or Shift-drag to select several. Use Trip (F) or Doors (D) to change things with one click.
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

  if (selection.length === 1) {
    const [only] = selection
    return <div className="sim-selected">{single(only!, view)}{buttons}</div>
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

/** Facts about one selected person, door or room. */
function single(pick: Pick, view: SimulationView) {
  const scene = view.scene!
  const frame = view.current?.frame ?? null
  const name = nameOf(scene, pick.id)
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
        </dl>
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
    </>
  )
}

function formatSize(value: number, units: 'm' | 'model') {
  return units === 'm' ? `${value.toFixed(2).replace(/\.?0+$/, '')} m` : `${value} body widths`
}

/** Everything changed in this run, oldest first, with the simulation time it took effect. */
export function ChangesList({ changes }: { changes: AppliedChange[] }) {
  if (changes.length === 0) {
    return <p className="sim-muted">No changes yet. Falls and door changes from the map, and later from the assistant, are listed here.</p>
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
