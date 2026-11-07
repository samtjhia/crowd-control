import { useEffect, useRef, useState } from 'react'
import { formatClock, tickStep, timelineExtent, timelineMarkers, type Incident } from './incidents.ts'

/**
 * Simulation-time track in the bottom dock: elapsed fill, playhead, and each event as a
 * coloured dot (same colours as the map and log). Seeking into the past arrives with the
 * engine's replay, so markers are read-only for now.
 */
export function Timeline({ now, incidents }: { now: number; incidents: Incident[] }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [trackPx, setTrackPx] = useState(600)
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const observer = new ResizeObserver(([entry]) => setTrackPx(entry!.contentRect.width))
    observer.observe(track)
    return () => observer.disconnect()
  }, [])

  const extent = timelineExtent(now)
  const at = (time: number) => `${Math.min(100, (time / extent) * 100)}%`
  const markers = timelineMarkers(incidents)
  const step = tickStep(extent, trackPx, 56)
  const ticks: number[] = []
  for (let t = 0; t <= extent; t += step) ticks.push(t)

  return (
    <div className="timeline" role="group" aria-label="Timeline">
      <div className="timeline-track" ref={trackRef}>
        <div className="timeline-elapsed" style={{ width: at(now) }} />
        <ol className="timeline-markers" aria-label="Events on the timeline">
          {markers.map((marker) => (
            <li key={marker.id} className={`timeline-marker status-${marker.sign}`} style={{ left: at(marker.time) }}
              title={`${formatClock(marker.time, false)} ${marker.title}${marker.detail ? ` · ${marker.detail}` : ''}`}>
              <span className="visually-hidden">{formatClock(marker.time, false)} {marker.title}{marker.detail ? `, ${marker.detail}` : ''}</span>
            </li>
          ))}
        </ol>
        <div className="timeline-playhead" style={{ left: at(now) }} />
      </div>
      <ol className="timeline-ticks" aria-hidden="true">
        {ticks.map((t) => {
          const covered = Math.abs(((t - now) / extent) * trackPx) < 20
          const className = [t === extent ? 'is-end' : '', covered ? 'is-covered' : ''].filter(Boolean).join(' ') || undefined
          return <li key={t} className={className} style={{ left: at(t) }}>{formatClock(t, false)}</li>
        })}
      </ol>
    </div>
  )
}
