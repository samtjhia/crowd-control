import { Tree, Shrubs } from './CampusPlaza'
import { drawPerson, useCanvas } from './canvas'
import { Icon } from './Icons'

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
    const residents = garden ? [[2, 230, 338], [8, 245, 341], [12, 495, 352], [24, 168, 379], [31, 442, 394]] : [[5, 207, 354], [13, 664, 337], [19, 675, 346], [22, 145, 388], [26, 163, 391]]
    for (const [i, x, y] of residents) drawPerson(ctx, x, y, 1.1, i, 0, false)
    for (let i = 0; i < 4; i++) {
      const phase = still ? i / 4 : (time * .023 + i / 4) % 1
      const x = (garden ? 290 : 230) + phase * 270
      drawPerson(ctx, x, 411 - phase * 15, 1.1, i + 60, time, !still)
    }
    ctx.restore()
  }, reduced, true)
  return <canvas ref={canvas} className="location-residents" aria-hidden="true" />
}

function OperationsArtwork() {
  return <svg className="location-art" viewBox="0 0 700 450" aria-hidden="true">
    {/* A wide transit-style canopy, backed by a working glass pavilion. */}
    <Tree x={542} y={109} scale={.85} /><Tree x={630} y={164} scale={.7} />
    <path d="m146 139 444-43 44 38-443 50Z" fill="#f9f5e9" />
    <path d="m191 184 443-50v180l-443 49Z" fill="#b8cebf" />
    <path d="m222 183 377-42v166l-377 44Z" fill="#c6d9c9" />
    <path d="m250 181 67-7v166l-67 8Zm191-22 62-7v165l-62 7Z" fill="#dce5cd" opacity=".7" />
    <path d="M252 180v165m61-173v165m61-173v165m61-173v165m61-173v165m61-173v165" stroke="#8dac9b" strokeWidth="3" />
    <path d="m74 108 395-69 213 54q28 9 8 24L290 186 67 132q-29-13 7-24Z" fill="#f9f4e5" />
    <path d="m68 130 223 51 399-68v13L292 195 68 143Z" fill="#d8d4c1" />
    <path d="m117 107 352-57 160 41-340 58Z" fill="#d6e0d5" />
    <path d="m159 108 309-49 116 29-296 50Z" fill="#b9d0d0" />
    <path d="m210 100 114 31m-42-43 113 31m-41-43 113 31m-43-43 112 31m-370 23 311-51" stroke="#edf0e2" strokeWidth="4" />
    <path d="M112 153v208m526-213v167" stroke="#b5bea3" strokeWidth="8" />
    <path d="m116 156 44 47m474-51-41 52" stroke="#dfd6bd" strokeWidth="10" />
    <path d="m136 165 58 13m383-12 37-6" stroke="#f9e6b2" strokeWidth="5" />
    {/* The large architectural display carries the existing HTML heading. */}
    <path d="m212 177 414-36 14 9-414 38Z" fill="#fffcf5" />
    <path d="M212 177 226 188v177l-14-8Z" fill="#dfd6c3" />
    <path d="m226 188 414-38v177l-414 38Z" fill="#fbf4e7" />
    <path d="m226 188 414-38v32l-414 38Z" fill="#648472" />
    <path d="M245 364v16m347-70v18" stroke="#94a78b" strokeWidth="6" />
    <Planter x={478} y={365} width={120} pink /><Planter x={72} y={345} width={84} />
    <Bench x={333} y={387} /><Bench x={535} y={374} />
    <Tree x={54} y={313} scale={.82} /><Lamp x={39} y={377} />
    <path d="M125 412h20v-28h-20Z" fill="#8ca38c" /><ellipse cx="135" cy="384" rx="10" ry="4" fill="#6f8977" />
    <path d="m177 368 350-36 58 14-349 40Z" fill="#fffcf2" /><path d="m236 386 349-40v7l-349 40Z" fill="#ded8c5" />
  </svg>
}

function GardenArtwork() {
  return <svg className="location-art" viewBox="0 0 700 450" aria-hidden="true">
    {/* An open garden pavilion, with a curved wall and stepped courtyard. */}
    <Tree x={81} y={205} scale={1} /><Tree x={575} y={133} scale={.8} /><Tree x={648} y={222} scale={.66} />
    <path d="M26 121 387 38 651 89 284 176Z" fill="#fffaf0" />
    <path d="m26 121 258 55 367-87v13l-367 87-258-55Z" fill="#d8d2be" />
    <path d="m63 119 321-70 208 40-309 72Z" fill="#e9ecdc" />
    <path d="M78 144v170m514-200v159" stroke="#b4bea0" strokeWidth="7" />
    <path d="M107 165 557 99v197l-450 70Z" fill="#b9d2c1" />
    <path d="M148 159v199m69-207v194m69-205v195m69-205v195m69-205v195m69-205v195" stroke="#8fae9d" strokeWidth="3" />
    <path d="m118 172 38 7m290-52 43-6" stroke="#f8e7b6" strokeWidth="5" />
    {/* Curved architectural sign; the type stays flat and selectable. */}
    <path d="M187 160Q393 96 616 158v175Q405 269 187 340Z" fill="#e2d8c2" />
    <path d="M199 153Q402 95 625 151v175Q408 268 199 333Z" fill="#faf2e2" />
    <path d="M199 153Q402 95 625 151l-9-11Q397 83 187 145Z" fill="#fffdf5" />
    <path d="M199 294q198-45 426 6v26q-217-58-426 7Z" fill="#e4ebcf" />
    {/* Shallow amphitheatre terraces retain their open centre. */}
    <path d="M122 354Q352 286 590 354l25 17Q358 304 137 375Z" fill="#fef9ed" />
    <path d="M137 375Q358 304 615 371v9Q359 313 137 384Z" fill="#ded5c0" />
    <path d="M109 378Q351 311 620 384l21 18Q359 330 123 399Z" fill="#fdf8ec" />
    <path d="M123 399Q359 330 641 402v8Q359 339 123 408Z" fill="#dfd8c4" />
    <Planter x={34} y={306} width={99} pink /><Planter x={540} y={350} width={95} pink />
    <Bench x={227} y={386} /><Bench x={483} y={398} />
    <Lamp x={663} y={385} /><Shrubs x={91} y={417} scale={1} />
    <g transform="translate(408 403)"><ellipse rx="39" ry="15" fill="#d8d8bd" /><ellipse cy="-5" rx="39" ry="15" fill="#fff8e8" /><ellipse cy="-7" rx="29" ry="10" fill="#c2d599" /><Tree x={0} y={-10} scale={.55} /></g>
  </svg>
}

export function OperationsPavilion({ reduced }: { reduced: boolean }) {
  return <article className="story-stop stop-two operations-location" aria-labelledby="operations-title">
    <div className="story-building operations-building"><OperationsArtwork /><LocationResidents reduced={reduced} /><h2 id="operations-title">You ask the question.<br /><span>We handle the moving parts.</span></h2></div>
    <div className="location-copy operations-copy"><p>From setting up a space to routing its crowd, the system handles the heavy work. You stay focused on what you want to find out.</p><div className="process-wayfinding"><ul className="plain-checks"><li>Describe a space and a scenario</li><li>Review the proposed changes</li><li>Watch the crowd respond</li></ul></div></div>
  </article>
}

export function DecisionGarden({ reduced }: { reduced: boolean }) {
  return <article className="story-stop stop-three garden-location" aria-labelledby="garden-title">
    <div className="story-building garden-building"><GardenArtwork /><LocationResidents reduced={reduced} garden /><h2 id="garden-title">A small change.<br /><span>A different story.</span></h2></div>
    <div className="location-copy garden-copy"><p>Close a door. Add a check-in desk. Make a street one-way. Explore how one decision changes the way people move.</p><p>And when a plan needs another look? Edit an earlier intervention and replay the possibilities.</p><a className="text-link" href="#scenarios">Let’s try a few <Icon name="arrow" size={17} /></a></div>
  </article>
}
