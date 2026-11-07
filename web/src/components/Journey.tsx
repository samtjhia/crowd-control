import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { buildJourneyGeometry, type JourneyGeometry } from './journeyGeometry'
import { TRAIL_COLOR, trailWidth } from './campusFrame'
import { JourneyContext } from './journeyFlow'


export function Journey({ children }: { children: ReactNode }) {
  const wrapper = useRef<HTMLDivElement>(null)
  const [geometry, setGeometry] = useState<JourneyGeometry | null>(null)
  useLayoutEffect(() => {
    const element = wrapper.current!
    const campus = element.querySelector<HTMLElement>('.campus-scene')!
    const story = element.querySelector<HTMLElement>('.story')!
    const update = () => {
      const bounds = element.getBoundingClientRect()
      const relative = (target: HTMLElement) => { const rect = target.getBoundingClientRect(); return { x: rect.left - bounds.left, y: rect.top - bounds.top, width: rect.width, height: rect.height } }
      setGeometry(buildJourneyGeometry(bounds.width, bounds.height, relative(campus), relative(story)))
    }
    const observer = new ResizeObserver(update)
    for (const target of [element, campus, story]) observer.observe(target)
    update()
    return () => observer.disconnect()
  }, [])
  return <JourneyContext.Provider value={geometry}><div className="journey" ref={wrapper}>
    {geometry && <svg className="journey-trail" viewBox={`0 0 ${geometry.width} ${geometry.height}`} aria-hidden="true"><path d={geometry.path} fill="none" stroke={TRAIL_COLOR} strokeWidth={trailWidth(geometry.width)} strokeLinecap="butt" /></svg>}
    {children}
  </div></JourneyContext.Provider>
}
