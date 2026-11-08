import { useEffect, useRef, useState, type MouseEvent, type CSSProperties } from 'react'
import { journeyPoint, type JourneyGeometry } from './journeyGeometry'
import { trailWidth } from './campusFrame'
import type { StorySite } from './PlazaLandscape'
import { RoadmapCyclist, type CyclistHandle } from './RoadmapCyclist'
import { CYCLIST_SCALE, cyclistPoint, setCyclistDistance } from './journeyLanes'

const stops = [
  { id: 'plaza-title', name: 'Observe', color: '#4e7852' },
  { id: 'operations-title', name: 'Experiment', color: '#466c96' },
  { id: 'garden-title', name: 'Prepare', color: '#8f515c' },
]
const TRAIL_MARKS = 18

function distanceAtY(geometry: JourneyGeometry, y: number) {
  let low = 0, high = geometry.points.length - 1
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (geometry.points[mid].y < y) low = mid + 1
    else high = mid
  }
  if (low === 0) return 0
  const a = geometry.points[low - 1], b = geometry.points[low]
  const amount = Math.max(0, Math.min(1, (y - a.y) / (b.y - a.y || 1)))
  return geometry.distances[low - 1] + (geometry.distances[low] - geometry.distances[low - 1]) * amount
}

function roadHeading(geometry: JourneyGeometry, distance: number) {
  const before = journeyPoint(geometry, Math.max(0, distance - 4))
  const after = journeyPoint(geometry, Math.min(geometry.length, distance + 4))
  return Math.atan2(after.y - before.y, after.x - before.x)
}

export function RoadmapProgress({ geometry, sites, reduced }: { geometry: JourneyGeometry; sites: StorySite[]; reduced: boolean }) {
  const layer = useRef<SVGSVGElement>(null)
  const riderPosition = useRef<SVGGElement>(null)
  const cyclist = useRef<CyclistHandle>(null)
  const marks = useRef<(SVGEllipseElement | null)[]>([])
  const [active, setActive] = useState(0)
  const milestones = sites.map((site, index) => {
    const distance = distanceAtY(geometry, site.y + site.height * .905)
    const point = journeyPoint(geometry, distance)
    const side = index === 1 && geometry.width >= 700 ? -1 : 1
    const x = Math.max(23, Math.min(geometry.width - 23, point.x + side * (trailWidth(geometry.width) / 2 + 28)))
    return { ...stops[index], distance, x, y: point.y }
  })

  useEffect(() => {
    const root = layer.current?.closest('.journey')
    if (!root || !riderPosition.current || !cyclist.current) return
    let frame = 0, previous = 0, distance = 0, target = 0, pedal = 0, heading = 0
    let direction = 1, markDistance = 0, markIndex = 0
    let disposed = false, initialized = false, stage = 0
    const dust: { distance: number; born: number }[] = []
    const scale = CYCLIST_SCALE
    const paint = (now: number) => {
      const point = cyclistPoint(geometry, distance)
      const entrance = Math.min(1, Math.max(0, (point.y - geometry.story.y - 26) / 35))
      const opacity = entrance * Math.min(1, Math.max(0, (geometry.length - distance) / 32))
      setCyclistDistance(geometry, opacity > 0 ? distance : undefined)
      riderPosition.current?.setAttribute('transform', `translate(${point.x} ${point.y}) scale(${scale})`)
      riderPosition.current?.setAttribute('opacity', String(opacity))
      riderPosition.current?.setAttribute('data-distance', String(distance))
      riderPosition.current?.setAttribute('data-heading', String(heading))
      cyclist.current?.pose(heading, pedal)
      let hasTrail = false
      for (let i = 0; i < TRAIL_MARKS; i++) {
        const mark = dust[i], element = marks.current[i]
        if (!element) continue
        const age = mark ? (now - mark.born) / 1100 : 1
        if (reduced || !mark || age >= 1) { element.setAttribute('opacity', '0'); continue }
        hasTrail = true
        const p = cyclistPoint(geometry, mark.distance)
        const angle = roadHeading(geometry, mark.distance) * 180 / Math.PI
        element.setAttribute('transform', `translate(${p.x} ${p.y}) rotate(${angle})`)
        element.setAttribute('opacity', String(.48 * (1 - age) ** 1.4))
      }
      return hasTrail
    }
    const tick = (now: number) => {
      frame = 0
      if (disposed || document.hidden) return
      const dt = previous ? Math.min(now - previous, 50) : 16
      previous = now
      const before = distance
      if (Math.abs(target - distance) > .2) direction = target > distance ? 1 : -1
      distance += (target - distance) * (1 - Math.exp(-dt / 75))
      if (Math.abs(target - distance) < .2) distance = target
      const movement = Math.abs(distance - before)
      pedal += movement / 6.5
      const desiredHeading = roadHeading(geometry, distance) + (direction === -1 ? Math.PI : 0)
      const turn = Math.atan2(Math.sin(desiredHeading - heading), Math.cos(desiredHeading - heading))
      heading = Math.abs(turn) < .002 ? desiredHeading : heading + turn * (1 - Math.exp(-dt / 65))
      // A bounded, short-lived set of tyre marks records actual movement. No
      // full-road path survives, and reversing does not teleport a drawn line.
      if (movement > .05 && Math.abs(distance - markDistance) >= 5) {
        const steps = Math.min(4, Math.ceil(Math.abs(distance - markDistance) / 5))
        for (let i = 1; i <= steps; i++) {
          const sampled = markDistance + (distance - markDistance) * i / steps - direction * 12 * scale
          dust[markIndex] = { distance: Math.max(0, Math.min(geometry.length, sampled)), born: now }
          markIndex = (markIndex + 1) % TRAIL_MARKS
        }
        markDistance = distance
      }
      const trailVisible = paint(now)
      if (distance !== target || Math.abs(turn) > .002 || trailVisible) frame = requestAnimationFrame(tick)
      else previous = 0
    }
    const update = () => {
      if (disposed || document.hidden) return
      const bounds = root.getBoundingClientRect()
      const y = window.innerHeight * .56 - bounds.top
      stage = 0
      sites.forEach((site, index) => { if (y >= site.y - 45) stage = index })
      setActive(current => current === stage ? current : stage)
      target = distanceAtY(geometry, y)
      if (reduced) {
        distance = distanceAtY(geometry, sites[stage].y + sites[stage].height * .905)
        heading = roadHeading(geometry, distance); paint(performance.now())
        return
      }
      if (!initialized || bounds.bottom < 0 || bounds.top > window.innerHeight) {
        distance = target; markDistance = distance; initialized = true
        heading = roadHeading(geometry, distance) + (direction === -1 ? Math.PI : 0)
        dust.length = 0; paint(performance.now())
        if (frame) cancelAnimationFrame(frame)
        frame = 0; previous = 0
        return
      }
      if (!frame) frame = requestAnimationFrame(tick)
    }
    const onVisibility = () => {
      if (document.hidden) { cancelAnimationFrame(frame); frame = 0; previous = 0 }
      else update()
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disposed = true; cancelAnimationFrame(frame)
      setCyclistDistance(geometry)
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [geometry, sites, reduced])

  const visit = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    const heading = document.getElementById(id)
    const section = heading?.closest('.story-stop')
    if (!heading || !section) return
    event.preventDefault()
    heading.setAttribute('tabindex', '-1')
    heading.focus({ preventScroll: true })
    section.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'center' })
  }
  return <>
    <svg className="roadmap-cycle-trail" viewBox={`0 0 ${geometry.width} ${geometry.height}`} aria-hidden="true">
      {Array.from({ length: TRAIL_MARKS }, (_, index) => <ellipse key={index} ref={element => { marks.current[index] = element }} className="cyclist-trail-mark" rx="2.1" ry=".9" fill="#a78c65" opacity="0" />)}
    </svg>
    <svg ref={layer} className="roadmap-rider-layer" viewBox={`0 0 ${geometry.width} ${geometry.height}`} aria-hidden="true">
      <g ref={riderPosition} className="roadmap-rider-position" opacity="0"><RoadmapCyclist ref={cyclist} /></g>
    </svg>
    <nav className="roadmap-waypoints" aria-label="Roadmap stops">
      {milestones.map((stop, index) => <a key={stop.id} className="roadmap-waypoint" href={`#${stop.id}`} onClick={event => visit(event, stop.id)} aria-label={`${index + 1}. ${stop.name}: go to this section`} aria-current={active === index ? 'step' : undefined} data-state={active === index ? 'current' : index < active ? 'visited' : 'upcoming'} style={{ left: stop.x, top: stop.y, '--waypoint-color': stop.color } as CSSProperties}>
        <span className="roadmap-waypoint-number">0{index + 1}</span><span className="roadmap-waypoint-name">{stop.name}</span>
      </a>)}
    </nav>
  </>
}
