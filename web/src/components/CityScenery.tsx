function Building({ x, y, width = 100, height = 150, color = '#d9e3d4' }: { x: number; y: number; width?: number; height?: number; color?: string }) {
  return <g className={`city-building${x > 900 ? " city-east" : ""}`} transform={`translate(${x} ${y})`}>
    <path d={`M0 0h${width}l22-15H22Z`} fill="#edf0e5" />
    <path d={`M${width} 0l22-15v${height}l-22 15Z`} fill="#bdcbbb" />
    <rect width={width} height={height} fill={color} />
    {[22, 55, 88].filter(row => row < height - 15).map(row => <g key={row} fill="#abcbd2"><rect x="15" y={row} width="19" height="18" /><rect x={width - 35} y={row} width="19" height="18" /></g>)}
    <rect x={width / 2 - 11} y={height - 33} width="22" height="33" fill="#90a99d" />
  </g>
}

export function CityScenery() {
  return <svg className="city-scenery" viewBox="0 0 1240 2100" preserveAspectRatio="none" aria-hidden="true">
    <g opacity=".85">
      
      <Building x={1120} y={130} width={100} height={170} />
      <Building x={1105} y={325} width={85} height={110} color="#e6d9cf" />
      <path className="city-east" d="M1010 400h170m-155 14h130" stroke="#d4ddcd" strokeWidth="5" />
      <g transform="translate(-16 230)"><path d="M0 755Q75 728 160 770V1110Q80 1140 0 1115Z" fill="#eef1e5" />
      <Building x={15} y={810} width={85} height={160} color="#e4d8cf" />
      <Building x={60} y={910} width={65} height={110} /></g>
      <path className="city-east" d="M980 1480h260v390H970Z" fill="#eef1e5" />
      <Building x={1125} y={1530} width={100} height={150} color="#d8e4e4" />
      <Building x={1110} y={1690} width={80} height={100} color="#e9ded0" />
    </g>
    {[[1035,420],[1180,455],[45,1310],[120,1350],[1020,1790],[1190,1840]].map(([x,y],i) => <g key={i} className={x > 900 ? "city-east" : undefined} transform={`translate(${x} ${y})`}>
      <ellipse rx="28" ry="11" fill="#dae5c6" /><path d="M0 0v-39" stroke="#a9906f" strokeWidth="7" />
      <path d="m-24-38 4-28 23-12 22 17-3 28-24 9Z" fill="#bad28c" /><path d="m-24-38 22 14 24-9-3-17-21 10Z" fill="#98b972" />
    </g>)}
    {[[910,170],[155,1150],[920,1680]].map(([x,y],i) => <g key={i} className={x > 900 ? "city-east" : undefined} transform={`translate(${x} ${y})`} stroke="#819783" strokeWidth="3" fill="none"><path d="M0 0v-65q0-12 13-12h12" /><path d="M17-77h19" strokeWidth="7" /></g>)}
  </svg>
}
