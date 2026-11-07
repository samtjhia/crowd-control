// Coordinates are in the campus artwork's original 1536 × 1024 space.
type Point = { x: number; y: number }
type Route = { points: Point[]; normals: Point[]; distances: number[]; length: number; courtyard: boolean; portal?: Point }
export type CampusPerson = Point & { i: number; group: number; walking: boolean; size: number; pace: number; opacity: number }

const walkway = [
  { x: 210, y: 900 }, { x: 285, y: 876 }, { x: 370, y: 863 },
  { x: 445, y: 844 }, { x: 488, y: 815 }, { x: 502, y: 767 },
  { x: 520, y: 725 }, { x: 580, y: 692 }, { x: 660, y: 670 },
  { x: 740, y: 642 }, { x: 790, y: 610 },
]
// A conservative paved region, inset from the planting and the school facade.
const forecourt = [
  { x: 530, y: 735 }, { x: 640, y: 692 }, { x: 735, y: 700 },
  { x: 770, y: 755 }, { x: 855, y: 810 }, { x: 790, y: 855 },
  { x: 680, y: 865 }, { x: 560, y: 825 }, { x: 515, y: 780 },
]
const gardenPath = [
  { x: 740, y: 642 }, { x: 790, y: 610 }, { x: 812, y: 580 },
  { x: 812, y: 550 }, { x: 812, y: 530 }, { x: 822, y: 515 },
  { x: 845, y: 502 }, { x: 880, y: 490 }, { x: 920, y: 482 },
  { x: 960, y: 475 }, { x: 995, y: 466 }, { x: 1012, y: 450 },
]
const entrancePath = [{ x: 660, y: 790 }, { x: 740, y: 775 }, { x: 795, y: 748 }, { x: 839, y: 727 }, { x: 873, y: 711 }]
// Only the flat amphitheatre floor is walkable. The curved risers are vertical
// surfaces in this camera and cannot be treated as one flat navigation polygon.
const seating = [
  { x: 378, y: 686 }, { x: 399, y: 672 }, { x: 431, y: 669 },
  { x: 464, y: 676 }, { x: 480, y: 690 }, { x: 462, y: 706 },
  { x: 420, y: 710 }, { x: 389, y: 699 },
]

function random(seed: number) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return value - Math.floor(value)
}
function smoothLoop(vertices: Point[]) {
  let points = vertices
  // Corner cutting stays inside the control polygon, unlike an overshooting spline.
  for (let pass = 0; pass < 3; pass++) {
    points = points.flatMap((p, i) => {
      const next = points[(i + 1) % points.length]
      return [{ x: p.x * .75 + next.x * .25, y: p.y * .75 + next.y * .25 }, { x: p.x * .25 + next.x * .75, y: p.y * .25 + next.y * .75 }]
    })
  }
  return [...points, points[0]]
}
function makeRoute(points: Point[], courtyard: boolean, portal?: Point): Route {
  const distances = [0]
  for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y))
  const count = points.length - 1
  const normals = points.map((_, i) => {
    const index = i % count
    const before = points[(index + count - 1) % count]; const after = points[(index + 1) % count]
    const dx = after.x - before.x; const dy = after.y - before.y; const size = Math.hypot(dx, dy) || 1
    return { x: -dy / size, y: dx / size }
  })
  return { points, normals, distances, length: distances[distances.length - 1], courtyard, portal }
}
function walkwayLane(side: number, path = walkway) {
  return path.map((point, i) => {
    const before = path[Math.max(0, i - 1)]; const after = path[Math.min(path.length - 1, i + 1)]
    const dx = after.x - before.x; const dy = after.y - before.y; const length = Math.hypot(dx, dy)
    return { x: point.x - dy / length * side, y: point.y + dx / length * side }
  })
}
const routes = [
  makeRoute(smoothLoop([...walkwayLane(4), ...walkwayLane(-4).reverse()]), false),
  makeRoute(smoothLoop([{ x: 550, y: 750 }, { x: 645, y: 715 }, { x: 730, y: 735 }, { x: 815, y: 805 }, { x: 735, y: 840 }, { x: 600, y: 805 }]), true),
  makeRoute(smoothLoop([{ x: 570, y: 760 }, { x: 685, y: 725 }, { x: 750, y: 775 }, { x: 700, y: 835 }, { x: 565, y: 795 }]), true),
  makeRoute(smoothLoop([{ x: 620, y: 730 }, { x: 720, y: 720 }, { x: 760, y: 785 }, { x: 825, y: 815 }, { x: 690, y: 840 }, { x: 585, y: 785 }]), true),
  makeRoute(smoothLoop([{ x: 550, y: 770 }, { x: 625, y: 745 }, { x: 735, y: 790 }, { x: 775, y: 835 }, { x: 640, y: 825 }]), true),
  makeRoute(smoothLoop([{ x: 550, y: 790 }, { x: 630, y: 735 }, { x: 750, y: 755 }, { x: 830, y: 810 }, { x: 780, y: 845 }, { x: 675, y: 848 }, { x: 575, y: 818 }]), true),
  // Short strolls stay on the landing, below the curved step faces.
  makeRoute(smoothLoop([{ x: 390, y: 687 }, { x: 415, y: 678 }, { x: 450, y: 681 }, { x: 466, y: 693 }, { x: 438, y: 702 }, { x: 403, y: 697 }]), false),
  makeRoute(smoothLoop([{ x: 397, y: 692 }, { x: 420, y: 683 }, { x: 450, y: 685 }, { x: 455, y: 696 }, { x: 428, y: 702 }]), false),
  makeRoute(smoothLoop([...walkwayLane(2.5, gardenPath), ...walkwayLane(-2.5, gardenPath).reverse()]), false),
  // Fade at the doorway, then emerge again: never draw people over the facade.
  makeRoute(smoothLoop([...walkwayLane(2.5, entrancePath), ...walkwayLane(-2.5, entrancePath).reverse()]), false, { x: 873, y: 711 }),

]
function atDistance(route: Route, distance: number) {
  const d = Math.max(0, Math.min(route.length - .0001, distance))
  let segment = 1
  while (segment < route.distances.length - 1 && route.distances[segment] < d) segment++
  const start = route.points[segment - 1]; const end = route.points[segment]
  const length = route.distances[segment] - route.distances[segment - 1]
  const t = length ? (d - route.distances[segment - 1]) / length : 0
  const n0 = route.normals[segment - 1]; const n1 = route.normals[segment]
  const nx = n0.x + (n1.x - n0.x) * t; const ny = n0.y + (n1.y - n0.y) * t
  const magnitude = Math.hypot(nx, ny) || 1
  return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t, nx: nx / magnitude, ny: ny / magnitude }
}
function insidePolygon(point: Point, polygon: Point[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]; const b = polygon[j]
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
function distanceToSegment(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x; const dy = b.y - a.y
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy)
}
export function onCampusPavement(point: Point) {
  return insidePolygon(point, forecourt) || insidePolygon(point, seating)
    || walkway.slice(1).some((p, i) => distanceToSegment(point, walkway[i], p) <= 12)
    || gardenPath.slice(1).some((p, i) => distanceToSegment(point, gardenPath[i], p) <= 9)
    || entrancePath.slice(1).some((p, i) => distanceToSegment(point, entrancePath[i], p) <= 10)
}
function easedDistance(t: number) {
  const edge = .08
  if (t < edge) return t * t / (2 * edge * (1 - edge))
  if (t > 1 - edge) return 1 - (1 - t) ** 2 / (2 * edge * (1 - edge))
  return (t - edge / 2) / (1 - edge)
}

export function campusPeopleAt(time: number): CampusPerson[] {
  const people = Array.from({ length: 100 }, (_, i) => {
    // Some pairs share a destination and pace; others walk independently.
    const paired = i >= 56 && i < 80
    const group = paired ? 100 + Math.floor((i - 56) / 2) : i
    const routeIndex = i < 16 ? 0
      : i < 28 ? 6 + i % 2
      : i < 44 ? 8
      : i < 56 ? 9
      : 1 + Math.floor(random(group + 4) * 5)
    const route = routes[routeIndex]
    const speed = 10 + random(group + 9) * 9
    const duration = route.length / speed
    const stop = route.courtyard ? 1.5 + random(group + 16) * 5 : 1 + random(group + 16) * 2
    const cycle = duration + stop
    const local = (time + random(group + 22) * cycle) % cycle
    const phase = Math.min(1, local / duration)
    const position = atDistance(route, (easedDistance(phase) * route.length + random(group + 33) * route.length) % route.length)
    const side = paired ? (i % 2 ? 4.5 : -4.5) : (random(i + 48) - .5) * (route.courtyard ? 15 : 2)
    const drift = Math.sin(time * .5 + group) * (route.courtyard ? 1.6 : .3)
    const candidate = { x: position.x + position.nx * (side + drift), y: position.y + position.ny * (side + drift) }
    // Taper an offset at the boundary rather than snapping back to the centerline.
    let amount = 1
    while (amount > .01 && !onCampusPavement({ x: position.x + (candidate.x - position.x) * amount, y: position.y + (candidate.y - position.y) * amount })) amount *= .8
    const point = { x: position.x + (candidate.x - position.x) * amount, y: position.y + (candidate.y - position.y) * amount }
    return { x: point.x, y: point.y, i, group, walking: local < duration && phase > .003 && phase < .997, size: .84 + random(i + 71) * .19, pace: speed / 14, opacity: route.portal ? Math.max(0, Math.min(1, (Math.hypot(point.x - route.portal.x, point.y - route.portal.y) - 6) / 22)) : 1 }
  })
  // Soft, bounded spacing uses the unmodified positions for every neighbor.
  // This avoids the abrupt side-switching produced by sequential repulsion.
  return people.map(person => {
    let x = 0; let y = 0
    for (const neighbor of people) {
      if (person.i === neighbor.i || person.group === neighbor.group) continue
      const dx = person.x - neighbor.x; const dy = person.y - neighbor.y
      const distance = Math.hypot(dx, dy)
      if (distance >= 9) continue
      const strength = (9 - distance) * .12 / Math.sqrt(distance * distance + 16)
      x += dx * strength; y += dy * strength
    }
    const limit = Math.max(1, Math.hypot(x, y) / 2.5)
    const adjusted = { x: person.x + x / limit, y: person.y + y / limit }
    return onCampusPavement(adjusted) ? { ...person, ...adjusted } : person
  }).sort((a, b) => a.y - b.y)
}
