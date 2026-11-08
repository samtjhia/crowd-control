import type { LayoutSource, PreparedMap, RenderScene, Vec2 } from '@crowd-control/contract'
import { objectRects, zoneAt } from '../render/hitTest.ts'

/**
 * Points: spots the person marks on a venue's map (A, B, C…) so they can talk about places
 * that have no name ("put the check-in at point A", "hackers come in by the door near point B").
 * They are notes on the map, not things in the simulation: the assistant is told where each
 * one is, which area it is in, and the nearest doors and objects, and turns that into real
 * operations. Points belong to a venue and are kept in this browser.
 */

export type MapPoint = { id: string; x: number; y: number }

type Rect = { x: number; y: number; width: number; height: number }
type Named = Rect & { id: string; label?: string }
type Door = Named & { connects: [string, string] }

/** What a description of a point needs to know about a map. */
export type PointGeometry = {
  units: 'm' | 'model'
  /** The area at a point, if it is on the floor. */
  areaAt(p: Vec2): { id: string; label?: string } | null
  label(id: string): string | undefined
  /** An area's tags ("outside" marks the street, a car park, a yard). */
  tags(id: string): string[]
  doors: Door[]
  things: Named[]
}

const KEY = 'crowd-control:points'

type KeyValue = { getItem(key: string): string | null; setItem(key: string, value: string): void }
function store(): KeyValue | null {
  return (globalThis as unknown as { localStorage?: KeyValue }).localStorage ?? null
}

/** Which venue a map is, as a storage key: a prepared venue's name and floor, or an uploaded plan's ID. */
export function pointsKeyForSource(source: RenderScene['map']['source'] | undefined, simulationId: string): string {
  if (source?.mode === 'lookup') return `lookup:${source.venue}|${source.floor}`
  if (source?.mode === 'upload') return `upload:${source.assetId}`
  return `generated:${simulationId}`
}

/** The same key for a venue the assistant could set a new scenario in (no key for made-up buildings). */
export function pointsKeyForLayout(layout: LayoutSource): string | null {
  if (layout.mode === 'lookup') return `lookup:${layout.venue}|${layout.floor}`
  if (layout.mode === 'upload') return `upload:${layout.assetId}`
  return null
}

function readAll(): Record<string, MapPoint[]> {
  try {
    const raw = store()?.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as Record<string, MapPoint[]>) : {}
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

export function loadPoints(key: string | null): MapPoint[] {
  if (!key) return []
  const list = readAll()[key]
  return Array.isArray(list) ? list.filter((p) => typeof p?.id === 'string' && Number.isFinite(p.x) && Number.isFinite(p.y)) : []
}

export function savePoints(key: string, points: MapPoint[]) {
  try {
    const all = readAll()
    if (points.length > 0) all[key] = points
    else delete all[key]
    store()?.setItem(KEY, JSON.stringify(all))
  } catch {
    // Points are a convenience; without storage they last until the page closes.
  }
}

/** The next free letter: A to Z, then A2, B2… */
export function nextPointId(points: readonly MapPoint[]): string {
  const taken = new Set(points.map((p) => p.id))
  for (let round = 1; ; round++) {
    for (let c = 65; c <= 90; c++) {
      const id = String.fromCharCode(c) + (round > 1 ? String(round) : '')
      if (!taken.has(id)) return id
    }
  }
}

const gap = (r: Rect, p: Vec2) => Math.hypot(Math.max(r.x - p.x, 0, p.x - r.x - r.width), Math.max(r.y - p.y, 0, p.y - r.y - r.height))

/** The map of a loaded run, for describing points. */
export function sceneGeometry(scene: RenderScene): PointGeometry {
  const entities = [...(scene.map.entities ?? []), ...scene.entities]
  const labels = new Map<string, string>()
  for (const item of [...scene.map.rooms, ...scene.map.portals, ...entities]) if (item.label) labels.set(item.id, item.label)
  const label = (id: string) => labels.get(id)
  const tagged = new Map<string, string[]>()
  for (const item of [...scene.map.rooms, ...entities]) if (item.tags) tagged.set(item.id, item.tags)
  return {
    units: scene.map.units,
    label,
    tags: (id) => tagged.get(id) ?? [],
    areaAt: (p) => {
      const id = zoneAt(scene, p)
      return id ? { id, ...(label(id) !== undefined && { label: label(id) }) } : null
    },
    doors: scene.map.portals.map((d) => ({ id: d.id, ...(d.label !== undefined && { label: d.label }), x: d.x, y: d.y, width: d.width, height: d.height, connects: d.connects })),
    things: objectRects(scene).filter((r) => !entities.find((e) => e.id === r.id)?.tags?.includes('hazard')).map((r) => ({ ...r, ...(label(r.id) !== undefined && { label: label(r.id) }) })),
  }
}

/** A prepared or saved venue's map, for describing points before a scenario runs there. */
export function preparedGeometry(map: PreparedMap): PointGeometry {
  const { grid } = map
  const labels = new Map(map.entities.flatMap((e) => (e.label ? [[e.id, e.label] as const] : [])))
  const label = (id: string) => labels.get(id)
  const tagged = new Map(map.entities.map((e) => [e.id, e.tags ?? []] as const))
  const rect = (shape: NonNullable<PreparedMap['entities'][number]['shape']>): Rect | null => (shape.kind === 'rectangle' ? shape : null)
  return {
    units: grid.units,
    label,
    tags: (id) => tagged.get(id) ?? [],
    areaAt: (p) => {
      const column = Math.floor(p.x / grid.cellSize), row = Math.floor(p.y / grid.cellSize)
      if (column < 0 || row < 0 || column >= grid.width || row >= grid.height) return null
      const i = row * grid.width + column
      const id = grid.blocked[i] === 1 ? null : grid.zoneIds[grid.zoneIndex[i]!] ?? null
      return id ? { id, ...(label(id) !== undefined && { label: label(id) }) } : null
    },
    doors: map.entities.flatMap((e): Door[] => {
      const box = e.kind === 'portal' && e.shape ? rect(e.shape) : null
      const connects = e.components?.portal?.connects
      return box && connects ? [{ id: e.id, ...(e.label !== undefined && { label: e.label }), ...box, connects: [connects[0], connects[1]] }] : []
    }),
    things: map.entities.flatMap((e): Named[] => {
      const box = e.kind === 'object' && e.shape ? rect(e.shape) : null
      return box ? [{ id: e.id, ...(e.label !== undefined && { label: e.label }), ...box }] : []
    }),
  }
}

/** Where a point is, in words: its area, and the nearest doors and objects with distances. */
export function describePoint(point: MapPoint, geo: PointGeometry) {
  const area = geo.areaAt(point)
  const nearest = <T extends Named>(list: T[], limit: number, within: number) => list
    .map((item) => ({ item, distance: gap(item, point) }))
    .filter(({ distance }) => distance <= within)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
  const far = geo.units === 'm' ? 20 : 10
  return { area, doors: nearest(geo.doors, 2, far), things: nearest(geo.things, 2, far / 4) }
}

const round = (n: number) => Math.round(n * 10) / 10
const name = (geo: PointGeometry, id: string) => geo.label(id) ?? id

/**
 * The note added to an assistant request when the venue has points: each point's position,
 * area and nearest doors and objects, by real ID, so "point A" can become real operations.
 */
export function pointsNote(points: readonly MapPoint[], geo: PointGeometry): string {
  if (points.length === 0) return ''
  const unit = geo.units === 'm' ? ' m' : ''
  const areaName = (id: string) => `${name(geo, id)} (area ${id}${geo.tags(id).includes('outside') ? ', outside' : ''})`
  const lines = points.map((point) => {
    const { area, doors, things } = describePoint(point, geo)
    const parts = [`- Point ${point.id} at (${round(point.x)}, ${round(point.y)})${unit}, ${area ? `in ${areaName(area.id)}` : 'not on any area’s floor'}.`]
    if (doors.length > 0) {
      parts.push(`Nearest doors: ${doors.map(({ item, distance }) => {
        const [a, b] = item.connects
        const side = area?.id === a ? `; the point is on the ${name(geo, a)} side, the other side is ${areaName(b)}`
          : area?.id === b ? `; the point is on the ${name(geo, b)} side, the other side is ${areaName(a)}` : ''
        return `${name(geo, item.id)} (door ${item.id}, ${round(distance)}${unit} away, joins ${areaName(a)} and ${areaName(b)}${side})`
      }).join('; ')}.`)
    }
    if (things.length > 0) parts.push(`Next to: ${things.map(({ item, distance }) => `${name(geo, item.id)} (${item.id}, ${round(distance)}${unit})`).join('; ')}.`)
    parts.push(`To put something here: shape {"kind":"rectangle","x":${round(point.x - 0.5)},"y":${round(point.y - 0.5)},"width":1,"height":1}.`)
    return parts.join(' ')
  })
  return [
    'Points the person marked on the map. They are spots, not entities (never use "A" as an ID).',
    'When something should happen AT a point (a check-in, a stand, a meeting spot), place a new object exactly there with the shape given (a shape, not a placement), even if a similar desk or door is nearby, and send people to it.',
    'When people come in, arrive or come from the door BY a point: (1) spawn them in the area on the other side of that door from where they are going (the outside one, if one side is outside); (2) make their FIRST goal reach that door by its ID, so their route goes through it and no other door; (3) then the rest of their visit. For a natural arrival, spawn them in small groups over time with schedule (for example a group every 10 to 20 seconds) rather than all at once, each group with its own tag (wave1, wave2, …) so its goals never restart the groups already inside.',
    'When people go somewhere AT or BY a point to wait or hang around, use the point\'s area (wander or wait inside it).',
    ...lines,
  ].join('\n')
}
