import { useEffect, useMemo, useRef, useState, type MouseEvent, type CSSProperties } from 'react'
import { journeyPoint, type JourneyGeometry } from './journeyGeometry'
import { trailWidth } from './campusFrame'
import type { StorySite } from './PlazaLandscape'

const stops = [
  { id: 'plaza-title', name: 'Observe', color: '#4e7852' },
  { id: 'operations-title', name: 'Experiment', color: '#597dab' },
  { id: 'garden-title', name: 'Prepare', color: '#8f515c' },
]

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

function edgePoint(geometry: JourneyGeometry, distance: number) {
  const p = journeyPoint(geometry, distance)
  const before = journeyPoint(geometry, Math.max(0, distance - 3))
  const after = journeyPoint(geometry, Math.min(geometry.length, distance + 3))
  const dx = after.x - before.x, dy = after.y - before.y
  const length = Math.hypot(dx, dy) || 1
  const offset = trailWidth(geometry.width) / 2 - 9
  return { x: p.x + dy / length * offset, y: p.y - dx / length * offset, angle: Math.atan2(dy, dx) * 180 / Math.PI + 90 }
}

export function RoadmapProgress({ geometry, sites, reduced }: { geometry: JourneyGeometry; sites: StorySite[]; reduced: boolean }) {
  const trace = useRef<SVGPathElement>(null)
  const runner = useRef<SVGGElement>(null)
  const layer = useRef<SVGSVGElement>(null)
  const [active, setActive] = useState(0)
  const edgePath = useMemo(() => geometry.distances.map((distance, index) => {
    const p = edgePoint(geometry, distance)
    return `${index ? 'L' : 'M'}${p.x} ${p.y}`
  }).join(' '), [geometry])
  const milestones = sites.map((site, index) => {
    const distance = distanceAtY(geometry, site.y + site.height * .905)
    const point = journeyPoint(geometry, distance)
    const side = index === 1 && geometry.width >= 700 ? -1 : 1
    const x = Math.max(23, Math.min(geometry.width - 23, point.x + side * (trailWidth(geometry.width) / 2 + 28)))
    return { ...stops[index], distance, x, y: point.y }
  })

  useEffect(() => {
    const root = layer.current?.closest('.journey')
    if (!root || !trace.current || !runner.current) return
    let frame = 0, previous = 0, distance = 0, target = 0
    let disposed = false
    const draw = () => {
      const p = edgePoint(geometry, distance)
      trace.current?.setAttribute('stroke-dasharray', `${reduced ? geometry.length : distance} ${geometry.length + 1}`)
      runner.current?.setAttribute('transform', `translate(${p.x} ${p.y}) rotate(${p.angle})`)
    }
    const tick = (now: number) => {
      frame = 0
      if (disposed || document.hidden) return
      const dt = previous ? Math.min(now - previous, 50) : 16
      previous = now
      distance += (target - distance) * (1 - Math.exp(-dt / 80))
      if (Math.abs(target - distance) < .2) distance = target
      draw()
      if (!reduced && distance !== target) frame = requestAnimationFrame(tick)
      else previous = 0
    }
    const update = () => {
      if (disposed || document.hidden) return
      const bounds = root.getBoundingClientRect()
      const y = window.innerHeight * .56 - bounds.top
      let stage = 0
      sites.forEach((site, index) => { if (y >= site.y - 45) stage = index })
      setActive(current => current === stage ? current : stage)
      target = distanceAtY(geometry, y)
      if (reduced) { distance = target; draw(); return }
      if (bounds.bottom < 0 || bounds.top > window.innerHeight) {
        distance = target; draw()
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
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [geometry, sites, reduced])

  const visit = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    const heading = document.getElementById(id)
    const section = heading?.closest('.story-stop')
    if (!heading || !section) return
    event.preventDefault()
    heading.setAttribute('tabindex', '-1')
    heading.focus({ preventScroll: true })
    section.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'center' })
  }
  return <>
    <svg ref={layer} className="roadmap-progress" viewBox={`0 0 ${geometry.width} ${geometry.height}`} aria-hidden="true" style={{ color: stops[active].color }}>
      <path className="roadmap-trace-track" d={edgePath} fill="none" />
      <path ref={trace} className="roadmap-trace" d={edgePath} pathLength={geometry.length} strokeDasharray={`0 ${geometry.length + 1}`} fill="none" />
      <g ref={runner} className="roadmap-runner"><path d="m0-7 5 11-5-3-5 3Z" fill="currentColor" stroke="#fcf2e5" strokeWidth="2" strokeLinejoin="round" /></g>
    </svg>
    <nav className="roadmap-waypoints" aria-label="Roadmap stops">
      {milestones.map((stop, index) => <a key={stop.id} className="roadmap-waypoint" href={`#${stop.id}`} onClick={event => visit(event, stop.id)} aria-label={`${index + 1}. ${stop.name}: go to this section`} aria-current={active === index ? 'step' : undefined} data-state={active === index ? 'current' : index < active ? 'visited' : 'upcoming'} style={{ left: stop.x, top: stop.y, '--waypoint-color': stop.color } as CSSProperties}>
        <span className="roadmap-waypoint-number">0{index + 1}</span><span className="roadmap-waypoint-name">{stop.name}</span>
      </a>)}
    </nav>
  </>
}
