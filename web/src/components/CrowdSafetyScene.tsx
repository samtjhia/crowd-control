import { useId, type ReactNode } from 'react'
import type { VisualizationType } from './incidents'
import { project, type ScenePoint } from './safetyGeometry'

export type SafetySceneType = VisualizationType | 'consequences'
const points = (vertices: ScenePoint[]) => vertices.map(v => { const p = project(v); return `${p.x},${p.y}` }).join(' ')
const line = (vertices: ScenePoint[]) => vertices.map((v, i) => { const p = project(v); return `${i ? 'L' : 'M'}${p.x} ${p.y}` }).join(' ')
const palette = ['#52715c', '#7b9270', '#9aaf8e', '#6d8e91', '#a48a73', '#5e7e6c']
const random = (i: number, seed: number) => { const n = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453; return n - Math.floor(n) }

function Plane({ x, y, w, d, z = 0, fill, ...props }: { x: number; y: number; w: number; d: number; z?: number; fill: string; className?: string }) {
  return <polygon points={points([[x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z]])} fill={fill} {...props} />
}
function Block({ x, y, w, d, h, top = '#f5eddb', front = '#d8d2bd', side = '#b7c3ac' }: { x: number; y: number; w: number; d: number; h: number; top?: string; front?: string; side?: string }) {
  return <g>
    <polygon points={points([[x, y + d], [x + w, y + d], [x + w, y + d, h], [x, y + d, h]])} fill={front} />
    <polygon points={points([[x + w, y], [x + w, y + d], [x + w, y + d, h], [x + w, y, h]])} fill={side} />
    <Plane x={x} y={y} w={w} d={d} z={h} fill={top} />
  </g>
}
function People({ x, y, w, d, count, seed = 1, z = 0, dense = false, blue = false }: { x: number; y: number; w: number; d: number; count: number; seed?: number; z?: number; dense?: boolean; blue?: boolean }) {
  const people = Array.from({ length: count }, (_, i) => {
    // Seeded, irregular positions preserve the illustration between renders.
    const px = x + random(i + 1, seed) * w, py = y + random(i + 1, seed + 17) * d
    return { ...project([px, py, z]), i }
  }).sort((a, b) => a.y - b.y)
  return <g className="scene-people">{people.map(p => <g key={p.i} transform={`translate(${p.x} ${p.y})`}>
    <ellipse cy="1.5" rx="2.4" ry="1" fill="#50644d" opacity=".13" />
    <path d="m-1-2-.6 3m2-3 .6 3" stroke="#61715d" strokeWidth="1.1" strokeLinecap="round" />
    <path d="M0-6v4" stroke={blue ? '#5d8495' : dense && p.i % 4 === 0 ? '#aa755b' : palette[p.i % palette.length]} strokeWidth="3" strokeLinecap="round" />
    <circle cy="-8.4" r="1.5" fill={p.i % 3 ? '#c6a688' : '#8c765c'} />
  </g>)}</g>
}
function Rail({ from, to }: { from: ScenePoint; to: ScenePoint }) {
  const a = project(from), b = project(to)
  return <g stroke="#7e927d" fill="none" strokeWidth="2"><path d={`M${a.x} ${a.y}v-10l${b.x-a.x} ${b.y-a.y}v10M${a.x} ${a.y-5}l${b.x-a.x} ${b.y-a.y}`} /></g>
}
function GroundLabel({ at, children, light = false }: { at: ScenePoint; children: string; light?: boolean }) {
  const p = project(at)
  return <text className="scene-ground-label" transform={`matrix(1 .185 -.57 .82 ${p.x} ${p.y})`} fill={light ? '#fffaf0' : '#52664f'} fontSize="13" letterSpacing="1.2" textAnchor="middle">{children}</text>
}
function Region({ index, active, children }: { index: number; active: number; children: ReactNode }) {
  return <g className={`scene-region${active === index ? ' is-active' : ''}`} data-region={index}>{children}</g>
}
function Planter({ x, y }: { x: number; y: number }) {
  return <><Block x={x} y={y} w={25} d={22} h={8} top="#e8edda" front="#d0d7bd" /><Block x={x + 4} y={y + 4} w={17} d={14} h={15} top="#c4d69e" front="#93ad77" side="#a9c085" /></>
}

export function CrowdSafetyScene({ type, active, title }: { type: SafetySceneType; active: number; title: string }) {
  const uid = useId().replace(/:/g, '')
  const arrow = `${uid}-flow`
  const flow = (vertices: ScenePoint[], concern = false) => <path className="scene-flow" d={line(vertices)} fill="none" stroke={concern ? '#ac7558' : '#4e8067'} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" markerEnd={`url(#${arrow})`} />
  const wash = (x: number, y: number, w: number, d: number) => <Plane x={x} y={y} w={w} d={d} z={.5} fill="#cb9368" />
  const venue = type === 'nightclub' || type === 'consequences'
  return <svg className={`safety-scene safety-scene-${type}`} viewBox="0 0 720 460" role="img" aria-labelledby={`${uid}-title ${uid}-desc`}>
    <title id={`${uid}-title`}>{title}</title>
    <desc id={`${uid}-desc`}>A conceptual miniature environment showing crowd distribution, constrained movement and access routes. Numbered controls beside the illustration explain the highlighted areas. This is not a historical reconstruction or simulation result.</desc>
    <defs><marker id={arrow} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="m1 1 7 4-7 4" fill="none" stroke="context-stroke" strokeWidth="1.5" /></marker></defs>
    <g className="scene-environment">
      <Block x={0} y={0} w={480} d={320} h={-8} top="#e9ecdd" front="#d6ddca" side="#cbd4c1" />
      {type === 'concert' && <>
        <Plane x={32} y={25} w={416} d={280} fill="#f3eddd" />
        <Plane x={52} y={57} w={34} d={233} fill="#e0e6d6" /><Plane x={417} y={57} w={20} d={233} fill="#e0e6d6" />
        <Block x={115} y={28} w={280} d={47} h={22} top="#64846d" front="#496d58" side="#59745e" />
        <Block x={95} y={25} w={12} d={51} h={57} top="#7b8e77" front="#4c6352" side="#61755f" /><Block x={403} y={25} w={12} d={51} h={57} top="#7b8e77" front="#4c6352" side="#61755f" />
        <GroundLabel at={[255, 59, 23]} light>STAGE</GroundLabel>
        <Region active={active} index={0}>{wash(113, 85, 280, 80)}</Region>
        <Region active={active} index={1}>{wash(100, 178, 300, 22)}</Region>
        <Region active={active} index={2}><Plane x={48} y={79} w={40} d={211} fill="#b5cdb2" /><Plane x={417} y={79} w={25} d={211} fill="#b5cdb2" /></Region>
        <People x={120} y={88} w={265} d={76} count={190} dense seed={2} />
        <People x={110} y={210} w={128} d={76} count={43} seed={5} /><People x={280} y={210} w={120} d={76} count={45} seed={9} />
        <Rail from={[100, 87]} to={[100, 290]} /><Rail from={[408, 87]} to={[408, 290]} />
        <Rail from={[100, 185]} to={[233, 185]} /><Rail from={[277, 185]} to={[408, 185]} />
        <Rail from={[104, 298]} to={[225, 298]} /><Rail from={[284, 298]} to={[407, 298]} />
        {flow([[65, 280], [65, 200], [65, 110]])}{flow([[429, 280], [429, 190], [429, 105]])}
        <GroundLabel at={[250, 318]}>AUDIENCE ZONES</GroundLabel>
        <Planter x={3} y={265} /><Planter x={450} y={268} />
      </>}
      {type === 'alley' && <>
        <Plane x={200} y={0} w={78} d={280} fill="#f4ead7" /><Plane x={10} y={260} w={460} d={52} fill="#f4ead7" />
        <Plane x={211} y={0} w={4} d={254} fill="#dcd8c4" /><Plane x={265} y={0} w={4} d={254} fill="#dcd8c4" />
        <Region active={active} index={0}>{wash(210, 105, 60, 146)}</Region>
        <Region active={active} index={1}>{wash(200, 74, 78, 24)}</Region>
        <Region active={active} index={2}>{wash(151, 261, 194, 48)}</Region>
        <People x={218} y={15} w={41} d={85} count={27} seed={2} /><People x={215} y={110} w={47} d={138} count={115} dense seed={8} />
        <People x={40} y={273} w={150} d={29} count={35} seed={12} /><People x={288} y={272} w={160} d={30} count={30} seed={19} />
        <Block x={32} y={18} w={161} d={84} h={72} /><Block x={284} y={14} w={153} d={90} h={82} top="#dce2d1" front="#bac9b7" side="#a7bba6" />
        <Block x={33} y={126} w={162} d={112} h={57} top="#e6e4d5" front="#c8cdbb" side="#aebda7" /><Block x={285} y={128} w={156} d={110} h={67} />
        {[45, 75, 105, 135, 165].map(x => <Plane key={x} x={x} y={234} w={11} d={3} z={23} fill="#8aa69b" />)}
        {flow([[226, 28], [226, 81]], true)}{flow([[255, 247], [255, 192]], true)}
        {flow([[63, 288], [148, 288], [194, 269]])}{flow([[432, 289], [345, 289], [293, 268]])}
        <GroundLabel at={[290, 318]}>CROSS STREET</GroundLabel><GroundLabel at={[238, 60]}>ALLEY</GroundLabel>
        <Planter x={7} y={258} /><Planter x={449} y={263} />
      </>}
      {venue && <>
        <Plane x={25} y={28} w={430} d={266} fill="#f5ecdb" />
        <Block x={25} y={25} w={430} d={7} h={36} top="#c3cbb6" front="#a4b598" />
        <Block x={25} y={32} w={7} d={130} h={32} /><Block x={25} y={205} w={7} d={89} h={26} />
        <Block x={448} y={32} w={7} d={150} h={29} /><Block x={448} y={225} w={7} d={69} h={26} />
        {type === 'nightclub' ? <><Block x={105} y={43} w={157} d={45} h={15} top="#7b9479" front="#5d785f" /><GroundLabel at={[184, 72, 16]} light>STAGE</GroundLabel><Block x={387} y={70} w={37} d={84} h={16} top="#d0c1a3" /></> : <><Block x={80} y={65} w={58} d={44} h={14} top="#c3ccb1" /><Block x={360} y={61} w={65} d={45} h={14} top="#c3ccb1" /></>}
        <Region active={active} index={0}>{wash(200, 241, 89, 52)}</Region>
        <Region active={active} index={type === 'consequences' ? 1 : 0}>{wash(171, 187, 145, 55)}</Region>
        <Region active={active} index={type === 'consequences' ? 2 : 1}><Plane x={30} y={164} w={67} d={38} fill="#b3cdb7" /><Plane x={397} y={183} w={81} d={38} fill="#b3cdb7" /></Region>
        <Region active={active} index={type === 'consequences' ? 3 : 2}>{wash(282, 40, 82, 82)}</Region>
        <People x={88} y={107} w={290} d={89} count={75} seed={6} />
        <People x={180} y={202} w={128} d={47} count={69} dense seed={9} /><People x={219} y={251} w={48} d={40} count={39} dense seed={17} />
        <People x={62} y={174} w={38} d={23} count={8} seed={2} />
        {flow([[165, 170], [205, 230], [240, 287]], true)}{flow([[345, 173], [295, 234], [254, 285]], true)}
        {flow([[120, 170], [64, 182], [10, 182]])}{flow([[363, 203], [427, 203], [477, 203]])}
        <Block x={25} y={294} w={190} d={6} h={14} /><Block x={275} y={294} w={180} d={6} h={14} />
        <GroundLabel at={[246, 319]}>MAIN ENTRANCE</GroundLabel>
        <GroundLabel at={[66, 223]}>EXIT</GroundLabel><GroundLabel at={[420, 236]}>EXIT</GroundLabel>
        <g transform={`translate(${project([320, 79]).x} ${project([320, 79]).y})`}><path d="m0-18 14 25H-14Z" fill="#b98158" /><path d="M0-10v8m0 4v1" stroke="#fff8e9" strokeWidth="2" /></g>
        {type === 'consequences' && <><People x={450} y={251} w={21} d={33} count={4} blue seed={29} />{flow([[475, 286], [465, 248]], true)}</>}
      </>}

    </g>
  </svg>
}
