import { EnvironmentalDisplay } from './EnvironmentalDisplay'
import { drawPerson, useCanvas } from './canvas'

export function Tree({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <ellipse cy="5" rx="31" ry="10" fill="#c2d1a7" opacity=".6" />
    <path d="M-4-41V4l9 3v-48" fill="#ab9476" />
    <path d="m-29-72 28-13 32 12-28 15Z" fill="#d1df9d" />
    <path d="m-29-72 32 14v33l-32-14Z" fill="#adc677" />
    <path d="m3-58 28-15v34L3-25Z" fill="#98b66a" />
    <path d="m-13-93 22-10 25 9-23 12Z" fill="#dce7b2" />
    <path d="m-13-93 24 11v23l-24-10Z" fill="#bed58d" />
    <path d="m11-82 23-12v22L11-59Z" fill="#aac77a" />
  </g>
}

export function Shrubs({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <path d="m-28 0 2-14 10-7 13 6 8-15 16-1 13 15 15 2 6 17Z" fill="#b4ca83" />
    <path d="m-26-14 10-7 13 6 8-15 16-1-5 12-11 7-8 11-17-4Z" fill="#cfdda2" />
    <path d="m6-12 10-7 17 3 15 2 6 17H6Z" fill="#9ebc76" />
  </g>
}

function PlazaArtwork() {
  return <svg className="plaza-artwork" viewBox="0 0 700 450" aria-hidden="true">
    <g transform="translate(20 24) scale(.82)">
    {/* Rear hall, roof and skylights. */}
    <path d="m60 66 300-40 255 55-305 42Z" fill="#fffcf4" />
    <path d="m60 66 250 57v168L60 230Z" fill="#e6dfce" />
    <path d="m310 123 305-42v169l-305 41Z" fill="#eee7d8" />
    <path d="m60 66 300-40 255 55v10L310 134 60 77Z" fill="#d6d9cc" />
    <path d="m111 65 245-29 189 42-236 31Z" fill="#f7f8ed" />
    <path d="m167 65 187-22 133 29-180 24Z" fill="#b7d0d0" />
    <path d="m206 60 135 30m-86-37 134 31m-86-36 133 28m-241 1 191-24" stroke="#edf1e5" strokeWidth="4" />
    {/* West wing, with a small architectural identity mark. */}
    <path d="m40 142 118-21v154L40 299Z" fill="#f7efdf" />
    <path d="m40 142 118-21-11-8-107 18Z" fill="#fffdf5" />
    <path d="m158 121 17 9v144l-17 1Z" fill="#ded6c4" />
    <g transform="translate(99 186) rotate(-12)" fill="#527660">
      <rect width="5" height="19" rx="2" /><rect x="12" y="-5" width="5" height="19" rx="2" fill="#a0b27e" /><rect x="24" y="-10" width="5" height="19" rx="2" fill="#99bac5" />
      <circle cx="2.5" cy="-6" r="3" /><circle cx="14.5" cy="-11" r="3" fill="#a0b27e" /><circle cx="26.5" cy="-16" r="3" fill="#99bac5" />
      <rect y="24" width="5" height="17" rx="2" fill="#c898a0" /><rect x="12" y="19" width="5" height="17" rx="2" fill="#a0b27e" /><rect x="24" y="14" width="5" height="17" rx="2" />
    </g>
    {/* Glass entrance below the headline-bearing facade. */}
    <path d="M202 218 622 186v122l-420 33Z" fill="#a9c8c5" />
    <path d="m209 229 403-31v101l-403 31Z" fill="#bad3cb" />
    <path d="m236 225 70-5v104l-70 5Zm169-13 62-5v102l-62 5Z" fill="#dce6d5" opacity=".6" />
    <path d="M246 225v101m52-105v101m52-105v101m52-105v101m52-105v101m52-105v101m52-105v101" stroke="#7eaaa2" strokeWidth="3" />
    <path d="m353 216 53-4v105l-53 4Z" fill="#89b0a7" /><path d="M380 216v102" stroke="#dde7d6" strokeWidth="2" />
    {/* Headline is selectable HTML positioned on this broad cream face. */}
    <path d="m180 100 438-34 23 13-439 35Z" fill="#fffdf7" />
    <path d="M180 100 202 114v135l-22-13Z" fill="#e6ddca" />
    <path className="campus-headline-face" d="m202 114 439-35v135l-439 35Z" fill="#f7efdf" />
    <path d="m202 246 439-35v8l-439 35Z" fill="#e6dbc4" />
    {/* Broad shallow steps and a paved landing. */}
    <path d="m187 330 440-34 28 15-441 35Z" fill="#fffaf0" />
    <path d="m214 346 441-35v7l-441 35Z" fill="#d9d0bd" />
    <path d="m176 345 467-31 24 14-467 35Z" fill="#fffaf0" />
    <path d="m200 363 467-35v7l-467 36Z" fill="#ddd5c3" />
    <path d="m164 362 491-29 24 14-491 36Z" fill="#fffaf0" />
    <path d="m188 383 491-36v8l-491 36Z" fill="#dfd7c5" />
    {/* Retaining planters keep greenery off the pedestrian surface. */}
    <path d="m8 307 118-26 72 23-116 29Z" fill="#fdf9ee" /><path d="m8 307 74 26v29L8 337Z" fill="#e9e0cd" /><path d="m82 333 116-29v29L82 362Z" fill="#d9d4bc" />
    <Shrubs x={58} y={310} scale={.8} /><Shrubs x={118} y={299} scale={.8} />
    <path d="m534 289 96-17 58 20-98 22Z" fill="#fffaf0" /><path d="m534 289 56 25v26l-56-23Z" fill="#e9e0cd" /><path d="m590 314 98-22v25l-98 23Z" fill="#d9d4bc" />
    <Shrubs x={575} y={291} scale={.7} /><Shrubs x={629} y={283} scale={.7} />
    <Tree x={34} y={199} scale={.72} /><Tree x={660} y={239} scale={.72} /><Tree x={672} y={105} scale={.65} />
    <path d="m470 400 66-13 27 10-67 15Z" fill="#d1b68b" /><path d="M482 406v13m66-18v12" stroke="#ad997a" strokeWidth="4" />
    <g transform="translate(628 374)" fill="none" stroke="#628575" strokeWidth="3"><path d="M0 0v-66q0-12 13-12h12" /><path d="M17-78h20" strokeWidth="6" /></g>
    </g>
    <Tree x={58} y={350} scale={.82} /><Shrubs x={91} y={359} scale={.85} />
    <path d="m471 355 111-20 36 14-112 24Z" fill="#fff8e9" /><path d="m506 373 112-24v17l-112 25Z" fill="#dbd7c1" />
    <Shrubs x={527} y={347} scale={.7} /><Shrubs x={579} y={339} scale={.7} />
    <path d="m180 399 65-13 29 10-66 14Z" fill="#dcc59c" /><path d="M192 405v13m65-13v12" stroke="#ad997b" strokeWidth="4" />
  </svg>
}

function PlazaResidents({ reduced }: { reduced: boolean }) {
  const canvas = useCanvas((ctx, width, height, time, still) => {
    const scale = Math.min(width / 700, height / 450)
    ctx.save(); ctx.scale(scale, scale); ctx.translate(20, 24); ctx.scale(.82, .82)
    // Residents wait on the upper landing; walkers stay on the level plaza.
    for (const [i, x, y] of [[2, 327, 330], [7, 398, 324], [16, 438, 322], [22, 116, 377], [25, 130, 381]]) drawPerson(ctx, x, y, 1.1, i, 0, false)
    for (let i = 0; i < 3; i++) {
      const phase = (still ? i / 3 : (time * .025 + i / 3) % 1)
      const x = 240 + phase * 350
      drawPerson(ctx, x, 445 - phase * 5, 1.1, i + 40, time, !still)
    }
    ctx.restore()
  }, reduced, true)
  return <canvas className="plaza-residents" ref={canvas} aria-hidden="true" />
}

function KioskVisitors() {
  const canvas = useCanvas((ctx, width, height) => {
    drawPerson(ctx, 19, height - 5, .86, 74, 0, false)
    drawPerson(ctx, width - 24, height - 2, .86, 81, 0, false)
  }, true, false)
  return <canvas className="kiosk-visitors" ref={canvas} aria-hidden="true" />
}

export function CampusPlaza({ reduced }: { reduced: boolean }) {
  return <article className="story-stop stop-one campus-plaza" aria-labelledby="plaza-title">
    <div className="plaza-building story-building">
      <PlazaArtwork /><PlazaResidents reduced={reduced} />
      <h2 id="plaza-title"><span className="heading-plane">Big Possibilities.<br /><span className="heading-accent">Little Effort.</span></span></h2>
    </div>
    <div className="plaza-copy embedded-copy">
      <EnvironmentalDisplay kind="shelter"><p><strong>Start with a scenario.</strong></p>
      <p>Tell us who's there, where they are, and what happens. Crowd Control brings your idea to life in a simulation you can explore.</p></EnvironmentalDisplay>
      <div className="plaza-kiosk"><EnvironmentalDisplay kind="example"><div className="example-prompt"><span className="prompt-avatar">EXAMPLE PROMPT</span><span>&quot;Simulate a fire drill with 100 students in a school.&quot;</span></div></EnvironmentalDisplay><KioskVisitors /></div>
    </div>
  </article>
}
