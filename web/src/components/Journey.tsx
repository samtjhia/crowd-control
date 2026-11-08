import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { buildJourneyGeometry, type JourneyGeometry } from './journeyGeometry'
import { CAMPUS_COURTYARD, TRAIL_COLOR, projectCampusPoint, trailWidth } from './campusFrame'
import { RoadmapProgress } from './RoadmapProgress'
import { JourneyContext } from './journeyFlow'
import { PlazaLandscape, type StorySite } from './PlazaLandscape'


export function Journey({ children, reduced }: { children: ReactNode; reduced: boolean }) {
  const wrapper = useRef<HTMLDivElement>(null)
  const curbMask = useId().replace(/:/g, '')
  const [sites, setSites] = useState<StorySite[]>([])
  const [geometry, setGeometry] = useState<JourneyGeometry | null>(null)
  useLayoutEffect(() => {
    const element = wrapper.current!
    const campus = element.querySelector<HTMLElement>('.campus-scene')!
    const story = element.querySelector<HTMLElement>('.story')!
    const handoff = element.querySelector<HTMLElement>('.crowd-handoff')!
    const buildings = [...element.querySelectorAll<HTMLElement>('.story-building')]
    const update = () => {
      const bounds = element.getBoundingClientRect()
      const relative = (target: HTMLElement) => { const rect = target.getBoundingClientRect(); return { x: rect.left - bounds.left, y: rect.top - bounds.top, width: rect.width, height: rect.height } }
      setSites(buildings.map(building => { const content = building.closest('.story-stop')?.querySelector<HTMLElement>('.embedded-copy'); return { ...relative(building), content: content ? relative(content) : undefined } }))
      setGeometry(buildJourneyGeometry(bounds.width, bounds.height, relative(campus), relative(story), relative(handoff)))
    }
    const observer = new ResizeObserver(update)
    for (const target of [element, campus, story, handoff]) observer.observe(target)
    for (const building of buildings) { observer.observe(building); const content = building.closest('.story-stop')?.querySelector<HTMLElement>('.embedded-copy'); if (content) observer.observe(content) }
    update()
    return () => observer.disconnect()
  }, [])
  return <JourneyContext.Provider value={geometry}><div className="journey" ref={wrapper}>
    {geometry && sites.length > 0 && <svg className="journey-ground" viewBox={`0 0 ${geometry.width} ${geometry.height}`} aria-hidden="true"><PlazaLandscape geometry={geometry} sites={sites} /></svg>}
    {geometry && <svg className="journey-trail" viewBox={`0 0 ${geometry.width} ${geometry.height}`} aria-hidden="true">
      <defs><mask id={curbMask} maskUnits="userSpaceOnUse" x="0" y="0" width={geometry.width} height={geometry.height}>
        <rect width={geometry.width} height={geometry.height} fill="white" />
        <polygon points={CAMPUS_COURTYARD.map(([x, y]) => { const point = projectCampusPoint(geometry.campus, x, y); return `${point.x},${point.y}` }).join(' ')} fill="black" />
      </mask></defs>
      <path className="route-curb" d={geometry.path} fill="none" stroke="#dce6cd" strokeWidth={trailWidth(geometry.width) + 5} strokeLinecap="butt" mask={`url(#${curbMask})`} />
      <circle className="route-entry-blend" cx={geometry.curves[0].start.x} cy={geometry.curves[0].start.y} r={trailWidth(geometry.width) / 2} fill={TRAIL_COLOR} />
      <path className="main-crowd-route" d={geometry.path} fill="none" stroke={TRAIL_COLOR} strokeWidth={trailWidth(geometry.width)} strokeLinecap="butt" />

    </svg>}
    {geometry && sites.length === 3 && <RoadmapProgress geometry={geometry} sites={sites} reduced={reduced} />}
    {children}
  </div></JourneyContext.Provider>
}
