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
    const buildings = [...element.querySelectorAll<HTMLElement>('.story-building')]
    const update = () => {
      const bounds = element.getBoundingClientRect()
      const relative = (target: HTMLElement) => { const rect = target.getBoundingClientRect(); return { x: rect.left - bounds.left, y: rect.top - bounds.top, width: rect.width, height: rect.height } }
      setSites(buildings.map(relative))
      setGeometry(buildJourneyGeometry(bounds.width, bounds.height, relative(campus), relative(story)))
    }
    const observer = new ResizeObserver(update)
    for (const target of [element, campus, story]) observer.observe(target)
    for (const building of buildings) observer.observe(building)
    update()
    return () => observer.disconnect()
  }, [])
  return <JourneyContext.Provider value={geometry}><div className="journey" ref={wrapper}>
    {geometry && sites.length > 0 && <svg className="journey-ground" viewBox={`0 0 ${geometry.width} ${geometry.height}`} aria-hidden="true"><PlazaLandscape geometry={geometry} sites={sites} /></svg>}
    {geometry && <svg className="journey-trail" viewBox={`0 0 ${geometry.width} ${geometry.height}`} aria-hidden="true"><path d={geometry.path} fill="none" stroke={TRAIL_COLOR} strokeWidth={trailWidth(geometry.width)} strokeLinecap="butt" /></svg>}
    {children}
  </div></JourneyContext.Provider>
}
