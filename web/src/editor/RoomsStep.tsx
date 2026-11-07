import { useEffect, useRef } from 'react'
import { Hand, PaintBucket, Redo2, Slash, Trash2, TriangleAlert, Undo2, Wand2 } from 'lucide-react'
import { ROOM_TAGS } from './rooms.ts'
import type { RoomEditor, RoomTool } from './useRoomEditor.ts'

const TOOLS: { id: RoomTool; label: string; key: string; Icon: typeof Hand }[] = [
  { id: 'fill', label: 'Fill', key: 'F', Icon: PaintBucket },
  { id: 'split', label: 'Split line', key: 'L', Icon: Slash },
  { id: 'move', label: 'Move', key: 'M', Icon: Hand },
]

/**
 * Step 4: rooms. Click a space to make it a room, name it, and tag it. Names and tags are what
 * the planner and the person refer to later ("everyone to the gym").
 */
export function RoomsStep({ rooms, onBack, onNext }: { rooms: RoomEditor; onBack: () => void; onNext?: () => void }) {
  return (
    <section className="sim-section">
      <h3>4 · Rooms</h3>
      <p className="sim-muted">
        Find every space at once, then check them; or click inside a space to make one room. Only rooms are floor people can use, so keep outdoor areas as rooms if people should go there.
      </p>

      <div className="sim-actions">
        <button type="button" className={`sim-action${rooms.rooms.length > 0 ? ' editor-secondary' : ''}`} onClick={rooms.findRooms}>
          <Wand2 size={14} aria-hidden="true" /> {rooms.rooms.length > 0 ? 'Find more rooms' : 'Find rooms'}
        </button>
        {rooms.rooms.length > 0 && <button type="button" className="sim-action editor-secondary" onClick={rooms.clearAll}>Remove all</button>}
      </div>
      {rooms.notice && <p className="editor-notice" role="status">{rooms.notice}</p>}

      <div className="editor-segmented" role="radiogroup" aria-label="Room tool">
        {TOOLS.map(({ id, label, key, Icon }) => (
          <button key={id} type="button" role="radio" aria-checked={rooms.tool === id} onClick={() => rooms.setTool(id)} aria-keyshortcuts={key} title={`${label} (${key})`}>
            <Icon size={15} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>

      <div className="editor-field">
        {rooms.scaled ? (
          <>
            <label htmlFor="room-gap">Stop at openings narrower than <output htmlFor="room-gap">{rooms.gapMetres === 0 ? 'off' : `${rooms.gapMetres.toFixed(1)} m`}</output></label>
            <input id="room-gap" type="range" min={0} max={2.5} step={0.1} value={rooms.gapMetres} onChange={(event) => rooms.setGapMetres(Number(event.target.value))} />
          </>
        ) : (
          <>
            <label htmlFor="room-gap">Stop at openings narrower than <output htmlFor="room-gap">{rooms.gapPixels === 0 ? 'off' : `${rooms.gapPixels} px`}</output></label>
            <input id="room-gap" type="range" min={0} max={80} step={1} value={rooms.gapPixels} onChange={(event) => rooms.setGapPixels(Number(event.target.value))} />
          </>
        )}
        <p className="editor-hint">So a fill stops at doorways. For wider openings, or two areas of one big space, draw a split line where they meet; it divides the space without making a wall.</p>
      </div>

      {rooms.warning && <p className="editor-warning" role="status"><TriangleAlert size={15} aria-hidden="true" /> {rooms.warning}</p>}

      {rooms.rooms.length === 0 ? (
        <p className="editor-empty-list">No rooms yet. Click inside a space on the plan.</p>
      ) : (
        <ul className="editor-rooms">
          {rooms.rooms.map((room) => (
            <RoomRow key={room.id} rooms={rooms} id={room.id} />
          ))}
        </ul>
      )}

      <div className="sim-actions">
        <button type="button" className="sim-action editor-secondary" onClick={rooms.undo} disabled={!rooms.canUndo}><Undo2 size={14} aria-hidden="true" /> Undo</button>
        <button type="button" className="sim-action editor-secondary" onClick={rooms.redo} disabled={!rooms.canRedo}><Redo2 size={14} aria-hidden="true" /> Redo</button>
      </div>
      <p className="editor-hint">Click a room to select it. Shift-click another room or space to merge it into the selected room. Hold Space to move the plan.</p>

      <div className="sim-actions editor-step-nav">
        <button type="button" className="sim-action editor-secondary" onClick={onBack}>Back</button>
        <button type="button" className="sim-action" onClick={onNext} disabled={!onNext || rooms.rooms.length === 0}
          title={!onNext ? 'Marking doors arrives in the next step' : rooms.rooms.length === 0 ? 'Make at least one room first' : undefined}>
          Next: doors
        </button>
      </div>
    </section>
  )
}

function RoomRow({ rooms, id }: { rooms: RoomEditor; id: number }) {
  const room = rooms.rooms.find((r) => r.id === id)!
  const selected = rooms.selected === id
  const input = useRef<HTMLInputElement>(null)
  const area = rooms.area(id)
  // A new room's name is ready to type over.
  useEffect(() => {
    if (rooms.justCreated !== id) return
    input.current?.focus()
    input.current?.select()
    rooms.clearJustCreated()
  }, [rooms, id])
  return (
    <li className={`editor-room${selected ? ' is-selected' : ''}`} onClick={() => rooms.setSelected(id)}>
      <span className="editor-room-swatch" style={{ background: room.color }} aria-hidden="true" />
      <input ref={input} className="editor-room-name" aria-label="Room name" value={room.label} maxLength={60}
        onChange={(event) => rooms.rename(id, event.target.value)} onFocus={() => rooms.setSelected(id)} />
      <span className="editor-room-area">{area === null ? '' : `${Math.round(area)} m²`}</span>
      <button type="button" className="sim-icon-btn" aria-label={`Remove ${room.label}`} title="Remove room" onClick={(event) => { event.stopPropagation(); rooms.remove(id) }}>
        <Trash2 size={14} />
      </button>
      {selected && (
        <div className="editor-tags" role="group" aria-label={`Tags for ${room.label}`}>
          {ROOM_TAGS.map((tag) => (
            <button key={tag} type="button" aria-pressed={room.tags.includes(tag)} onClick={() => rooms.toggleTag(id, tag)}>{tag}</button>
          ))}
        </div>
      )}
    </li>
  )
}
