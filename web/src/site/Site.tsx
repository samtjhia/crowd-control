import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { CircleAlert, CloudCheck, LogOut } from 'lucide-react'
import { PAGES } from './pages.ts'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/manrope'
import type { SaveState } from './saveState.ts'
import './site.css'

/**
 * Pieces every page shares: the brand, the account menu, and the header of the non-simulator pages.
 */

export function BrandMark() {
  return <span className="cc-mark" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
}


const isCurrent = (href: string) => window.location.pathname.startsWith(href)

function initials(name: string): string {
  const words = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
  return (words.length > 1 ? words[0]![0]! + words.at(-1)![0]! : (words[0] ?? '?').slice(0, 2)).toUpperCase()
}

function saveText(save: SaveState): string | null {
  switch (save.kind) {
    case 'off': return null
    case 'waiting': return 'Press Play: this run saves to Past simulations as it plays.'
    case 'saving': return 'Saving this run to Past simulations…'
    case 'saved': return 'This run is saved to Past simulations.'
    case 'failed': return `This run isn’t being saved: ${save.message}`
  }
}

/** The signed-in person's avatar; its menu has the pages, this run's save state, and sign-out. */
export function AccountMenu({ save = { kind: 'off' } }: { save?: SaveState }) {
  const { user, logout } = useAuth0()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const name = user?.name ?? user?.nickname ?? user?.email ?? 'Signed in'
  const email = user?.email && user.email !== name ? user.email : null
  const status = saveText(save)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape, true)
    }
  }, [open])

  const dot = save.kind === 'off' ? null : <span className={`cc-account-dot${save.kind === 'failed' ? ' is-failed' : save.kind === 'saved' ? '' : ' is-saving'}`} aria-hidden="true" />
  return (
    <div className="cc-account" ref={root}>
      <button ref={button} type="button" className="cc-account-button" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId}
        aria-label={`Account: ${name}${status ? `. ${status}` : ''}`} title={name} onClick={() => setOpen((value) => !value)}>
        {user?.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : initials(name)}
        {dot}
      </button>
      {open && (
        <div className="cc-account-menu" id={menuId} role="menu" aria-label="Account">
          <div className="cc-account-who">
            <span className="cc-account-name">{name}</span>
            {email && <span className="cc-account-email">{email}</span>}
          </div>
          {status && (
            <p className={`cc-account-status${save.kind === 'failed' ? ' is-failed' : ''}`} role="status">
              {save.kind === 'failed' ? <CircleAlert size={14} aria-hidden="true" /> : <CloudCheck size={14} aria-hidden="true" />}
              <span>{status}</span>
            </p>
          )}
          {PAGES.map(({ href, label, Icon }) => (
            <a key={href} href={href} role="menuitem" aria-current={isCurrent(href) ? 'page' : undefined}>
              <Icon size={15} aria-hidden="true" /> {label}
            </a>
          ))}
          <div className="cc-account-sep" role="separator" />
          <button type="button" role="menuitem" className="cc-account-item"
            onClick={() => void logout({ logoutParams: { returnTo: window.location.origin } })}>
            <LogOut size={15} aria-hidden="true" /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}

/** The header of the pages outside the simulator: brand, the pages, and the account. */
export function SiteHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="cc-header">
      <a className="cc-brand" href="/sim"><BrandMark /> <span>Crowd Control</span></a>
      <nav className="cc-nav" aria-label="Pages">
        {PAGES.map(({ href, label, short }) => (
          <a key={href} href={href} aria-current={isCurrent(href) ? 'page' : undefined} aria-label={label}>
            <span className="cc-nav-long">{label}</span><span className="cc-nav-short" aria-hidden="true">{short}</span>
          </a>
        ))}
      </nav>
      {children}
      <AccountMenu />
    </header>
  )
}
