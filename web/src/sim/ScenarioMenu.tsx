import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Ellipsis, Pencil, Trash2 } from 'lucide-react'

/**
 * Rename or delete the scenario on screen, when it's one of the person's own (written by the
 * assistant). A small menu beside the scenario picker; delete asks to confirm first.
 */
export function ScenarioMenu({ title, onRename, onDelete }: { title: string; onRename: (title: string) => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'menu' | 'rename' | 'delete'>('menu')
  const [name, setName] = useState(title)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape, true)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape, true) }
  }, [open])

  const toggle = () => {
    setMode('menu')
    setName(title)
    setOpen((value) => !value)
  }
  const rename = (event: FormEvent) => {
    event.preventDefault()
    const next = name.trim()
    if (next && next !== title) onRename(next)
    setOpen(false)
  }

  return (
    <div className="sim-scenario-menu" ref={root}>
      <button type="button" className="sim-icon-btn" aria-haspopup="menu" aria-expanded={open} aria-label="Rename or delete this scenario" title="Rename or delete this scenario" onClick={toggle}>
        <Ellipsis size={15} />
      </button>
      {open && (
        <div className="sim-scenario-pop" role={mode === 'menu' ? 'menu' : 'dialog'} aria-label="This scenario">
          {mode === 'menu' && (
            <>
              <button type="button" role="menuitem" onClick={() => setMode('rename')}><Pencil size={14} aria-hidden="true" /> Rename</button>
              <button type="button" role="menuitem" className="is-danger" onClick={() => setMode('delete')}><Trash2 size={14} aria-hidden="true" /> Delete</button>
            </>
          )}
          {mode === 'rename' && (
            <form onSubmit={rename}>
              <label htmlFor="sim-scenario-name">Name</label>
              <input id="sim-scenario-name" value={name} maxLength={80} autoFocus onChange={(event) => setName(event.target.value)} />
              <div className="sim-scenario-pop-actions">
                <button type="button" className="sim-link" onClick={() => setOpen(false)}>Cancel</button>
                <button type="submit" className="sim-action">Save</button>
              </div>
            </form>
          )}
          {mode === 'delete' && (
            <div>
              <p>Delete “{title}”? Its past runs stay in Past runs.</p>
              <div className="sim-scenario-pop-actions">
                <button type="button" className="sim-link" onClick={() => setOpen(false)}>Cancel</button>
                <button type="button" className="sim-action is-danger" onClick={() => { setOpen(false); onDelete() }}>Delete</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
