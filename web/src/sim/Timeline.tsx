import { useEffect, useRef, useState } from 'react'
import { formatClock, tickStep, timelineExtent, timelineMarkers, type Incident } from './incidents.ts'

/** Seek within recorded time; the worker restores state and leaves playback paused. */
export function Timeline({ now, recordedUntil, incidents, disabled, onSeek }: {
  now: number; recordedUntil: number; incidents: Incident[]; disabled: boolean; onSeek(time: number): Promise<unknown> | void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const active = useRef(false)
  const latest = useRef<number | null>(null)
  const queued = useRef<number | null>(null)
  const [trackPx, setTrackPx] = useState(600)
  const [preview, setPreview] = useState<number | null>(null)
  const [timeInput, setTimeInput] = useState('')
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const observer = new ResizeObserver(([entry]) => setTrackPx(entry!.contentRect.width))
    observer.observe(track)
    return () => {
      observer.disconnect()
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [])

  const send = (time: number) => {
    if (active.current) { queued.current = time; return }
    active.current = true
    void Promise.resolve()
      .then(() => onSeek(time))
      .catch(() => {})
      .finally(() => {
        active.current = false
        const next = queued.current
        queued.current = null
        if (next !== null) send(next)
      })
  }
  const schedule = () => {
    if (timer.current !== null) return
    timer.current = setTimeout(() => {
      timer.current = null
      if (latest.current !== null) send(latest.current)
    }, 120)
  }
  const change = (time: number) => {
    latest.current = time
    setPreview(time)
    schedule()
  }
  const commit = () => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null }
    const time = latest.current
    latest.current = null
    setPreview(null)
    if (time !== null) send(time)
  }
  const cancel = () => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null }
    latest.current = null
    setPreview(null)
  }

  const extent = timelineExtent(recordedUntil)
  const playhead = preview ?? now
  const at = (time: number) => `${Math.min(100, (time / extent) * 100)}%`
  const markers = timelineMarkers(incidents)
  const step = tickStep(extent, trackPx, 56)
  const ticks: number[] = []
  for (let t = 0; t <= extent; t += step) ticks.push(t)

  return (
    <div className="timeline" role="group" aria-label="Timeline">
      <div className="timeline-track" ref={trackRef}>
        <div className="timeline-elapsed" style={{ width: at(playhead) }} />
        <ol className="timeline-markers" aria-label="Events on the timeline">
          {markers.map((marker) => (
            <li key={marker.id} className={`timeline-marker status-${marker.sign}`} style={{ left: at(marker.time) }}
              title={`${formatClock(marker.time, false)} ${marker.title}${marker.detail ? ` · ${marker.detail}` : ''}`}>
              <span className="visually-hidden">{formatClock(marker.time, false)} {marker.title}{marker.detail ? `, ${marker.detail}` : ''}</span>
            </li>
          ))}
        </ol>
        <div className="timeline-playhead" style={{ left: at(playhead) }} />
        <input className="timeline-seek" type="range" min={0} max={extent} step="0.05" value={playhead}
          aria-label="Seek simulation time" aria-valuetext={formatClock(playhead)} disabled={disabled || recordedUntil === 0}
          onChange={(event) => change(Math.min(recordedUntil, Number(event.target.value)))}
          onPointerUp={commit} onKeyUp={commit} onBlur={commit} onPointerCancel={cancel} />
      </div>
      <ol className="timeline-ticks" aria-hidden="true">
        {ticks.map((t) => {
          const covered = Math.abs(((t - playhead) / extent) * trackPx) < 20
          const className = [t === extent ? 'is-end' : '', covered ? 'is-covered' : ''].filter(Boolean).join(' ') || undefined
          return <li key={t} className={className} style={{ left: at(t) }}>{formatClock(t, false)}</li>
        })}
      </ol>
      <form className="timeline-jump" onSubmit={(event) => {
        event.preventDefault()
        const time = Number(timeInput)
        if (timeInput.trim() && Number.isFinite(time) && time >= 0 && time <= recordedUntil) send(time)
      }}>
        <label htmlFor="seek-seconds">Go to second</label>
        <input id="seek-seconds" type="number" min={0} max={recordedUntil} step="any" value={timeInput}
          disabled={disabled} onChange={(event) => setTimeInput(event.target.value)} placeholder="e.g. 45.5" />
        <button type="submit" disabled={disabled || !timeInput.trim()}>Go</button>
      </form>
    </div>
  )
}
