import { DoorOpen, MousePointer2, PersonStanding } from 'lucide-react'
import type { Pick } from '../render/hitTest.ts'
import type { AppliedChange, SimulationView } from '../worker/simulationClient.ts'
import { formatClock } from './incidents.ts'
import { fall, isDown, isOpen, nameOf, recover, setDoor, type MapAction } from './mapActions.ts'

/** What a click on the map does: inspect, trip/help up a person, or close/open a door. */
export type MapTool = 'select' | 'trip' | 'doors'

const TOOLS: { id: MapTool; label: string; hint: string; key: string; Icon: typeof MousePointer2 }[] = [
  { id: 'select', label: 'Select', hint: 'Click a person, door or room to see details', key: 'V', Icon: MousePointer2 },
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

/** Details of the selected person, door or room, with the action a tool click would take. */
export function SelectionDetails({ selection, view, onAction }: {
  selection: Pick | null; view: SimulationView; onAction: (action: MapAction) => void
}) {
  const { scene } = view
  const frame = view.current?.frame ?? null
  if (!selection || !scene) {
    return <p className="sim-muted">Click a person, door or room on the map. Use Trip (F) or Doors (D) to change things with one click.</p>
  }
  const name = nameOf(scene, selection.id)
  if (selection.kind === 'agent') {
    const agent = frame?.agents.find((a) => a.id === selection.id)
    if (!agent) return <p className="sim-muted">{name} is no longer in the simulation.</p>
    const down = isDown(scene, frame, selection.id)
    return (
      <div className="sim-selected">
        <p className="sim-selected-name">{name === selection.id ? `Person ${name}` : name}</p>
        <dl className="sim-facts">
          <div><dt>Status</dt><dd>{down ? 'Down' : STATE_TEXT[agent.state] ?? agent.state}</dd></div>
          {agent.controller && <div><dt>Doing</dt><dd>{agent.controller.replaceAll('-', ' ')}</dd></div>}
        </dl>
        {agent.state !== 'departed' && (
          <button type="button" className="sim-action" onClick={() => onAction(down ? recover(selection.id, name) : fall(selection.id, name))}>
            {down ? 'Help them up' : 'Make them fall'}
          </button>
        )}
      </div>
    )
  }
  if (selection.kind === 'portal') {
    const open = isOpen(scene, selection.id)
    const record = scene.map.portals.find((p) => p.id === selection.id)
    return (
      <div className="sim-selected">
        <p className="sim-selected-name">{name}</p>
        <dl className="sim-facts">
          <div><dt>Status</dt><dd>{open ? 'Open' : 'Closed'}</dd></div>
          {record && <div><dt>Connects</dt><dd>{record.connects.map((id) => nameOf(scene, id)).join(' ↔ ')}</dd></div>}
          {record && <div><dt>Width</dt><dd>{formatSize(Math.max(record.width, record.height), scene.map.units)}</dd></div>}
        </dl>
        <button type="button" className="sim-action" onClick={() => onAction(setDoor(selection.id, name, !open))}>
          {open ? 'Close door' : 'Open door'}
        </button>
      </div>
    )
  }
  const zone = view.metrics?.zones.find((z) => z.zoneId === selection.id)
  const metric = scene.map.units === 'm'
  return (
    <div className="sim-selected">
      <p className="sim-selected-name">{name}</p>
      <dl className="sim-facts">
        <div><dt>People</dt><dd>{zone?.occupancy ?? 0}</dd></div>
        {metric && zone && <div><dt>Density</dt><dd>{zone.density.toFixed(2)} people/m²</dd></div>}
      </dl>
    </div>
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
