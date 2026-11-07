import { useLayoutEffect, useRef, useState } from 'react'
import { campusFrame } from './campusFrame'

// The campus is authored entirely as editable SVG geometry. The crowd uses the
// same 1536 × 1024 world and the same lower-scene transform in AmbientCrowd.
const TREES = [
  { x: 120, y: 780, s: 1.9 }, { x: 320, y: 590, s: 1.15 },
  { x: 580, y: 590, s: .82 }, { x: 700, y: 460, s: .8 },
  { x: 805, y: 455, s: .95 }, { x: 1170, y: 395, s: .8 },
  { x: 1270, y: 390, s: .72 }, { x: 1450, y: 650, s: 1.1 },
  { x: 1450, y: 890, s: 1.45 }, { x: 335, y: 950, s: .72 },
]

function BlockTree({ x, y, s }: { x: number; y: number; s: number }) {
  return <g transform={`translate(${x} ${y}) scale(${s})`}>
    <polygon points="-9,-48 0,-52 9,-47 9,6 0,11 -9,6" fill="#b5a18c" />
    <polygon points="0,-52 9,-47 9,6 0,11" fill="#9e8e7e" />
    <polygon points="-48,-115 -9,-134 41,-110 2,-91" fill="#d0dfbc" />
    <polygon points="-48,-115 2,-91 2,-42 -48,-66" fill="#b8cda5" />
    <polygon points="2,-91 41,-110 41,-61 2,-42" fill="#a0bd94" />
    <polygon points="-24,-147 8,-162 45,-144 13,-128" fill="#dce8c8" />
    <polygon points="-24,-147 13,-128 13,-91 -24,-110" fill="#c5d8af" />
    <polygon points="13,-128 45,-144 45,-107 13,-91" fill="#adc89c" />
  </g>
}

function Planter({ x, y, pink = false }: { x: number; y: number; pink?: boolean }) {
  return <g transform={`translate(${x} ${y})`}>
    <polygon points="0,0 42,-13 74,0 32,13" fill="#eee7d7" />
    <polygon points="0,0 32,13 32,25 0,12" fill="#dbd3c2" />
    <polygon points="32,13 74,0 74,12 32,25" fill="#c9c6b3" />
    <polygon points="7,-9 25,-15 38,-9 20,-3" fill={pink ? '#e8c1cd' : '#b9d1aa'} />
    <polygon points="7,-9 20,-3 20,8 7,2" fill={pink ? '#d7aebb' : '#a5c297'} />
    <polygon points="20,-3 38,-9 38,2 20,8" fill={pink ? '#c99ba9' : '#91b486'} />
    <polygon points="34,-13 54,-19 68,-13 48,-7" fill={pink ? '#ecd0d8' : '#c9ddbb'} />
    <polygon points="34,-13 48,-7 48,5 34,-1" fill={pink ? '#ddb7c6' : '#b1cda3'} />
    <polygon points="48,-7 68,-13 68,-1 48,5" fill={pink ? '#cba0b0' : '#9bbd8c'} />
  </g>
}

function Desk({ x, y }: { x: number; y: number }) {
  return <g transform={`translate(${x} ${y})`}>
    <path d="M1 7v13m26-5v13m20-24v13" stroke="#acb49c" strokeWidth="3" />
    <polygon points="0,0 20,-8 48,1 28,10" fill="#e6d7b9" />
    <polygon points="0,0 28,10 28,14 0,4" fill="#d1c2a6" />
    <polygon points="28,10 48,1 48,5 28,14" fill="#c2b69c" />
  </g>
}

export function SkyCorners() {
  return <svg className="sky-corners" viewBox="0 0 1536 240" preserveAspectRatio="none" aria-hidden="true">
    {/* Stepped cloud silhouettes frame the open center rather than filling it. */}
    <g fill="#edf1f5">
      <path d="M0 145h40v-34h57V78h53V58h64v28h52v39h60v30h59v30H0Z" />
      <path d="M1536 187h-59v-34h-45v-46h-56V78h-58v27h-52v42h-61v32h-65v25h396Z" />
    </g>
    <g fill="#f2e7e5"><path d="M0 161h75v-28h68V99h60v32h52v34h77v20H0Z" /><path d="M1536 191h-66v-35h-61v-31h-59v35h-57v29h-71v15h314Z" /></g>
    <g fill="#dce6e9"><path d="M0 181h75v-24h63v18h69v25H0Z" /><path d="M1536 204h-62v-21h-80v21h-74v15h216Z" /></g>
  </svg>
}

export function CampusScene() {
  const svg = useRef<SVGSVGElement>(null)
  const [frame, setFrame] = useState(() => campusFrame(1440, 460))
  useLayoutEffect(() => {
    const update = () => { const bounds = svg.current!.getBoundingClientRect(); if (bounds.width && bounds.height) setFrame(campusFrame(bounds.width, bounds.height)) }
    const observer = new ResizeObserver(update)
    observer.observe(svg.current!); update()
    return () => observer.disconnect()
  }, [])
  return <svg ref={svg} className="campus-art" viewBox="0 400 1536 624" preserveAspectRatio="xMidYMax slice" role="img" aria-label="A geometric school campus" aria-describedby="campus-art-description">
    <desc id="campus-art-description">An angular pastel landscape with block-shaped trees, stepped seating, a school, and paved paths for the walking crowd.</desc>
    <rect width="1536" height="1024" fill="#fcfcf9" />
    <g transform={`translate(0 ${frame.campusY}) scale(1 ${frame.campusScaleY})`}>
      {/* Broad land facets, with square edges and flat fills. */}
      <polygon points="0,800 160,670 275,590 470,560 610,490 800,435 1020,370 1270,390 1450,520 1536,720 1536,935 1320,1000 850,1010 330,985 0,915" fill="#c7d8b8" />
      <polygon points="0,780 160,650 275,570 470,540 610,470 800,415 1020,350 1270,370 1450,500 1536,700 1536,915 1320,980 850,990 330,965 0,895" fill="#e0e9d3" />
      <polygon points="0,780 160,650 275,570 470,540 610,470 800,415 650,570 450,650 250,710 90,840" fill="#cddfbc" />
      <polygon points="800,415 1020,350 1270,370 1450,500 1170,450 1010,425 885,495 745,540" fill="#d7e5c6" />
      <polygon points="1030,895 1320,890 1536,760 1536,915 1320,980 850,990 730,950" fill="#c4d9b6" />
      {/* Paving is shared with the world coordinates used by the walkers. */}
      <path d="M175 916 285 876 370 863 445 844 488 815 502 767 520 725 580 692 660 670 740 642 790 610 812 580 812 550 812 530 822 515 845 502 880 490 920 482 960 475 995 466 1012 450" fill="none" stroke="#cbd6bd" strokeWidth="70" strokeLinejoin="miter" />
      <path d="M175 912 285 872 370 859 445 840 488 811 502 763 520 721 580 688 660 666 740 638 790 606 812 576 812 546 812 526 822 511 845 498 880 486 920 478 960 471 995 462 1012 446" fill="none" stroke="#f6f2e8" strokeWidth="62" strokeLinejoin="miter" />
      <polygon points="490,726 620,668 742,680 820,723 900,785 932,845 820,905 675,904 540,861 484,807" fill="#f6f2e8" />
      <path d="M660 790 740 775 795 748 839 727 873 711" fill="none" stroke="#f6f2e8" strokeWidth="44" strokeLinejoin="miter" />
      {/* Amphitheatre: three angular risers behind a separate flat floor. */}
      <polygon points="272,617 401,574 521,609 521,625 402,592 288,633" fill="#f0e8d7" />
      <polygon points="288,633 402,592 521,625 521,640 403,608 302,646" fill="#ded7c6" />
      <polygon points="303,646 403,608 510,639 510,651 405,624 318,659" fill="#faf5e9" />
      <polygon points="318,659 405,624 510,651 510,664 406,638 333,670" fill="#e3dccb" />
      <polygon points="334,669 406,638 497,663 497,675 408,652 347,681" fill="#faf6ec" />
      <polygon points="347,681 408,652 497,675 497,687 410,665 355,693" fill="#e2dac8" />
      <polygon points="356,684 410,665 475,675 510,695 455,723 376,714" fill="#f7f2e7" />
      {/* The main school: open classroom floors and solid block walls. */}
      <polygon points="1078,425 1432,455 1315,877 922,742" fill="#c5d4cb" />
      <polygon points="1088,421 1432,451 1310,850 938,728" fill="#f4f0e5" />
      <polygon points="1090,408 1443,439 1432,456 1081,425" fill="#fffdf5" />
      <polygon points="1090,408 1081,425 945,737 964,744 1110,427" fill="#e4decd" />
      <polygon points="1432,451 1443,439 1328,856 1310,850" fill="#d7d8c9" />
      <polygon points="1090,468 1407,492 1377,575 1064,543" fill="#ececde" />
      <polygon points="1053,558 1370,591 1340,686 1024,648" fill="#eeeee0" />
      <polygon points="1014,665 1334,704 1299,817 977,753" fill="#ecebdd" />
      {/* Cross walls are crisp planes, without texture or soft corners. */}
      <polygon points="1060,514 1385,545 1380,567 1054,535" fill="#fffdf5" />
      <polygon points="1054,535 1380,567 1380,584 1054,551" fill="#dbd7c8" />
      <polygon points="1026,622 1350,664 1344,687 1020,644" fill="#fffdf5" />
      <polygon points="1020,644 1344,687 1342,704 1017,661" fill="#ded8c8" />
      {[0, 1, 2].map(row => <g key={row} transform={`translate(${-35 * row} ${105 * row})`}>
        <polygon points="1240,432 1398,444 1391,493 1230,478" fill="#c8dce4" />
        <path d="m1282 435-9 47m62-42-9 47" stroke="#eef3ed" strokeWidth="3" />
        <Desk x={1142} y={492} /><Desk x={1240} y={505} />
      </g>)}
      {/* Front facade and its blue window blocks. */}
      <polygon points="950,718 1315,809 1315,875 940,759" fill="#e1dbcb" />
      <polygon points="950,708 1327,800 1315,813 940,722" fill="#fffdf5" />
      <polygon points="1040,752 1235,801 1235,850 1036,793" fill="#bad4df" />
      <path d="M1085 763v44m49-31v45m49-33v46" stroke="#edf2e9" strokeWidth="4" />
      {/* Entry pavilion: doorway aligns with the fading crowd's destination. */}
      <polygon points="810,643 866,579 980,603 930,665" fill="#fffaf0" />
      <polygon points="821,644 870,591 966,609 922,654" fill="#e4e3d5" />
      <polygon points="810,643 930,665 930,745 810,724" fill="#eee6d4" />
      <polygon points="930,665 980,603 980,686 930,745" fill="#d9d9c8" />
      <polygon points="833,663 908,676 908,728 833,715" fill="#c5dce2" />
      <polygon points="857,668 886,673 886,726 857,721" fill="#9ebbb5" />
      <path d="M852 666v52m35-46v53" stroke="#eaf0e5" strokeWidth="3" />
      {/* Simple seating and planters are functional landmarks, not texture. */}
      <g fill="#dcc9a6"><polygon points="675,606 733,589 755,597 697,615" /><polygon points="675,606 697,615 697,624 675,615" /><path d="M684 615v14m53-17v13" stroke="#aaa48a" strokeWidth="4" /></g>
      <Planter x={380} y={923} pink /><Planter x={950} y={845} pink /><Planter x={895} y={427} pink /><Planter x={550} y={613} />
      {TREES.map((tree, index) => <BlockTree key={index} {...tree} />)}
      <polygon points="18,936 110,905 165,925 78,958" fill="#b3c9a7" />
      <polygon points="1370,968 1470,927 1536,955 1436,994" fill="#b2c7ad" />
    </g>
  </svg>
}
