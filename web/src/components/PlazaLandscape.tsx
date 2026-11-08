import { JOURNEY_GRASS, TRAIL_COLOR, trailWidth } from './campusFrame'
import type { JourneyGeometry } from './journeyGeometry'

export type StorySite = { x: number; y: number; width: number; height: number; content?: { x: number; y: number; width: number; height: number } }

function LandscapeTree({ x, y, size = 1 }: { x: number; y: number; size?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${size})`}>
    <ellipse cy="5" rx="27" ry="8" fill="#c5d4ac" /><path d="M-4-41V3l8 3v-48Z" fill="#ac9779" />
    <path d="m-30-70 30-13 32 12-30 15Z" fill="#d3e1a8" /><path d="m-30-70 32 14v31l-32-14Z" fill="#b4cc89" /><path d="m2-56 30-15v31L2-25Z" fill="#9fbd76" />
    <path d="m-13-91 22-9 24 9-22 11Z" fill="#dce7b9" /><path d="m-13-91 24 11v24l-24-10Z" fill="#c3d997" /><path d="m11-80 22-11v24L11-56Z" fill="#b1cb86" />
  </g>
}

export function PlazaLandscape({ geometry, sites }: { geometry: JourneyGeometry; sites: StorySite[] }) {
  const mobile = geometry.width < 700
  const width = geometry.width, top = geometry.story.y, radius = trailWidth(width) / 2
  const nearest = (y: number) => geometry.points.reduce((found, point) => Math.abs(point.y - y) < Math.abs(found.y - y) ? point : found, geometry.points[0])
  return <g className="story-landscape" aria-hidden="true">
    <rect className="journey-grass-base" x="0" y={geometry.campus.y} width={width} height={geometry.height - geometry.campus.y} fill={JOURNEY_GRASS} />
    {/* A shared landscape spans all three locations. The connected cream strip
        above it remains the original route, rendered with the original crowd. */}
    <path d={`M0 ${top}H${width}V${top + 135}Q${width * .82} ${top + 45} ${width * .65} ${top + 96}T${width * .27} ${top + 80}Q${width * .12} ${top + 25} 0 ${top + 80}Z`} fill="#eef1df" />
    <path d={`M0 ${top}Q${width * .23} ${top + 60} ${width * .41} ${top + 15}T${width} ${top + 55}V${top + 100}Q${width * .75} ${top + 148} ${width * .58} ${top + 98}T0 ${top + 105}Z`} fill="#e0e8c6" />
    {sites.map((site, index) => {
      const right = index === 1 && !mobile
      const at = (x: number, y: number) => ({ x: site.x + x / 700 * site.width, y: site.y + y / 450 * site.height })
      const front = at(right ? 55 : 670, 407), join = nearest(front.y)
      const farX = right ? width : 0
      const shoulder = join.x + (right ? radius + 34 : -radius - 34)
      const bottom = Math.max(at(0, 449).y, site.content ? site.content.y + site.content.height + 30 : 0)
      const contentLeft = site.content ? site.content.x - 25 : site.x
      const contentRight = site.content ? site.content.x + site.content.width + 25 : site.x + site.width
      // Keep the garden terrace on its own side of the main path.
      const terraceEdge = join.x + (index === 2 ? -radius : radius)
      const terrace = right
        ? `M${farX} ${at(0, 275).y}Q${site.x + site.width * .45} ${at(0, 250).y} ${join.x - radius} ${join.y - 40}L${join.x - radius} ${join.y + 25}C${join.x - radius + 30} ${join.y + 100} ${contentLeft - 40} ${bottom - 90} ${contentLeft} ${bottom + 5}Q${site.x + site.width * .4} ${bottom + 45} ${farX} ${bottom - 12}Z`
        : `M0 ${at(0, 280).y}Q${site.x + site.width * .55} ${at(0, 255).y} ${terraceEdge} ${join.y - 40}L${terraceEdge} ${join.y + 25}C${terraceEdge - 30} ${join.y + 100} ${contentRight + 40} ${bottom - 90} ${contentRight} ${bottom + 5}Q${site.x + site.width * .48} ${bottom + 45} 0 ${bottom - 12}Z`
      const connector = `M${front.x} ${front.y}C${front.x + (join.x - front.x) * .5} ${front.y + 4} ${join.x} ${join.y} ${join.x} ${join.y}`
      return <g key={index} className="location-ground">
        <path d={`M${farX} ${site.y + 88}Q${site.x + site.width * .5} ${site.y - 10} ${shoulder} ${site.y + site.height * .62}L${shoulder} ${bottom + 15}Q${site.x + site.width * .5} ${bottom + (mobile ? 24 : 45)} ${farX} ${bottom - 15}Z`} fill={index === 2 ? '#e4ebd0' : '#e9eedb'} />
        <path className="location-terrace" d={terrace} fill="#f2efe5" />
        <path className="scene-connection" d={connector} stroke={TRAIL_COLOR} strokeWidth={mobile ? 26 : 46} fill="none" strokeLinecap="round" data-route-x={join.x} data-route-y={join.y} />
        {!mobile && <g>
          <LandscapeTree x={shoulder + (right ? 26 : -26)} y={site.y + site.height * .53} size={.68} />
          <LandscapeTree x={right ? 88 : width - 82} y={site.y + 150} size={.85} />
          <LandscapeTree x={right ? 175 : width - 175} y={site.y + 175} size={.55} />
        </g>}
      </g>
    })}
    {/* The landscape closes around the same path before the scenario handoff. */}
    <path d={`M0 ${top + geometry.story.height - 120}Q${width * .23} ${top + geometry.story.height - 230} ${width * .45} ${top + geometry.story.height - 115}T${width} ${top + geometry.story.height - 150}V${top + geometry.story.height}H0Z`} fill="#e7edd7" />
  </g>
}
