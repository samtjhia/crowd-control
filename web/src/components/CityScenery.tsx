import { Airship } from './RoadmapDetails'
import { useJourney } from './journeyFlow'
import { trailWidth } from './campusFrame'

function Building({ x, y, scale, width = 100, height = 150, color = '#d9e3d4', roof = '#edf0e5', side = '#bdcbbb', east }: { x: number; y: number; scale: number; width?: number; height?: number; color?: string; roof?: string; side?: string; east: boolean }) {
  return <g className={`city-building ${east ? 'city-east' : 'city-west'}`} transform={`translate(${x} ${y}) scale(${scale})`}>
    <ellipse cx={width / 2 + 8} cy={height + 6} rx={width * .65} ry="12" fill="#d9e1cf" opacity=".65" />
    <path d={`M0 0h${width}l22-15H22Z`} fill={roof} />
    <path d={`M${width} 0l22-15v${height}l-22 15Z`} fill={side} />
    <rect width={width} height={height} fill={color} />
    {[22, 55, 88].filter(row => row < height - 15).map(row => <g key={row} fill="#abcbd2"><rect x="15" y={row} width="19" height="18" /><rect x={width - 35} y={row} width="19" height="18" /></g>)}
    <rect x={width / 2 - 11} y={height - 33} width="22" height="33" fill="#90a99d" />
  </g>
}

export function CityScenery() {
  const geometry = useJourney()
  const width = geometry?.story.width ?? 1240, height = geometry?.story.height ?? 2100
  const scale = width / 1240
  // Objects retain the same isometric proportions as the foreground. Their
  // positions adapt to the story, instead of stretching a tall backdrop SVG.
  const place = (x: number, y: number, left: number, right: number, above: number, below: number) => {
    let px = x * scale
    const py = y / 2100 * height
    if (geometry) {
      const points = geometry.points.filter(point => point.y >= geometry.story.y + py - above * scale && point.y <= geometry.story.y + py + below * scale)
      if (points.length) {
        const edge = trailWidth(geometry.width) / 2 + 18
        const low = Math.min(...points.map(point => point.x - geometry.story.x)) - edge
        const high = Math.max(...points.map(point => point.x - geometry.story.x)) + edge
        if (px + right * scale > low && px - left * scale < high) px = x > 620 ? high + left * scale + 10 : low - right * scale - 10
      }
    }
    px = Math.max((left + 12) * scale, Math.min(width - (right + 12) * scale, px))
    return { x: px, y: py }
  }
  const blocks = [
    { x: 1090, y: 135, width: 100, height: 170, color: '#bd8a74', roof: '#e6c3aa', side: '#976b60' },
    { x: 1080, y: 330, width: 85, height: 110, color: '#a86b74', roof: '#d3a3a0', side: '#824d59' },
    { x: 20, y: 1040, width: 85, height: 160, color: '#ba9475', roof: '#e7cdb2', side: '#966e58' },
    { x: 80, y: 1180, width: 65, height: 110, color: '#d9e3d4' },
    { x: 1090, y: 1530, width: 100, height: 150, color: '#b17b6e', roof: '#dfbaa7', side: '#8d5b54' },
    { x: 1080, y: 1720, width: 80, height: 100, color: '#e9ded0' },
  ]
  const placed = blocks.map(block => ({ ...block, ...place(block.x, block.y, 15, block.width + 28, 15, block.height + 18), east: block.x > 620 }))
  const airship = width < 700
    ? { x: width * .36, y: height * .245 }
    : place(1005, width < 1000 ? 630 : 535, 120, 125, 65, 65)
  return <svg className="city-scenery" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
    {/* No independent land slabs: the buildings share the world's existing
        ground, with small footpaths and contact shadows to anchor their feet. */}
    {[0, 2, 4].map(index => {
      const a = placed[index], b = placed[index + 1]
      const start = { x: a.x + a.width * scale / 2, y: a.y + a.height * scale }
      const end = { x: b.x + b.width * scale / 2, y: b.y + b.height * scale }
      const middleY = (start.y + end.y) / 2
      const join = geometry?.points.reduce((found, point) => Math.abs(point.y - geometry.story.y - middleY) < Math.abs(found.y - geometry.story.y - middleY) ? point : found, geometry.points[0])
      const junction = join && geometry ? { x: join.x - geometry.story.x, y: join.y - geometry.story.y } : start
      return <path key={index} className={a.east ? 'city-east' : 'city-west'} d={`M${start.x} ${start.y}Q${start.x - 25 * scale} ${middleY} ${end.x} ${end.y}M${junction.x} ${junction.y}Q${(junction.x + start.x) / 2} ${junction.y} ${start.x} ${start.y}`} stroke="#f2efe5" strokeWidth={15 * scale} fill="none" strokeLinecap="round" />
    })}
    {placed.map((block, index) => <Building key={index} {...block} scale={scale} />)}
    {[[1035,420],[1170,465],[45,1330],[120,1380],[1020,1810],[1170,1860]].map(([x,y],i) => {
      const point = place(x, y, 35, 35, 80, 12)
      return <g key={i} className={x > 620 ? 'city-east' : 'city-west'} transform={`translate(${point.x} ${point.y}) scale(${scale})`}>
        <ellipse rx="28" ry="11" fill="#dae5c6" /><path d="M0 0v-39" stroke="#a9906f" strokeWidth="7" />
        <path d="m-24-38 4-28 23-12 22 17-3 28-24 9Z" fill="#bad28c" /><path d="m-24-38 22 14 24-9-3-17-21 10Z" fill="#98b972" />
      </g>
    })}
    {[[970,210],[175,1190],[980,1610]].map(([x,y],i) => {
      const point = place(x, y, 4, 36, 92, 3)
      let opposite: number | undefined
      if (i === 2 && geometry) {
        // A matched pair faces inward from opposite edges of the main path.
        const roadside = geometry.points.filter(p => p.y >= geometry.story.y + point.y - 92 * scale && p.y <= geometry.story.y + point.y + 3 * scale)
        if (roadside.length) {
          const clearance = trailWidth(geometry.width) / 2 + 45 + 36 * scale
          point.x = Math.min(...roadside.map(p => p.x)) - geometry.story.x - clearance
          opposite = Math.max(...roadside.map(p => p.x)) - geometry.story.x + clearance
        }
      }
      return <g key={i} className={x > 620 ? 'city-east' : 'city-west'}>
        {[point.x, ...(opposite === undefined ? [] : [opposite])].map((lampX, side) => <g key={side} transform={`translate(${lampX} ${point.y}) scale(${side ? -scale : scale} ${scale})`} stroke="#819783" strokeWidth="3" fill="none"><path d="M0 0v-65q0-12 13-12h12" /><path d="M17-77h19" strokeWidth="7" /><path d="M18-74h17" stroke="#f3dc9f" strokeWidth="2" /></g>)}
      </g>
    })}
    <Airship x={airship.x} y={airship.y} scale={width < 700 ? .63 : scale * .95} />
  </svg>
}
