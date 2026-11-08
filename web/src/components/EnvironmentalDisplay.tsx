import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** One measured frame: every face, cap and support uses the same pixel
 * coordinates. HTML copy follows the same face vector without rasterization. */
export function EnvironmentalDisplay({ kind, children }: { kind: 'shelter' | 'station' | 'garden' | 'example'; children: ReactNode }) {
  const content = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = content.current!
    const update = (entry?: ResizeObserverEntry) => {
      // Measure layout dimensions, not the sheared bounding rectangle. This
      // keeps text projection from feeding back into the frame's height.
      const box = entry?.borderBoxSize?.[0]
      const width = Math.round((box?.inlineSize ?? element.offsetWidth) * 100) / 100
      const height = Math.round((box?.blockSize ?? element.offsetHeight) * 100) / 100
      setSize(current => current.width === width && current.height === height ? current : { width, height })
    }
    const observer = new ResizeObserver(([entry]) => update(entry))
    observer.observe(element); update()
    return () => observer.disconnect()
  }, [])
  const { width: w, height: h } = size
  const foot = 44, depth = kind === 'garden' ? 6 : 8, rise = kind === 'garden' ? 4 : 5
  const colors = kind === 'example'
    ? { front: '#eef2e2', frame: '#6e8a73', side: '#5e7b65', top: '#91aa90', post: '#8c9e86' }
    : kind === 'garden'
    ? { front: '#f8efde', frame: '#b69e79', side: '#9e8766', top: '#d4bf9d', post: '#ad9573' }
    : kind === 'station'
      ? { front: '#f1f3e7', frame: '#67846e', side: '#4f6c59', top: '#8ca58e', post: '#758e79' }
      : { front: '#faf4e8', frame: '#93aa98', side: '#6f8c7a', top: '#c6d9cf', post: '#819c87' }
  const legs = [18, w - 25]
  const tilt = kind === 'example' ? 0 : Math.min(20, w * .055)
  const edgeY = (x: number) => tilt / 2 - tilt * x / Math.max(w, 1)
  const minY = -tilt / 2 - rise
  const maxY = h + foot + tilt / 2
  const front = `M0 ${edgeY(0)}L${w} ${edgeY(w)}V${h + edgeY(w)}L0 ${h + edgeY(0)}Z`
  const inset = `M2 ${edgeY(2) + 2}L${w - 2} ${edgeY(w - 2) + 2}V${h + edgeY(w - 2) - 2}L2 ${h + edgeY(2) - 2}Z`
  return <div className={`environmental-display display-${kind}`} data-framed={w > 0}>
    {w > 0 && h > 0 && <svg className="display-structure" width={w} height={maxY - minY} viewBox={`0 ${minY} ${w} ${maxY - minY}`} style={{ top: minY }} aria-hidden="true">
      <ellipse cx={w / 2} cy={h + foot - 3} rx={Math.max(1, w / 2 - 8)} ry="4" fill="#cad5bd" opacity=".5" transform={`rotate(${-Math.atan2(tilt, w) * 180 / Math.PI} ${w / 2} ${h + foot - 3})`} />
      {legs.map(x => {
        const y = h + edgeY(x)
        return <g key={x}>
          <path d={`M${x} ${y - 2}h7v${foot - 1}h-7Z`} fill={colors.post} />
          <path d={`M${x - 3} ${y - 5}l3 3v${foot - 1}l-3-3Z`} fill={colors.side} />
          <path d={`m${x - 6} ${y + foot - 5} 12-3 8 4-12 3Z`} fill="#b7c4ac" />
        </g>
      })}
      {/* Shared vertices make the front, return and cap one assembled object. */}
      <path className="display-return-face" d={`M${-depth} ${edgeY(0) - rise}L0 ${edgeY(0)}V${h + edgeY(0)}L${-depth} ${h + edgeY(0) - rise}Z`} fill={colors.side} />
      <path className="display-cap-face" d={`M${-depth} ${edgeY(0) - rise}L${w - depth} ${edgeY(w) - rise}L${w} ${edgeY(w)}L0 ${edgeY(0)}Z`} fill={colors.top} />
      <path className="display-front-face" d={front} fill={colors.frame} />
      <path className="display-inset-face" d={inset} fill={colors.front} />
      {kind === 'shelter' && <path d={`M0 ${edgeY(0)}L${w} ${edgeY(w)}`} stroke="#bdd1c5" strokeWidth="3" />}

    </svg>}
    <div ref={content} className="display-content" style={w ? { transformOrigin: '0 0', transform: `matrix(1, ${-tilt / w}, 0, 1, 0, ${tilt / 2})` } : undefined}>{children}</div>
  </div>
}
