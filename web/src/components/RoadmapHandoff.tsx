import { drawPerson, useCanvas } from './canvas'
import { journeyPeopleAt } from './journeyCrowdMotion'
import { useJourney } from './journeyFlow'
import { Icon } from './Icons'

/** The shared walking stream enters a covered passage. Roof occlusion replaces
 * the old falling animation; no people leave the ground plane. */
export function RoadmapHandoff({ reduced }: { reduced: boolean }) {
  const geometry = useJourney()
  const canvas = useCanvas((ctx, width, height, _time, still, flowTime) => {
    if (!geometry?.handoff) return
    const box = geometry.handoff, time = still ? 0 : flowTime
    for (const person of journeyPeopleAt(geometry, time)) {
      const x = person.x - box.x, y = person.y - box.y
      if (y < -16 || y > height + 16 || x < -10 || x > width + 10) continue
      ctx.globalAlpha = Math.min(1, Math.max(0, (geometry.length - person.distance) / 22))
      drawPerson(ctx, x, y, person.size, person.identity, time * person.pace, !still)
    }
    ctx.globalAlpha = 1
  }, reduced, true)
  const { width, height } = geometry?.handoff ?? { width: 1240, height: 220 }
  const center = width / 2
  const scale = width < 700 ? .8 : 1
  const gateY = Math.min(95, height * .44)
  return <>
    <svg className="handoff-ground" viewBox={`0 0 ${width} ${height}`} aria-hidden="true"><ellipse cx={center + 8} cy={gateY + 43 * scale} rx={95 * scale} ry={22 * scale} fill="#cedaba" /><path d={`M${center-50*scale} ${gateY-20*scale}h${100*scale}l${35*scale} ${65*scale}h-${170*scale}Z`} fill="#f3ebda" /></svg>
    <canvas className="handoff-crowd" ref={canvas} aria-hidden="true" />
    <svg className="handoff-gateway" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <g transform={`translate(${center} ${gateY}) scale(${scale})`}>
        <path d="M-65-10v64l9 4v-65Zm114-8v63l9 4v-63Z" fill="#8da185" />
        <path d="m-56-7 7-4v64l-7 5Zm114-7 6-4v63l-6 4Z" fill="#6f8b72" />
        <path d="m-91-24 121-22 63 27-122 23Z" fill="#f5e8d1" />
        <path d="m-91-24 62 28v9l-62-27Z" fill="#b38a6d" /><path d="m-29 4 122-23v9L-29 13Z" fill="#8f515c" />
        <path d="m-75-23 105-18 45 19L-29-2Z" fill="#b7c7a2" />
        <path d="m-12-20 15-3 8 4-15 3Z" fill="#f5f1e2" />
        <text x="-1" y="-8" fill="#375640" fontSize="12" fontWeight="600" transform="rotate(-10)">04</text>
      </g>
    </svg>
    <a className="handoff-link" href="#why-it-matters">Real-world examples <Icon name="down" size={16} /></a>
  </>
}
