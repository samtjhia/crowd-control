import { useEffect, useRef, useState } from 'react'

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={diagonal ? 'M6 18 18 6M6 6h12v12' : 'M4 12h15m-6-6 6 6-6 6'} /></svg>
}

function SchoolPlan({ progress, reduced }: { progress: number; reduced: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const motion = useRef({ progress, reduced })
  useEffect(() => { motion.current = { progress, reduced } }, [progress, reduced])
  useEffect(() => {
    const element = canvas.current!
    const context = element.getContext('2d')!
    let frame = 0
    let width = 0
    let height = 0
    const resize = () => {
      const bounds = element.getBoundingClientRect()
      width = bounds.width; height = bounds.height
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      element.width = width * ratio; element.height = height * ratio
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    const rooms = [
      { x: 140, y: 130, w: 170, h: 130, label: 'CLASSROOM 01' },
      { x: 330, y: 130, w: 170, h: 130, label: 'CLASSROOM 02' },
      { x: 520, y: 130, w: 210, h: 130, label: 'SCIENCE LAB' },
      { x: 140, y: 340, w: 170, h: 160, label: 'LIBRARY' },
      { x: 330, y: 340, w: 170, h: 160, label: 'CLASSROOM 03' },
      { x: 520, y: 340, w: 210, h: 160, label: 'ASSEMBLY HALL' },
    ]
    const draw = (time: number) => {
      context.clearRect(0, 0, width, height)
      const { progress: p, reduced: still } = motion.current
      const scale = Math.min(width / 870, height / 650) * (still ? 1 : 1 + p * 1.15)
      context.save()
      context.translate(width / 2, height / 2)
      context.scale(scale, scale)
      context.translate(-435 - p * 65, -315)
      context.strokeStyle = '#213c35'; context.lineWidth = .6
      for (let x = 30; x < 860; x += 25) { context.beginPath(); context.moveTo(x, 50); context.lineTo(x, 580); context.stroke() }
      for (let y = 55; y < 590; y += 25) { context.beginPath(); context.moveTo(30, y); context.lineTo(855, y); context.stroke() }
      context.fillStyle = '#142c25'; context.fillRect(120, 110, 630, 410)
      context.fillStyle = '#254337'; context.fillRect(140, 270, 590, 60)
      for (const room of rooms) {
        context.fillStyle = '#1a322a'; context.fillRect(room.x, room.y, room.w, room.h)
        context.strokeStyle = '#89a58c'; context.lineWidth = 3; context.strokeRect(room.x, room.y, room.w, room.h)
        const doorX = room.x + room.w / 2
        const doorY = room.y < 300 ? room.y + room.h : room.y
        context.strokeStyle = '#142c25'; context.lineWidth = 5; context.beginPath(); context.moveTo(doorX - 13, doorY); context.lineTo(doorX + 13, doorY); context.stroke()
        context.fillStyle = '#99ae9b'; context.font = '9px monospace'; context.textAlign = 'center'; context.fillText(room.label, room.x + room.w / 2, room.y + 22)
        if (room.label.includes('CLASSROOM') || room.label.includes('SCIENCE')) {
          context.strokeStyle = '#3c5747'; context.lineWidth = 1
          for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) context.strokeRect(room.x + 28 + i * 43, room.y + 45 + j * 22, 22, 12)
        } else if (room.label === 'LIBRARY') {
          context.fillStyle = '#304a39'; for (let i = 0; i < 4; i++) context.fillRect(room.x + 25 + i * 33, room.y + 45, 12, 85)
        } else {
          context.strokeStyle = '#405b46'; context.strokeRect(room.x + 30, room.y + 45, 150, 85)
          context.beginPath(); context.arc(room.x + 105, room.y + 87, 25, 0, Math.PI * 2); context.stroke()
        }
      }
      context.strokeStyle = '#b9c9a4'; context.lineWidth = 4; context.strokeRect(120, 110, 630, 410)
      context.strokeStyle = '#142c25'; context.lineWidth = 7
      for (const x of [120, 750]) { context.beginPath(); context.moveTo(x, 280); context.lineTo(x, 320); context.stroke() }
      context.strokeStyle = '#d8f392'; context.lineWidth = 1.5
      for (const x of [85, 770]) { context.beginPath(); context.moveTo(x, 300); context.lineTo(x + 25, 300); context.moveTo(x + 18, 294); context.lineTo(x + 25, 300); context.lineTo(x + 18, 306); context.stroke() }
      context.fillStyle = '#d8f392'; context.font = '10px monospace'; context.fillText('WEST EXIT', 78, 340); context.fillText('EAST EXIT', 790, 340)
      const t = still ? 4 : time / 1000
      for (let i = 0; i < 160; i++) {
        const room = rooms[i % rooms.length]
        const phase = ((t * .045 + i * .137) % 1)
        const startX = room.x + 24 + ((i * 37) % (room.w - 48))
        const startY = room.y + 42 + ((i * 19) % (room.h - 60))
        const exitX = i % 3 === 0 ? 95 : 780
        const x = phase < .4 ? startX + (room.x + room.w / 2 - startX) * phase / .4 : room.x + room.w / 2 + (exitX - room.x - room.w / 2) * (phase - .4) / .6
        const y = phase < .4 ? startY + (300 - startY) * phase / .4 : 290 + (i % 6) * 4
        context.fillStyle = i % 7 === 0 ? '#e5b77a' : '#c8da9c'
        context.beginPath(); context.arc(x, y, 2.2, 0, Math.PI * 2); context.fill()
      }
      context.strokeStyle = '#64816b'; context.lineWidth = .8
      context.beginPath(); context.moveTo(120, 555); context.lineTo(750, 555); context.moveTo(120, 550); context.lineTo(120, 560); context.moveTo(750, 550); context.lineTo(750, 560); context.stroke()
      context.fillStyle = '#8ba48c'; context.font = '10px monospace'; context.fillText('NORTH WING / GROUND FLOOR', 435, 585)
      context.restore()
      if (!still) frame = requestAnimationFrame(draw)
    }
    resize(); frame = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [reduced])
  return <canvas ref={canvas} className="school-canvas" role="img" aria-label="Animated architectural school floor plan showing illustrative crowd movement toward two exits" />
}

function App() {
  const [progress, setProgress] = useState(0)
  const [reduced, setReduced] = useState(false)
  const [demo, setDemo] = useState(false)
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updatePreference = () => setReduced(preference.matches)
    const scroll = () => setProgress(Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 1.2))))
    updatePreference(); scroll()
    preference.addEventListener('change', updatePreference)
    window.addEventListener('scroll', scroll, { passive: true })
    return () => { preference.removeEventListener('change', updatePreference); window.removeEventListener('scroll', scroll) }
  }, [])
  const enter = () => { setDemo(true); document.getElementById('inside')?.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth' }) }
  return <>
    <header className="navigation">
      <a className="wordmark" href="#" aria-label="Crowd Control home"><span className="brand-symbol"><i /><i /><i /><i /></span>Crowd Control<span className="brand-period">.</span></a>
      <nav aria-label="Main navigation"><a href="#inside" className="explore-link">The experiment</a><button onClick={enter}>Explore the demo <Arrow diagonal /></button></nav>
    </header>
    <main>
      <section className="experience" aria-label="Crowd Control introduction">
        <div className="stage">
          <div className="hero-copy" style={{ opacity: reduced ? 1 : Math.max(0, 1 - progress * 2.5), transform: reduced ? undefined : `translateY(${-progress * 70}px)`, visibility: progress > .55 && !reduced ? 'hidden' : 'visible' }}>
            <h1>One crowd.<br />A thousand<br /><em>what-ifs.</em></h1>
            <p>A space. A crowd. A simple question.<br />See how people move—and what happens<br className="desktop-break" /> when you change the plan.</p>
            <button className="primary-button" onClick={enter}>Step inside <Arrow /></button>
            <span className="hero-note">A crowd simulation you can talk to.</span>
          </div>
          <div className="plan-container" style={{ transform: reduced ? undefined : `translateX(${-progress * 18}%)` }}>
            <div className="plan-heading"><span><span className="status-dot" /> SCHOOL EVACUATION</span><span>VISUAL DEMO</span></div>
            <SchoolPlan progress={progress} reduced={reduced} />
            <div className="plan-footer"><span>Every dot is a person.<br />Every decision changes their path.</span><span className="compass">N ↑</span></div>
          </div>
          <div className="interior-caption" style={{ opacity: Math.max(0, (progress - .55) / .45), visibility: progress < .55 ? 'hidden' : 'visible' }}><span className="status-dot" /><p>Same school.<br /><strong>Different possibilities.</strong></p></div>
          <div className="stage-bottom"><span>BUILT AT HACKTRENT 2026</span><a href="#inside">Scroll to explore <span>↓</span></a><span>PLANNING STARTS WITH CURIOSITY</span></div>
          <div className="scroll-track"><span style={{ transform: `scaleX(${progress})` }} /></div>
        </div>
      </section>
      <section className="inside" id="inside">
        <div><span className="section-mark" aria-hidden="true">↳</span><h2>What happens when<br />the plan changes?</h2></div>
        <div className="inside-copy"><p>Start with a school. Fill the corridors. Then ask a question that changes everything.</p><div className="scenario-prompt"><span className="prompt-dot" /><span>“What if the east exit closes?”</span><Arrow /></div><p className="prototype-note" role="status">{demo ? 'You’re viewing the landing-page prototype. The interactive simulation is not connected yet.' : 'An opening experiment. Blocked-exit and replay scenes are coming next.'}</p><button className="text-button" onClick={() => window.scrollTo({ top: 0, behavior: reduced ? 'instant' : 'smooth' })}>Back to the school <span>↑</span></button></div>
      </section>
    </main>
    <footer><a className="wordmark" href="#">Crowd Control.</a><span>Ask a better what-if.</span><span>Planning estimates. Not certified safety analysis.</span></footer>
  </>
}

export default App
