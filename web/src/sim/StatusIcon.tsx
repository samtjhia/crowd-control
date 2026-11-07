import { DoorOpen, Info, OctagonX, TriangleAlert } from 'lucide-react'
import type { SignKind } from './incidents.ts'

const ICONS = { exit: DoorOpen, warning: TriangleAlert, closed: OctagonX, instruction: Info } as const

/**
 * Round status badge used on the map, the timeline and in the incident log, so one event
 * always looks the same everywhere. Colour comes from the `status-*` class; the icon shape
 * carries the meaning too. Decorative: the adjacent text names the event.
 */
export function StatusIcon({ kind, size = 20 }: { kind: SignKind; size?: number }) {
  const Icon = ICONS[kind]
  return (
    <span className={`status-icon status-${kind}`} style={{ width: size, height: size }} aria-hidden="true">
      <Icon size={Math.round(size * 0.6)} strokeWidth={2.25} />
    </span>
  )
}
