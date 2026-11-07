import type { CompiledMap, EntityBlueprint, MapAppearance, Shape } from '@crowd-control/contract'

/** Map defaults, re-themed from Technical PRD §12 (which calls them replaceable UI defaults) to the landing page's paper-and-sage palette. */
/** Point-of-interest badges: blue for things people use, red for dangers. */
export const BADGE_COLORS = { service: '#2F6FEB', hazard: '#DC2626' } as const

export const COLORS = {
  floor: '#FAFBF6',
  wall: '#7F9479',
  portalOpen: '#B9D6AE',
  portalClosed: '#BB6479',
  obstacle: '#A4B59C',
  object: '#E6EADC',
  outline: '#263C2E',
  label: '#587361',
} as const

export type CellRun = {
  row: number
  start: number
  /** Exclusive end column. */
  end: number
  kind: 'floor' | 'wall' | 'portal'
  fill: string
  opacity: number
  portalId: string | null
}

export type PortalDrawing = {
  id: string; x: number; y: number; width: number; height: number
  open: boolean; fill: string; opacity: number
}

export type EntityDrawing = {
  id: string; kind: EntityBlueprint['kind']; shape: Shape
  fill: string | null; stroke: string | null; strokeWidthPx: number; opacity: number
}

/**
 * A small marker on a point of interest, so people can see what is clickable and what kind of
 * place it is: `service` for things people use (tables, counters, check-in desks), `hazard`
 * for dangers. Placed at the top-right corner of the thing, in world units.
 */
export type Badge = { id: string; kind: 'service' | 'hazard'; x: number; y: number }

/** A label at the top-left of the region it names; width/height bound where it may be drawn. */
export type MapLabel = { text: string; x: number; y: number; width: number; height: number }

export type MapLayout = {
  columns: number
  rows: number
  cellSize: number
  /** World extent in map units (columns × cellSize). */
  worldWidth: number
  worldHeight: number
  runs: CellRun[]
  portals: PortalDrawing[]
  entities: EntityDrawing[]
  labels: MapLabel[]
  badges: Badge[]
}

type CellStyle = Omit<CellRun, 'row' | 'start' | 'end'>

/**
 * Converts a compiled map into drawable primitives in world units. Columns and rows come
 * from the rasterized grid itself, so this works whether `width` counts cells or units.
 */
export function layoutMap(map: CompiledMap): MapLayout {
  const appearanceById = new Map<string, MapAppearance | undefined>()
  for (const room of map.rooms) appearanceById.set(room.id, room.appearance)
  for (const entity of map.entities ?? []) if (entity.kind === 'zone') appearanceById.set(entity.id, entity.appearance)
  const portalIds = new Set([...map.portals.map((p) => p.id), ...(map.entities ?? []).filter((e) => e.kind === 'portal').map((e) => e.id)])

  const floorFor = (zoneId: string | null): CellStyle => {
    const appearance = zoneId ? appearanceById.get(zoneId) : undefined
    return { kind: 'floor', fill: appearance?.fill ?? COLORS.floor, opacity: appearance?.opacity ?? 1, portalId: null }
  }
  const wall: CellStyle = { kind: 'wall', fill: COLORS.wall, opacity: 1, portalId: null }

  let columns: number
  let rows: number
  let cellAt: (column: number, row: number) => CellStyle
  if ('grid' in map && map.grid) {
    const { grid } = map
    columns = grid.width
    rows = grid.height
    cellAt = (column, row) => {
      const i = row * grid.width + column
      if (grid.blocked[i] === 1) return wall
      const portalId = grid.portalIds[grid.portalIndex[i]!] ?? null
      // Portals with their own rectangle are drawn in the portal layer; grid-only portals are drawn as cells.
      if (portalId && !map.portals.some((p) => p.id === portalId)) return { kind: 'portal', fill: COLORS.portalOpen, opacity: 1, portalId }
      return floorFor(grid.zoneIds[grid.zoneIndex[i]!] ?? null)
    }
  } else {
    const { rows: glyphRows, legend } = map as Extract<CompiledMap, { rows: string[] }>
    columns = glyphRows[0]?.length ?? 0
    rows = glyphRows.length
    cellAt = (column, row) => {
      const glyph = glyphRows[row]![column]!
      if (glyph === '#') return wall
      const id = Object.hasOwn(legend, glyph) ? legend[glyph]! : null
      return floorFor(id && !portalIds.has(id) ? id : null)
    }
  }

  const runs: CellRun[] = []
  for (let row = 0; row < rows; row++) {
    let current: CellRun | null = null
    for (let column = 0; column < columns; column++) {
      const style = cellAt(column, row)
      if (current && current.kind === style.kind && current.fill === style.fill && current.opacity === style.opacity && current.portalId === style.portalId) {
        current.end = column + 1
      } else {
        current = { row, start: column, end: column + 1, ...style }
        runs.push(current)
      }
    }
  }

  const portals: PortalDrawing[] = map.portals.map((portal) => ({
    id: portal.id, x: portal.x, y: portal.y, width: portal.width, height: portal.height, open: portal.open,
    fill: portal.appearance?.fill ?? COLORS.portalOpen, opacity: portal.appearance?.opacity ?? 1,
  }))

  const entities: EntityDrawing[] = []
  const labels: MapLabel[] = []
  const badges: Badge[] = []
  for (const portal of map.portals) {
    if (portal.traversalTime) badges.push({ id: portal.id, kind: 'service', x: portal.x + portal.width, y: portal.y })
  }
  for (const room of map.rooms) {
    if (room.appearance?.labelVisible) labels.push({ text: room.label ?? room.id, x: room.x, y: room.y, width: room.width, height: room.height })
  }
  for (const entity of map.entities ?? []) {
    if (!entity.shape) continue
    const appearance = entity.appearance
    const isZone = entity.kind === 'zone'
    const defaultFill = entity.kind === 'barrier' ? COLORS.obstacle : entity.kind === 'object' ? COLORS.object : null
    entities.push({
      id: entity.id, kind: entity.kind, shape: entity.shape,
      fill: appearance?.fill ?? defaultFill,
      stroke: appearance?.stroke ?? (isZone ? null : COLORS.outline),
      strokeWidthPx: appearance?.strokeWidthPx ?? (isZone ? 0 : 1),
      opacity: appearance?.opacity ?? 1,
    })
    if (appearance?.labelVisible) {
      labels.push({ text: entity.label ?? entity.id, ...shapeBox(entity.shape) })
    }
    if (entity.kind === 'object') {
      const box = shapeBox(entity.shape)
      const hazard = entity.tags?.includes('hazard') ?? false
      if (hazard || entity.components?.interaction || entity.components?.capacity) badges.push({ id: entity.id, kind: hazard ? 'hazard' : 'service', x: box.x + box.width, y: box.y })
    }
  }

  return { columns, rows, cellSize: map.cellSize, worldWidth: columns * map.cellSize, worldHeight: rows * map.cellSize, runs, portals, entities, labels, badges }
}

function shapeBox(shape: Shape): { x: number; y: number; width: number; height: number } {
  switch (shape.kind) {
    case 'rectangle': return { x: shape.x, y: shape.y, width: shape.width, height: shape.height }
    case 'circle': return { x: shape.center.x - shape.radius, y: shape.center.y - shape.radius, width: shape.radius * 2, height: shape.radius * 2 }
    case 'polygon':
    case 'thick_line': {
      const xs = shape.points.map((p) => p.x), ys = shape.points.map((p) => p.y)
      const x = Math.min(...xs), y = Math.min(...ys)
      return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
    }
  }
}
