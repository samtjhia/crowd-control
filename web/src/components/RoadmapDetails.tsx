/** Small native-SVG accents, drawn in the same geometric language as the roadmap. */
export function Flowers({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  const blooms = [
    { x: -21, y: -13, color: '#934d58' }, { x: -9, y: -23, color: '#b47764' },
    { x: 3, y: -16, color: '#743d4c' }, { x: 16, y: -26, color: '#a15d59' },
    { x: 28, y: -12, color: '#bd816a' },
  ]
  return <g className="roadmap-flowers" transform={`translate(${x} ${y}) scale(${scale})`}>
    {blooms.map((flower, index) => <g key={index}>
      <path d={`M${flower.x} 3V${flower.y}m0 12-5-5m5 0 5-5`} stroke="#708355" strokeWidth="2" fill="none" />
      <g transform={`translate(${flower.x} ${flower.y})`} fill={flower.color}>
        <path d="m0-7 4 3 4 1-1 5-4 1-3 4-4-3-4-1 1-5 4-1Z" />
        <path d="m0-7 4 3-2 5-5 1-1-5Z" fill="#c68d78" opacity=".55" />
        <circle r="1.6" fill="#e2bd83" />
      </g>
    </g>)}
  </g>
}

export function Airship({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return <g className="roadmap-airship" transform={`translate(${x} ${y}) scale(${scale})`}>
    <path d="m-105-10-28-38 40 20Zm-2 15-28 32 43-14Z" fill="#8f515c" />
    <path d="m-115-7 25-25 55-11 80 7 54 21 16 23-33 21-67 6-76-13-41-15Z" fill="#e8c9a4" />
    <path d="m-90-32 55-11 80 7 54 21-17 0-64-14-66 0-52 14Z" fill="#f3e2c7" />
    <path d="m-100-15 52-14h66l64 14 33 23-43 6-64 3-68-10-55-14Z" fill="#b87972" />
    <path d="m-115-7 55 14 68 10 64-3 43-6-33 21-67 6-76-13-41-15Z" fill="#884754" />
    <path d="M-6 24v17m36-17-7 20" fill="none" stroke="#95755d" strokeWidth="2" />
    <path d="m-13 39 44 3-8 15-32-3Z" fill="#8c6d56" /><path d="m-13 39 38 3-4 8-30-3Z" fill="#c5d8cf" />
    <path d="M0 41v7m12-6v7m19-1h12m-3-5v11" stroke="#69594c" strokeWidth="2" />
  </g>
}

export function ParkedBicycle({ x, y }: { x: number; y: number }) {
  return <g className="roadmap-bicycle" transform={`translate(${x} ${y})`} fill="none" strokeLinecap="round" strokeLinejoin="round">
    <g stroke="#7d816d" strokeWidth="2"><ellipse cx="-22" rx="12" ry="11" /><ellipse cx="24" rx="12" ry="11" /></g>
    <path d="m-22 0 13-23L5 0h-27l27-24L24 0M-9-23h-8m22-1 3-10h9" stroke="#8f4f59" strokeWidth="2.5" />
    <path d="M-18-25h12M11-34h9" stroke="#7c6450" strokeWidth="3" /><circle cx="5" r="3" stroke="#8f4f59" strokeWidth="2" />
  </g>
}
