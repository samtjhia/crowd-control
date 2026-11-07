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
