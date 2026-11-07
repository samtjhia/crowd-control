import { ArrowLeftRight, DoorOpen, Hand, MousePointer2, Redo2, Trash2, TriangleAlert, Undo2 } from 'lucide-react'
import { formatMetres } from './scale.ts'
import { NARROW_METRES, OPEN_BOUNDARY_METRES, type DoorEditor, type DoorTool } from './useDoorEditor.ts'

const TOOLS: { id: DoorTool; label: string; key: string; Icon: typeof Hand }[] = [
  { id: 'select', label: 'Select', key: 'V', Icon: MousePointer2 },
  { id: 'add', label: 'Add door', key: 'D', Icon: DoorOpen },
  { id: 'move', label: 'Move', key: 'M', Icon: Hand },
]

/**
 * Step 5: doors. Every place two rooms meet was found automatically; the person removes false
 * ones, adds missed ones, and marks exits, one-way and closed doors (Technical PRD §7 step 4).
 */
export function DoorsStep({ doors, onBack, onNext }: { doors: DoorEditor; onBack: () => void; onNext?: () => void }) {
  const narrow = doors.doors.filter((door) => { const w = doors.width(door); return w !== null && w < NARROW_METRES }).length
  return (
    <section className="sim-section">
      <h3>5 · Doors</h3>
      <p className="sim-muted">
        Every place two rooms meet is a door or opening, found from the rooms. Check them: remove false ones, add any that were missed, and mark exits.
      </p>

      <div className="editor-segmented" role="radiogroup" aria-label="Door tool">
        {TOOLS.map(({ id, label, key, Icon }) => (
          <button key={id} type="button" role="radio" aria-checked={doors.tool === id} onClick={() => doors.setTool(id)} aria-keyshortcuts={key} title={`${label} (${key})`}>
            <Icon size={15} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>
      {doors.tool === 'add' && <p className="editor-hint">Drag across the wall or gap between two rooms, the full width of the door. It cuts a doorway through any wall in the way.</p>}

      {doors.warning && <p className="editor-warning" role="status"><TriangleAlert size={15} aria-hidden="true" /> {doors.warning}</p>}
      {doors.isolated.length > 0 && (
        <p className="editor-warning" role="status">
          <TriangleAlert size={15} aria-hidden="true" /> No way in or out of {doors.isolated.join(', ')}. Add a door, or go back and check the walls and rooms.
        </p>
      )}
      {narrow > 0 && (
        <p className="editor-warning" role="status">
          <TriangleAlert size={15} aria-hidden="true" /> {narrow} {narrow === 1 ? 'opening is' : 'openings are'} narrower than a person ({formatMetres(NARROW_METRES)}). Check {narrow === 1 ? 'it' : 'them'}; it may be a gap in a wall rather than a door.
        </p>
      )}

      {doors.doors.length === 0 ? (
        <p className="editor-empty-list">No doors yet. Rooms that touch get doors automatically; use Add door for the rest.</p>
      ) : (
        <ul className="editor-rooms">
          {doors.doors.map((door) => {
            const width = doors.width(door)
            const boundary = width !== null && width >= OPEN_BOUNDARY_METRES
            const selected = doors.selected === door.id
            const name = `${doors.nameOf(door.from)} ${door.oneWay ? '→' : '↔'} ${doors.nameOf(door.to)}`
            return (
              <li key={door.id} className={`editor-room${selected ? ' is-selected' : ''}`} onClick={() => doors.setSelected(door.id)}>
                <span className="editor-room-swatch" style={{ background: !door.open ? '#BB6479' : door.exit ? '#16A34A' : '#EA580C' }} aria-hidden="true" />
                <span className="editor-door-name">{name}</span>
                <span className="editor-room-area">{width === null ? `${Math.round(door.length)} px` : `${boundary ? 'opening ' : ''}${formatMetres(width)}`}</span>
                <button type="button" className="sim-icon-btn" aria-label={`Remove the door ${name}`} title="Remove door" onClick={(event) => { event.stopPropagation(); doors.remove(door.id) }}>
                  <Trash2 size={14} />
                </button>
                {selected && (
                  <div className="editor-tags" role="group" aria-label={`Settings for ${name}`}>
                    <button type="button" aria-pressed={door.exit} onClick={() => doors.update(door.id, { exit: !door.exit })}>Exit</button>
                    <button type="button" aria-pressed={door.oneWay} onClick={() => doors.update(door.id, { oneWay: !door.oneWay })}>One-way</button>
                    {door.oneWay && <button type="button" onClick={() => doors.reverse(door.id)} title="Swap the direction"><ArrowLeftRight size={12} aria-hidden="true" /> Reverse</button>}
                    <button type="button" aria-pressed={!door.open} onClick={() => doors.update(door.id, { open: !door.open })}>Closed at start</button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div className="sim-actions">
        <button type="button" className="sim-action editor-secondary" onClick={doors.undo} disabled={!doors.canUndo}><Undo2 size={14} aria-hidden="true" /> Undo</button>
        <button type="button" className="sim-action editor-secondary" onClick={doors.redo} disabled={!doors.canRedo}><Redo2 size={14} aria-hidden="true" /> Redo</button>
      </div>
      <p className="editor-hint"><span className="editor-key editor-key-door" /> door <span className="editor-key editor-key-exit" /> exit <span className="editor-key editor-key-closed" /> closed. Click a door on the plan to select it.</p>

      <div className="sim-actions editor-step-nav">
        <button type="button" className="sim-action editor-secondary" onClick={onBack}>Back</button>
        <button type="button" className="sim-action" onClick={onNext} disabled={!onNext} title={!onNext ? 'Checking and saving arrives in the next step' : undefined}>Next: check & save</button>
      </div>
    </section>
  )
}
