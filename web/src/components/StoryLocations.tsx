import { EnvironmentalDisplay } from './EnvironmentalDisplay'
import { Tree, Shrubs } from './CampusPlaza'
import { alongPath, drawPerson, useCanvas } from './canvas'
import { Icon } from './Icons'
import { GARDEN_ROUTES } from './gardenRoutes'

function Bench({ x, y }: { x: number; y: number }) {
  return <g transform={`translate(${x} ${y})`}><path d="m0 0 59-11 29 9-60 13Z" fill="#dcc49b" /><path d="m0 0 28 11v5L0 5Zm28 11 60-13v5l-60 13Z" fill="#c2a884" /><path d="M10 8v13m65-16v12" stroke="#a59375" strokeWidth="4" /></g>
}

function Planter({ x, y, width = 110, pink = false }: { x: number; y: number; width?: number; pink?: boolean }) {
  return <g transform={`translate(${x} ${y})`}>
    <path d={`M0 0 ${width}-17l39 13-${width} 22Z`} fill="#fffaf0" />
    <path d={`M0 0v25l39 18V18Z`} fill="#e7dfcd" /><path d={`M39 18 ${width + 39}-4v25L39 43Z`} fill="#d8d6bf" />
    <Shrubs x={35} y={-4} scale={.7} /><Shrubs x={width - 20} y={-14} scale={.7} />
    {pink && <g fill="#e8bfc2"><ellipse cx={width / 2} cy="-10" rx="12" ry="8" /><ellipse cx={width / 2 + 15} cy="-14" rx="10" ry="7" /></g>}
  </g>
}

function Lamp({ x, y }: { x: number; y: number }) {
  return <g transform={`translate(${x} ${y})`}><ellipse rx="9" ry="4" fill="#d9dfcb" /><path d="M0 0v-76q0-11 12-11h14" fill="none" stroke="#6c8b77" strokeWidth="3" /><path d="M16-87h20" stroke="#75917c" strokeWidth="7" /><path d="M18-84h16" stroke="#f3dc9f" strokeWidth="3" /></g>
}


function LocationResidents({ reduced, garden = false }: { reduced: boolean; garden?: boolean }) {
  const canvas = useCanvas((ctx, width, height, time, still) => {
    const scale = Math.min(width / 700, height / 450)
    ctx.save(); ctx.scale(scale, scale)
    const residents = garden ? [[2, 243, 339], [8, 257, 345], [12, 83, 383], [24, 99, 388]] : [[5, 473, 355], [13, 487, 362], [19, 558, 350], [22, 250, 355], [26, 266, 357]]
    for (const [i, x, y] of residents) drawPerson(ctx, x, y, 1.13, i, 0, false)
    if (garden) {
      GARDEN_ROUTES.forEach((route, index) => {
        for (let i = 0; i < 4; i++) {
          const phase = still ? (i + .4) / 4 : (time * (index ? .021 : .018) + i / 4) % 1
          const point = alongPath(route, phase)
          drawPerson(ctx, point.x, point.y, 1.1, i + index * 13 + 60, time * (index ? 1.04 : .92), !still)
        }
      })
    } else {
      for (let i = 0; i < 4; i++) {
        const phase = still ? i / 4 : (time * (.019 + i * .001) + i / 4) % 1
        drawPerson(ctx, 180 + phase * 400, 435 - phase * 8, 1.13, i + 60, time, !still)
      }
    }
    ctx.restore()
  }, reduced, true)
  return <canvas ref={canvas} className="location-residents" aria-hidden="true" />
}

function StationDisplay({ compact = false }: { compact?: boolean }) {
  const height = compact ? 165 : 223
  return <g className={compact ? 'station-display-desktop' : 'station-display-mobile'}>
    <path d="M119 119 448 91l8 6-329 28Z" fill="#7f9b85" />
    <path d={`M119 119 127 125v${height}l-8-6Z`} fill="#6c8875" />
    <path className="station-headline-face" d={`m127 125 329-28v${height}l-329 27Z`} fill="#fbf5e8" />
    <path d="m127 125 329-28v12l-329 28Z" fill="#648472" />
    <path d={`M150 ${125 + height}v28m285-52v28`} stroke="#7d957f" strokeWidth="7" />
  </g>
}

function OperationsArtwork() {
  return <svg className="location-art" viewBox="0 0 700 450" aria-hidden="true">
    {/* A modest waiting shelter and a freestanding station information display. */}
    <Tree x={625} y={193} scale={.88} /><Tree x={59} y={281} scale={.8} />
    {/* Ground is painted before every raised object. */}
    <path className="shelter-paving" d="m393 353 242-42m-218 65 228-41" stroke="#e1dfcd" strokeWidth="2" />
    {/* Glazing and supports meet the roof underside, not its top surface. */}
    <path className="shelter-glass" d="M405 184.422 484 209v145l-79-24.578Z" fill="#d2e1d4" opacity=".55" />
    <path className="shelter-glass" d="M484 209 650 179.594v145L484 354Z" fill="#d2e1d4" opacity=".7" />
    <path className="shelter-post" d="M405 184.422v145" stroke="#90ac9a" strokeWidth="4" />
    {[484, 539, 595, 650].map(x => <path key={x} className="shelter-post" d={`M${x} ${209 - (x - 484) * 31 / 175}v145`} stroke="#90ac9a" strokeWidth="4" />)}
    <path d="m394 172 172-27 93 24-175 31Z" fill="#fdf8eb" />
    <path className="shelter-roof-return" d="M394 172 484 200 659 169V178L484 209 394 181Z" fill="#c4cfbd" />
    <path d="m409 177 156-23 69 17-150 27Z" fill="#c3d8d4" />
    <path d="m448 172 67 20m-21-27 67 20m-23-26 65 19" stroke="#ecf1e4" strokeWidth="3" />
    <Bench x={457} y={311} /><Bench x={546} y={298} />
    <path d="m495 209 35-6.2m52-9.2 38-6.7" stroke="#f7e6b7" strokeWidth="4" />
    {/* Smaller display, clearly separate from the transparent shelter. */}
    <StationDisplay compact /><StationDisplay />
    <Planter x={48} y={330} width={72} pink /><Planter x={550} y={345} width={70} />
    <Bench x={286} y={391} /><Lamp x={648} y={380} />
    <path d="M208 396h18v-24h-18Z" fill="#8ca38c" /><ellipse cx="217" cy="372" rx="9" ry="3" fill="#6f8977" />
  </svg>
}

function GardenArtwork() {
  return <svg className="location-art" viewBox="0 0 700 450" aria-hidden="true">
    {/* An open experimental garden, not a third roof-and-facade building. */}
    <path d="M33 302Q95 246 205 269T380 301Q421 349 350 395T121 399Q39 389 33 302Z" fill="#e2ebce" />
    <Tree x={62} y={244} scale={.95} /><Tree x={625} y={258} scale={.75} /><Tree x={335} y={341} scale={.56} />
    <path className="garden-pond" d="M405 310C433 283 510 284 550 311S606 347 579 367 501 370 469 355 406 342 405 310Z" fill="#bddbdd" />
    <path d="M417 313C448 296 503 299 538 320S588 348 567 355 506 354 480 342 430 333 417 313Z" fill="#cde4df" />
    <path d="m448 318 16-7 15 6-13 8Zm101 33 13-6 12 5-12 7Z" fill="#dce8bc" />
    {GARDEN_ROUTES.map((route, index) => <polyline className="garden-route" key={index} points={route.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#fcf2e5" strokeWidth="25" strokeLinejoin="round" strokeLinecap="round" />)}
    {/* A timber footbridge takes the scenic branch across the pond. */}
    <path className="garden-bridge" d="m500 296 28-17 51 93-30 18Z" fill="#cfb28a" /><path d="m500 296 49 94v6l-49-94Zm49 94 30-18v6l-30 18Z" fill="#b49a77" />
    <path d="m517 305 22-12m-16 24 22-12m-16 24 22-12m-16 24 22-12m-16 24 22-12" stroke="#e4ccaa" strokeWidth="3" />
    <path d="m500 289 49 94m-21-111 51 93" stroke="#a99374" strokeWidth="2" />
    {/* A low planted wall carries the original headline at garden scale. */}
    <path d="M97 111Q278 72 475 108v151Q282 223 97 265Z" fill="#ded7c2" />
    <path className="garden-headline-face" d="M108 103Q287 66 486 100v151Q286 217 108 257Z" fill="#faf2e2" />
    <path d="M108 103Q287 66 486 100l-11-9Q280 54 97 94Z" fill="#fffcf2" />
    <path d="M108 232q184-30 378-3v22q-200-33-378 6Z" fill="#e4ebd0" />
    <Planter x={91} y={276} width={89} pink /><Planter x={420} y={220} width={68} pink />
    <Bench x={83} y={348} /><Bench x={270} y={426} /><Lamp x={662} y={381} />
    <Shrubs x={655} y={335} scale={.65} /><Shrubs x={205} y={420} scale={.9} />
  </svg>
}

export function OperationsPavilion({ reduced }: { reduced: boolean }) {
  return <article className="story-stop stop-two operations-location" aria-labelledby="operations-title">
    <div className="story-building operations-building"><OperationsArtwork /><LocationResidents reduced={reduced} /><h2 id="operations-title"><span className="heading-plane">You ask the question.<br /><span className="heading-accent">We handle the moving parts.</span></span></h2></div>
    <div className="location-copy operations-copy embedded-copy"><EnvironmentalDisplay kind="station"><p>From setting up a space to routing its crowd, the system handles the heavy work. You stay focused on what you want to find out.</p><div className="process-wayfinding"><ul className="plain-checks"><li>Describe a space and a scenario</li><li>Review the proposed changes</li><li>Watch the crowd respond</li></ul></div></EnvironmentalDisplay></div>
  </article>
}

export function DecisionGarden({ reduced }: { reduced: boolean }) {
  return <article className="story-stop stop-three garden-location" aria-labelledby="garden-title">
    <div className="story-building garden-building"><GardenArtwork /><LocationResidents reduced={reduced} garden /><h2 id="garden-title"><span className="heading-plane">A small change.<br /><span className="heading-accent">A different story.</span></span></h2></div>
    <div className="location-copy garden-copy embedded-copy"><EnvironmentalDisplay kind="garden"><p>Close a door. Add a check-in desk. Make a street one-way. Explore how one decision changes the way people move.</p><p>And when a plan needs another look? Edit an earlier intervention and replay the possibilities.</p><a className="text-link" href="#scenarios">Let’s try a few <Icon name="arrow" size={17} /></a></EnvironmentalDisplay></div>
  </article>
}
