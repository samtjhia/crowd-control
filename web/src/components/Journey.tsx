import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { buildJourneyGeometry, type JourneyGeometry } from './journeyGeometry'
import { TRAIL_COLOR, trailWidth } from './campusFrame'
import { JourneyContext } from './journeyFlow'
import { PlazaLandscape, type StorySite } from './PlazaLandscape'


export function Journey({ children }: { children: ReactNode }) {
  const wrapper = useRef<HTMLDivElement>(null)
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
    {geometry && <svg className="journey-trail" viewBox={`0 0 ${geometry.width} ${geometry.height}`} aria-hidden="true"><path className="route-curb" d={geometry.path} fill="none" stroke="#dce6cd" strokeWidth={trailWidth(geometry.width) + 5} strokeLinecap="butt" /><path className="main-crowd-route" d={geometry.path} fill="none" stroke={TRAIL_COLOR} strokeWidth={trailWidth(geometry.width)} strokeLinecap="butt" /><path d={`M${geometry.handoff ? geometry.handoff.x + geometry.handoff.width / 2 - trailWidth(geometry.width) / 2 : 0} ${geometry.handoff ? geometry.handoff.y + 55 : 0}h${trailWidth(geometry.width)}`} stroke="#d8d0bb" strokeWidth="5" /></svg>}
    {children}
  </div></JourneyContext.Provider>
}
