import { forwardRef, useImperativeHandle, useRef } from 'react'

export type CyclistHandle = { pose: (heading: number, pedal: number) => void }
type Point = { x: number; y: number }
const path = (...points: Point[]) => points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')

/** Wheels and frame follow the ground heading; the rider stays upright rather
 * than rotating a flat illustration sideways around every bend. */
export const RoadmapCyclist = forwardRef<CyclistHandle>(function RoadmapCyclist(_props, ref) {
  const parts = useRef<Record<string, SVGElement | null>>({})
  const part = (name: string) => (element: SVGElement | null) => { parts.current[name] = element }
  useImperativeHandle(ref, () => ({
    pose(heading, pedal) {
      const dx = Math.cos(heading), dy = Math.sin(heading)
      const at = (along: number, height: number): Point => ({ x: dx * along, y: dy * along - height })
      const rear = at(-12, 7), front = at(14, 7), crank = at(1, 10)
      const seat = at(-5, 22), stem = at(10, 22)
      const hip = at(-5, 24), shoulder = at(2, 35), head = at(4, 42)
      const bar = { x: stem.x, y: stem.y - 3 }
      const set = (name: string, attribute: string, value: string | number) => parts.current[name]?.setAttribute(attribute, String(value))
      const wheelWidth = 2.4 + Math.abs(dx) * 4.5
      for (const [name, center] of [['rear', rear], ['front', front]] as const) {
        set(`${name}-wheel`, 'cx', center.x); set(`${name}-wheel`, 'cy', center.y); set(`${name}-wheel`, 'rx', wheelWidth)
        const a = { x: center.x + Math.cos(pedal) * wheelWidth, y: center.y + Math.sin(pedal) * 6.5 }
        const b = { x: center.x - Math.cos(pedal) * wheelWidth, y: center.y - Math.sin(pedal) * 6.5 }
        const c = { x: center.x + Math.sin(pedal) * wheelWidth, y: center.y - Math.cos(pedal) * 6.5 }
        const d = { x: center.x - Math.sin(pedal) * wheelWidth, y: center.y + Math.cos(pedal) * 6.5 }
        set(`${name}-spokes`, 'd', `${path(a, b)} ${path(c, d)}`)
      }
      const footA = { x: crank.x + Math.cos(pedal) * 4, y: crank.y + Math.sin(pedal) * 4 }
      const footB = { x: crank.x - Math.cos(pedal) * 4, y: crank.y - Math.sin(pedal) * 4 }
      const knee = (foot: Point, side: number) => ({ x: (hip.x + foot.x) / 2 + dx * 5 + side, y: (hip.y + foot.y) / 2 - 2 })
      set('back-leg', 'd', path(hip, knee(footB, -1.5), footB))
      set('frame', 'd', `${path(rear, seat, crank, rear)} ${path(crank, stem, seat)} ${path(front, stem)}`)
      set('saddle', 'd', path({ x: seat.x - 4, y: seat.y - 1 }, { x: seat.x + 4, y: seat.y - 1 }))
      set('handlebar', 'd', path({ x: bar.x - dy * 4, y: bar.y + dx * 2 }, { x: bar.x + dy * 4, y: bar.y - dx * 2 }))
      set('torso', 'd', path(hip, shoulder))
      set('front-leg', 'd', path(hip, knee(footA, 1.5), footA))
      set('arm', 'd', path(shoulder, { x: (shoulder.x + bar.x) / 2 + 2, y: (shoulder.y + bar.y) / 2 + 1 }, bar))
      set('head', 'transform', `translate(${head.x} ${head.y})`)
      set('you', 'x', head.x); set('you', 'y', head.y - 10)
    },
  }), [])
  return <g className="roadmap-cyclist" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="1" cy="2" rx="10" ry="3.2" fill="#4c6146" opacity=".14" />
    <g fill="#faf3e5" stroke="#536052" strokeWidth="1.6">
      <ellipse ref={part('rear-wheel')} ry="6.5" /><ellipse ref={part('front-wheel')} ry="6.5" />
    </g>
    <g stroke="#9ca68b" strokeWidth=".8" fill="none"><path ref={part('rear-spokes')} /><path ref={part('front-spokes')} /></g>
    <path ref={part('back-leg')} fill="none" stroke="#425e65" strokeWidth="2.8" />
    <path ref={part('frame')} fill="none" stroke="#95525d" strokeWidth="2" />
    <path ref={part('saddle')} fill="none" stroke="#6b5143" strokeWidth="2.6" />
    <path ref={part('handlebar')} fill="none" stroke="#485d50" strokeWidth="2.1" />
    <path ref={part('torso')} fill="none" stroke="#994e5d" strokeWidth="6.3" />
    <path ref={part('front-leg')} fill="none" stroke="#4c6a73" strokeWidth="3.1" />
    <path ref={part('arm')} fill="none" stroke="#bc8d6d" strokeWidth="2.3" />
    <g ref={part('head')}>
      <circle r="3.4" fill="#c79c78" /><path d="M-4-.8Q-3.5-6 1-5Q4-4 4-.8Z" fill="#ead4a5" /><path d="M-2-4.2 1-4.5 2-1" stroke="#8c5755" strokeWidth="1.2" fill="none" />
    </g>
    <text ref={part('you')} className="cyclist-label" textAnchor="middle" fill="#31523b" fontSize="17.5" fontWeight="600">You</text>
  </g>
})
