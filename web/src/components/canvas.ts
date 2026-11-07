import { useEffect, useRef } from 'react'

export const PEOPLE_COLORS = ['#397b58', '#5c83b4', '#bf7586', '#769672', '#d3a16d', '#3e6558']
const SKIN = ['#d6a37c', '#9e6a4b', '#e6bc99', '#77513e']
export type Point = { x: number; y: number }

export function alongPath(points: Point[], phase: number): Point {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y))
  let distance = Math.max(0, Math.min(1, phase)) * lengths.reduce((sum, n) => sum + n, 0)
  for (let i = 0; i < lengths.length; i++) {
    if (distance <= lengths[i] || i === lengths.length - 1) {
      const amount = lengths[i] ? distance / lengths[i] : 0
      return { x: points[i].x + (points[i + 1].x - points[i].x) * amount, y: points[i].y + (points[i + 1].y - points[i].y) * amount }
    }
    distance -= lengths[i]
  }
  return points[0]
}

/** A small standing person with a head, torso, arms, and walking legs. */
export function drawPerson(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, index: number, time: number, walking = true) {
  const step = walking ? Math.sin(time * 6 + index * 1.7) : 0
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size, size)
  ctx.fillStyle = '#233d2918'
  ctx.beginPath(); ctx.ellipse(1, 1, 3.8, 1.6, -.2, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = '#405052'; ctx.lineWidth = 1.6; ctx.lineCap = 'round'
  ctx.beginPath(); ctx.moveTo(-1.25, -4); ctx.lineTo(-1.8 - step * 1.25, 0); ctx.moveTo(1.25, -4); ctx.lineTo(1.8 + step * 1.25, 0); ctx.stroke()
  ctx.strokeStyle = SKIN[index % SKIN.length]; ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(-2.5, -9); ctx.lineTo(-3.2 + step, -5.5); ctx.moveTo(2.5, -9); ctx.lineTo(3.2 - step, -5.5); ctx.stroke()
  ctx.fillStyle = PEOPLE_COLORS[index % PEOPLE_COLORS.length]
  ctx.beginPath(); ctx.roundRect(-2.6, -10, 5.2, 6.8, [2, 2, 1, 1]); ctx.fill()
  ctx.fillStyle = SKIN[index % SKIN.length]
  ctx.beginPath(); ctx.arc(0, -12.4, 2.2, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = index % 3 === 0 ? '#564639' : '#303c31'
  ctx.beginPath(); ctx.ellipse(-.2, -13.4, 2.15, 1.35, -.1, Math.PI, Math.PI * 2); ctx.fill()
  ctx.restore()
}

let sharedTime = 0
let sharedPrevious = 0
function advanceSharedTime(now: number) {
  if (sharedPrevious && !document.hidden) sharedTime += Math.min((now - sharedPrevious) / 1000, .05)
  sharedPrevious = now
}
type Paint = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number, reduced: boolean, flowTime: number) => void

export function useCanvas(paint: Paint, reduced: boolean, playing = true, reset = 0) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const current = useRef({ paint, playing, reduced })
  const redraw = useRef<(() => void) | null>(null)
  useEffect(() => {
    current.current = { paint, playing, reduced }
    redraw.current?.()
  }, [paint, playing, reduced])
  useEffect(() => {
    const element = canvas.current!
    const ctx = element.getContext('2d')!
    let width = 0; let height = 0; let frame = 0; let elapsed = 0; let previous = 0
    let visible = false
    const render = () => { ctx.clearRect(0, 0, width, height); current.current.paint(ctx, width, height, elapsed, current.current.reduced, sharedTime) }
    redraw.current = render
    const resize = () => {
      const bounds = element.getBoundingClientRect()
      width = bounds.width; height = bounds.height
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      element.width = Math.round(width * ratio); element.height = Math.round(height * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      render()
    }
    const tick = (now: number) => {
      advanceSharedTime(now)
      if (visible && !document.hidden && current.current.playing && !current.current.reduced) {
        if (previous) elapsed += Math.min((now - previous) / 1000, .05)
        render()
      }
      previous = now
      frame = requestAnimationFrame(tick)
    }
    const observer = new ResizeObserver(resize)
    const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting }, { rootMargin: '60px' })
    observer.observe(element); visibility.observe(element); resize()
    frame = requestAnimationFrame(tick)
    return () => { observer.disconnect(); visibility.disconnect(); cancelAnimationFrame(frame); redraw.current = null }
  }, [reset])
  return canvas
}
