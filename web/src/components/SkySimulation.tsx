import { useLayoutEffect, useRef } from 'react'

const CLOUDS = [
  { x: 65, y: 105, size: 1.05, speed: .9 },
  { x: 1260, y: 70, size: .9, speed: -.7 },
  { x: 68, y: 315, size: .6, speed: .6 },
  { x: 1320, y: 330, size: .57, speed: -.5 },
  { x: -100, y: 180, size: .28, speed: .4 },
  { x: 1500, y: 200, size: .25, speed: -.35 },
]
type Bird = { x: number; y: number; vx: number; vy: number; flock: number }

export function SkySimulation({ reduced }: { reduced: boolean }) {
  const svg = useRef<SVGSVGElement>(null)
  const clouds = useRef<(SVGGElement | null)[]>([])
  const birds = useRef<(SVGGElement | null)[]>([])
  const wings = useRef<(SVGPathElement | null)[]>([])
  useLayoutEffect(() => {
    const element = svg.current!
    let mobile = false, initialized = false, width = 1536, visible = true, frame = 0, previous = 0, time = 0
    const flock: Bird[] = Array.from({ length: 9 }, (_, i) => ({
      x: i < 3 ? 170 + i * 43 : 1205 + (i - 3) * 39,
      y: i < 3 ? 270 + i * 21 : 186 + (i - 3) * 24,
      vx: i < 3 ? 21 : -24, vy: Math.sin(i * 2.7) * 8, flock: i < 3 ? 0 : 1,
    }))
    const zone = (bird: Bird) => mobile
      ? { minX: bird.flock ? 1370 : 30, maxX: bird.flock ? 1500 : 160, minY: 290, maxY: 425 }
      : { minX: bird.flock ? 1230 : 65, maxX: bird.flock ? 1490 : 320, minY: 155, maxY: 395 }
    const draw = () => {
      CLOUDS.forEach((cloud, i) => {
        const x = mobile ? (i % 2 ? 1425 : -20) : cloud.x
        const size = mobile ? cloud.size * .72 : cloud.size
        // Wrap beyond the viewport so each cloud follows a steady horizontal wind.
        const span = 1536 + 197 * size + 80
        const drift = time * cloud.speed * 7
        const left = -197 * size - 40
        const horizontal = ((x + drift - left) % span + span) % span + left
        clouds.current[i]?.setAttribute('transform', `translate(${horizontal.toFixed(2)} ${cloud.y}) scale(${size})`)
      })
      const size = Math.max(.85, .48 / (width / 1536))
      flock.forEach((bird, i) => {
        const angle = Math.max(-15, Math.min(15, bird.vy * .6))
        birds.current[i]?.setAttribute('transform', `translate(${bird.x.toFixed(2)} ${bird.y.toFixed(2)}) rotate(${angle.toFixed(2)}) scale(${size.toFixed(3)})`)
        const flap = reduced ? -2 : Math.sin(time * (4.5 + i * .12) + i * 1.9) * 4
        wings.current[i]?.setAttribute('d', `M-9 ${flap.toFixed(2)}Q-4 ${(flap - 3).toFixed(2)} 0 0Q4 ${(flap - 3).toFixed(2)} 9 ${flap.toFixed(2)}`)
      })
    }
    const resize = () => {
      width = element.getBoundingClientRect().width
      const changed = mobile !== (width < 700)
      mobile = width < 700
      flock.forEach((bird, i) => {
        const bounds = zone(bird)
        if (!initialized || changed) {
          const index = i < 3 ? i : i - 3
          bird.x = bounds.minX + 20 + index % 3 * (bounds.maxX - bounds.minX - 40) / 2
          bird.y = bounds.minY + 25 + Math.floor(index / 3) * 35 + index % 2 * 15
        }
        bird.x = Math.max(bounds.minX + 15, Math.min(bounds.maxX - 15, bird.x))
        bird.y = Math.max(bounds.minY + 10, Math.min(bounds.maxY - 10, bird.y))
      })
      initialized = true
      draw()
    }
    const tick = (now: number) => {
      const dt = previous ? Math.min((now - previous) / 1000, .04) : 0
      previous = now
      if (visible && !document.hidden) {
        time += dt
        const next = flock.map((bird, i) => {
          let cohesionX = 0, cohesionY = 0, alignX = 0, alignY = 0, separateX = 0, separateY = 0, count = 0
          for (const other of flock) {
            if (other === bird || other.flock !== bird.flock) continue
            const dx = other.x - bird.x, dy = other.y - bird.y, distance = Math.hypot(dx, dy)
            if (distance < 140) { cohesionX += dx; cohesionY += dy; alignX += other.vx; alignY += other.vy; count++ }
            if (distance < 28) { separateX -= dx * (28 - distance) / 28; separateY -= dy * (28 - distance) / 28 }
          }
          const bounds = zone(bird)
          let ax = Math.sin(time * .32 + i * .7) * 3 + separateX * 1.4
          let ay = Math.cos(time * .27 + i * .8) * 3 + separateY * 1.4
          if (count) { ax += cohesionX / count * .055 + (alignX / count - bird.vx) * .3; ay += cohesionY / count * .055 + (alignY / count - bird.vy) * .3 }
          const margin = mobile ? 30 : 55
          if (bird.x < bounds.minX + margin) ax += (bounds.minX + margin - bird.x) * .6
          if (bird.x > bounds.maxX - margin) ax -= (bird.x - bounds.maxX + margin) * .6
          if (bird.y < bounds.minY + 35) ay += (bounds.minY + 35 - bird.y) * .6
          if (bird.y > bounds.maxY - 35) ay -= (bird.y - bounds.maxY + 35) * .6
          let vx = bird.vx + ax * dt, vy = bird.vy + ay * dt
          const speed = Math.hypot(vx, vy) || 1
          const target = Math.max(mobile ? 13 : 17, Math.min(mobile ? 25 : 35, speed))
          vx *= target / speed; vy *= target / speed
          return { ...bird, vx, vy, x: Math.max(bounds.minX, Math.min(bounds.maxX, bird.x + vx * dt)), y: Math.max(bounds.minY, Math.min(bounds.maxY, bird.y + vy * dt)) }
        })
        next.forEach((bird, i) => { flock[i] = bird })
        draw()
      }
      frame = requestAnimationFrame(tick)
    }
    const observer = new ResizeObserver(resize)
    const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting })
    observer.observe(element); visibility.observe(element); resize()
    if (!reduced) frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame); observer.disconnect(); visibility.disconnect() }
  }, [reduced])
  return <svg ref={svg} className="sky-simulation" viewBox="0 0 1536 460" preserveAspectRatio="none" aria-hidden="true">
    {CLOUDS.map((cloud, i) => <g key={i} ref={element => { clouds.current[i] = element }} data-sky-cloud transform={`translate(${cloud.x} ${cloud.y}) scale(${cloud.size})`}>
      <path d="M0 60h18V38h28V17h33V0h34v23h31v19h29v18h24v18H0Z" fill="#e8eef0" />
      <path d="M29 48V26h28V8h32v28h30v22h40v19H14V58Z" fill="#d4e5ed" />
      <path d="M102 22h25v20h27v18h26v17h-70V58H88V39h14Z" fill="#f2e1df" />
      <path d="M0 63h34V49h28v12h38V48h31v15h39v-6h27v21H0Z" fill="#c7dce8" />
    </g>)}
    {Array.from({ length: 9 }, (_, i) => <g key={i} ref={element => { birds.current[i] = element }} data-sky-bird>
      <path ref={element => { wings.current[i] = element }} d="M-9 -2Q-4 -5 0 0Q4 -5 9 -2" fill="none" stroke={i % 3 ? '#52756b' : '#365e50'} strokeWidth="1.8" strokeLinecap="round" />
    </g>)}
  </svg>
}
