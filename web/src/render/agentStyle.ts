import type { AgentState, Appearance } from '@crowd-control/contract'

export const AGENT_COLORS = {
  default: '#2563EB',
  departed: '#94A3B8',
  alert: '#DC2626',
  outline: '#0F172A',
} as const

const DEPARTED_OPACITY = 0.45

export type ResolvedAgentStyle = {
  fill: string
  stroke: string | null
  strokeWidthPx: number
  opacity: number
  symbol: 'circle' | 'square' | 'triangle'
  pose: 'upright' | 'fallen'
  labelVisible: boolean
}

/**
 * Technical PRD §12 resolution order: theme/state fallbacks, then the worker's resolved
 * appearance (profile defaults merged with per-entity overrides). An explicit group fill
 * is never replaced by a state colour; state is shown by annotations instead.
 */
export function resolveAgentStyle(appearance: Appearance, state: AgentState): ResolvedAgentStyle {
  const departed = state === 'departed'
  const width = appearance.strokeWidthPx ?? 0
  return {
    fill: appearance.fill ?? (departed ? AGENT_COLORS.departed : AGENT_COLORS.default),
    stroke: width > 0 ? (appearance.stroke ?? AGENT_COLORS.outline) : null,
    strokeWidthPx: width,
    opacity: (appearance.opacity ?? 1) * (departed ? DEPARTED_OPACITY : 1),
    symbol: appearance.symbol ?? 'circle',
    pose: appearance.pose ?? 'upright',
    labelVisible: appearance.labelVisible ?? false,
  }
}

/** Movement changes pose, not the marker's geometry or annotation. */
export function visualState(state: AgentState | null): AgentState | null {
  switch (state) {
    case 'idle': case 'moving': case 'waiting': case 'reacting': return 'idle'
    default: return state
  }
}

export type Annotation = {
  /** Status ring colour drawn around the body, or null. */
  ring: string | null
  /** Short text badge so state never relies on colour alone, or null. */
  badge: string | null
}

export function stateAnnotation(state: AgentState, pose: ResolvedAgentStyle['pose']): Annotation {
  switch (state) {
    case 'immobile': return { ring: null, badge: pose === 'fallen' ? 'down' : 'stop' }
    case 'blocked': return { ring: AGENT_COLORS.alert, badge: 'blocked' }
    case 'failed': return { ring: AGENT_COLORS.alert, badge: 'error' }
    case 'queueing': return { ring: null, badge: 'Q' }
    case 'interacting': return { ring: null, badge: 'S' }
    case 'departed': return { ring: null, badge: 'out' }
    default: return { ring: null, badge: pose === 'fallen' ? 'down' : null }
  }
}

/** How people are drawn: illustrated figures (default) or abstract markers. */
export type AgentDrawMode = 'people' | 'markers'

/** The landing page's people palette; scenario group colours map onto it by hue. */
export const GROUP_PALETTE = {
  green: '#397B58', blue: '#5C83B4', rose: '#BF7586', sage: '#769672', amber: '#D3A16D', teal: '#3E6558',
} as const

export const SKIN_TONES = ['#D6A37C', '#9E6A4B', '#E6BC99', '#77513E'] as const
export const HAIR_TONES = ['#303C31', '#564639'] as const

const HAIRSTYLES = ['short', 'long', 'bun', 'ponytail'] as const

/** A stable mix of hairstyles and outfits picked from the person's ID, so the same person always looks the same. */
export function figureLook(id: string): { hair: (typeof HAIRSTYLES)[number]; outfit: 'trousers' | 'skirt' } {
  return {
    hair: HAIRSTYLES[stableIndex(`${id}-hairstyle`, HAIRSTYLES.length)]!,
    outfit: stableIndex(`${id}-outfit`, 3) === 0 ? 'skirt' : 'trousers',
  }
}

function hue(hex: string): { h: number; s: number } | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return null
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((part) => parseInt(part, 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  if (d === 0) return { h: 0, s: 0 }
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: (h * 60 + 360) % 360, s: max === 0 ? 0 : d / max }
}

/**
 * A scenario's group colour, moved onto the palette so every group stays distinguishable
 * but the map stays calm. Groups keep their identity: blue stays blue, purple and red
 * become rose, and so on. No colour means the default green.
 */
export function groupColor(fill: string | undefined): string {
  const c = fill ? hue(fill) : null
  if (!c || c.s < 0.25) return GROUP_PALETTE.green
  if (c.h < 20 || c.h >= 290) return GROUP_PALETTE.rose
  if (c.h < 70) return GROUP_PALETTE.amber
  if (c.h < 160) return GROUP_PALETTE.green
  if (c.h < 200) return GROUP_PALETTE.teal
  if (c.h < 255) return GROUP_PALETTE.blue
  return GROUP_PALETTE.rose
}

/** Stable small integer from an ID, for per-person variety (skin, hair, walk phase). */
export function stableIndex(id: string, modulo: number): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return (h >>> 0) % modulo
}

export type MarkerShape =
  | { kind: 'circle'; radius: number }
  | { kind: 'square'; side: number }
  | { kind: 'triangle'; points: [number, number, number, number, number, number] }
  | { kind: 'ellipse'; radiusX: number; radiusY: number }

/**
 * Marker geometry centred on the agent, in screen pixels. Every marker fits inside the
 * physical body circle; a fallen pose flattens the marker but never enlarges the body.
 */
export function markerShape(style: Pick<ResolvedAgentStyle, 'symbol' | 'pose'>, radiusPx: number): MarkerShape {
  const r = radiusPx
  if (style.pose === 'fallen') return { kind: 'ellipse', radiusX: r, radiusY: r / 3 }
  switch (style.symbol) {
    case 'square': return { kind: 'square', side: Math.SQRT2 * r }
    case 'triangle': return { kind: 'triangle', points: [0, -r, (Math.sqrt(3) * r) / 2, r / 2, (-Math.sqrt(3) * r) / 2, r / 2] }
    case 'circle': return { kind: 'circle', radius: r }
  }
}
