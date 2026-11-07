import { useId } from 'react'
import type { VisualizationType } from './incidents'

function Crowd({ x, y, columns, rows, gap = 12, dense = false }: { x: number; y: number; columns: number; rows: number; gap?: number; dense?: boolean }) {
  return <g fill={dense ? '#a75c49' : '#66816d'}>{Array.from({ length: columns * rows }, (_, i) => {
    const col = i % columns, row = Math.floor(i / columns)
    return <circle key={i} cx={x + col * gap + Math.sin(i * 7.1) * gap * .16} cy={y + row * gap + Math.cos(i * 3.4) * gap * .16} r={dense ? 2.7 : 2.5} />
  })}</g>
}

function Arrow({ d, marker, concern = false }: { d: string; marker: string; concern?: boolean }) {
  return <path d={d} fill="none" stroke={concern ? '#a75c49' : '#47745d'} strokeWidth="3" strokeLinecap="round" markerEnd={`url(#${marker})`} />
}

function Label({ x, y, children, concern = false }: { x: number; y: number; children: string; concern?: boolean }) {
  return <text x={x} y={y} fill={concern ? '#944d3e' : '#355642'} fontSize="13" fontWeight="600">{children}</text>
}

export function IncidentVisualization({ type }: { type: VisualizationType }) {
  const uid = useId().replace(/:/g, '')
  const marker = `${uid}-arrow`, hazard = `${uid}-hazard`
  const descriptions = {
    concert: 'Audience sections behind concert barriers. A denser concentration forms near the stage while access corridors run along the sides.',
    alley: 'Buildings constrain a narrow alley. Opposing pedestrian flows converge at a highlighted bottleneck.',
    nightclub: 'A nightclub floor plan with multiple exits. Routes converge at the congested main entrance, while alternative exits provide other paths away from a fire hazard.',
    stadium: 'Four standing terrace sections with unequal crowd distribution. Entrance tunnels feed the two densely occupied central sections.',
  }
  return <figure className="incident-figure">
    <div className="diagram-heading"><span>SPATIAL STUDY</span><span>{type === 'concert' ? '01 / CONCERT' : type === 'alley' ? '02 / STREET' : type === 'nightclub' ? '03 / EVACUATION' : '04 / STADIUM'}</span></div>
    <svg viewBox="0 0 600 500" role="img" aria-labelledby={`${uid}-title ${uid}-description`}>
      <title id={`${uid}-title`}>{type === 'nightclub' ? 'Nightclub evacuation' : type === 'concert' ? 'Concert crowd distribution' : type === 'alley' ? 'Constrained pedestrian passage' : 'Stadium terrace distribution'}</title>
      <desc id={`${uid}-description`}>{descriptions[type]}</desc>
      <defs>
        <marker id={marker} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="m1 1 7 4-7 4" fill="none" stroke="context-stroke" strokeWidth="1.6" /></marker>
        <radialGradient id={hazard}><stop offset="0" stopColor="#b9654e" stopOpacity=".32" /><stop offset=".6" stopColor="#d5a260" stopOpacity=".22" /><stop offset="1" stopColor="#d5a260" stopOpacity="0" /></radialGradient>
      </defs>
      {type === 'concert' && <>
        <path d="M60 100H540V434H60Z" fill="#e6e7d9" stroke="#c8ceba" />
        <rect x="176" y="48" width="248" height="56" fill="#66816e" /><path d="M176 104h248v10H176Z" fill="#486b56" /><text x="300" y="82" textAnchor="middle" fill="#fffaf0" fontSize="15" letterSpacing="2">MAIN STAGE</text>
        <path d="M143 126V386M457 126V386M160 242h113m54 0h113M160 352h280" stroke="#a1ad95" strokeWidth="7" fill="none" />
        <ellipse cx="300" cy="167" rx="155" ry="88" fill={`url(#${hazard})`} />
        <Crowd x={175} y={136} columns={26} rows={9} gap={10} dense /><Crowd x={178} y={269} columns={10} rows={6} /><Crowd x={327} y={268} columns={10} rows={6} />
        <Arrow d="M98 397V177" marker={marker} /><Arrow d="M500 397V177" marker={marker} />
        <Label x={186} y={461}>Audience sections</Label><Label x={328} y={135} concern>Higher density</Label><path d="M368 140v24" stroke="#a75c49" />
        <Label x={63} y={486}>Side access</Label><path d="M100 470v-36" stroke="#71816d" />
      </>}
      {type === 'alley' && <>
        <path d="M50 377 235 267 273 63h83l-38 204 230 122-29 55-246-128L82 430Z" fill="#e6ddc7" />
        <path d="m47 79 165-8-17 122-148 38Zm317-8 176 14v178l-196-96ZM40 286l138-40-7 53L40 375Zm345-70 159 64v70l-169-83Z" fill="#d5dcc9" stroke="#aebca5" strokeWidth="2" />
        <path d="m47 79 165-8-12-17-153 7Zm317-8 176 14-18-21-155-12Z" fill="#edf0e3" />
        <ellipse cx="283" cy="280" rx="96" ry="76" fill={`url(#${hazard})`} />
        <Crowd x={275} y={111} columns={5} rows={11} gap={9} /><Crowd x={247} y={242} columns={8} rows={9} gap={8} dense />
        <g transform="rotate(-27 157 351)"><Crowd x={95} y={337} columns={10} rows={4} gap={10} /></g><g transform="rotate(25 425 361)"><Crowd x={367} y={342} columns={12} rows={4} gap={10} /></g>
        <Arrow d="M285 89 269 196" marker={marker} /><Arrow d="M104 392 206 330" marker={marker} /><Arrow d="M496 407 370 341" marker={marker} />
        <Label x={45} y={43}>Buildings constrain the passage</Label><Label x={335} y={238} concern>Converging flows</Label><path d="m330 244-29 28" stroke="#a75c49" />
        <Label x={195} y={476}>Narrow, sloping alley</Label>
      </>}
      {type === 'nightclub' && <>
        <rect x="80" y="70" width="440" height="337" fill="#e5e6d7" />
        <path d="M225 407H80V222m0-30V70h440v125m0 44v168H286" fill="none" stroke="#83977d" strokeWidth="12" />
        <path d="M80 222h83V70m-83 243h83v92M419 70v90h101" fill="none" stroke="#b4bea5" strokeWidth="5" />
        <rect x="202" y="91" width="175" height="47" fill="#7b927d" /><text x="290" y="120" textAnchor="middle" fontSize="14" fill="#fffaf0">STAGE</text>
        <ellipse cx="250" cy="374" rx="88" ry="72" fill={`url(#${hazard})`} /><ellipse cx="383" cy="135" rx="85" ry="73" fill={`url(#${hazard})`} />
        <path d="m395 103 22 38h-44Z" fill="#c08a57" /><text x="395" y="133" textAnchor="middle" fill="#fffaf0" fontSize="21">!</text>
        <Crowd x={196} y={169} columns={17} rows={8} gap={13} /><Crowd x={229} y={310} columns={6} rows={10} gap={8} dense /><Crowd x={111} y={241} columns={3} rows={4} />
        <Arrow d="M206 283Q228 324 249 380" marker={marker} concern /><Arrow d="M358 291Q295 339 263 379" marker={marker} concern /><Arrow d="M384 221H539" marker={marker} /><Arrow d="M187 207H56" marker={marker} />
        <path d="M80 192v30" stroke="#659078" strokeWidth="12" /><path d="M520 195v44" stroke="#659078" strokeWidth="6" />
        <Label x={190} y={454} concern>Main entrance congestion</Label><path d="M251 434v-21" stroke="#a75c49" /><Label x={408} y={183}>Exit</Label><Label x={20} y={177}>Exit</Label><Label x={386} y={57} concern>Fire hazard</Label>
      </>}
      {type === 'stadium' && <>
        <path d="M61 80H539V390H61Z" fill="#e3e5d6" stroke="#b9c5ad" />
        <path d="M85 313H515V416H85Z" fill="#cddbb8" /><path d="M104 332h392v63H104Z" fill="none" stroke="#f5f4e8" strokeWidth="2" />
        {[85,196,307,418].map((x,i)=><g key={x}><rect x={x} y="101" width="96" height="191" fill={i===1||i===2?'#e6d6ba':'#dbe1cb'} />{[130,160,190,220,250,280].map(y=><path key={y} d={`M${x} ${y}h96`} stroke="#bdc8ad" />)}<Crowd x={x+9} y={115} columns={i===1||i===2?10:6} rows={i===1||i===2?18:10} gap={i===1||i===2?8:15} dense={i===1||i===2} /></g>)}
        <ellipse cx="302" cy="178" rx="139" ry="126" fill={`url(#${hazard})`} />
        <path d="M75 300h450M189 95v205m111-205v205m111-205v205" stroke="#84977c" strokeWidth="5" />
        <Arrow d="M243 35V96" marker={marker} concern /><Arrow d="M354 35V96" marker={marker} concern /><Label x={188} y={22}>Entrance tunnels</Label>
        <Label x={190} y={453} concern>Uneven section occupancy</Label><Label x={276} y={372}>Pitch</Label>
      </>}
    </svg>
    <div className="diagram-legend" aria-hidden="true"><span><i /> Pedestrians</span><span><i className="hazard-key" /> Potential congestion</span><span>→ Movement</span></div>
    <figcaption>Conceptual illustration — not a reconstruction</figcaption>
  </figure>
}
