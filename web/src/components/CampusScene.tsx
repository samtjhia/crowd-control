import { useLayoutEffect, useRef, useState } from 'react'
import { campusFrame } from './campusFrame'

// The campus is authored entirely as editable SVG geometry. The crowd uses the
// same 1536 × 1024 world and the same lower-scene transform in AmbientCrowd.
const TREES = [
  { x: 60, y: 685, s: 1.65 }, { x: 320, y: 590, s: 1.15 },
  { x: 580, y: 590, s: .82 }, { x: 700, y: 460, s: .8 },
  { x: 805, y: 455, s: .95 }, { x: 1170, y: 395, s: .8 },
  { x: 1270, y: 390, s: .72 }, { x: 1450, y: 650, s: 1.1 },
  { x: 1450, y: 890, s: 1.45 }, { x: 240, y: 610, s: .95 },
]

function BlockTree({ x, y, s }: { x: number; y: number; s: number }) {
  return <g transform={`translate(${x} ${y}) scale(${s})`}>
    <polygon points="-9,-48 0,-52 9,-47 9,6 0,11 -9,6" fill="#ae916b" />
    <polygon points="0,-52 9,-47 9,6 0,11" fill="#947954" />
    <polygon points="-48,-115 -9,-134 41,-110 2,-91" fill="#c8df89" />
    <polygon points="-48,-115 2,-91 2,-42 -48,-66" fill="#91b959" />
    <polygon points="2,-91 41,-110 41,-61 2,-42" fill="#719c48" />
    <polygon points="-24,-147 8,-162 45,-144 13,-128" fill="#d8e99d" />
    <polygon points="-24,-147 13,-128 13,-91 -24,-110" fill="#afd073" />
    <polygon points="13,-128 45,-144 45,-107 13,-91" fill="#98bc60" />
  </g>
}

function Shrub({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${s})`}>
    <ellipse cx="0" cy="3" rx="34" ry="9" fill="#a8c67e" opacity=".45" />
    <path d="M-30-4-25-21-11-28 3-20 5-3-10 6Z" fill="#accd74" />
    <path d="M-10 6 5-3 3-20 16-32 33-21 36-3 19 10Z" fill="#91b95e" />
    <path d="m-11-28 14 8-14 10-14-11Zm14 8 13-12 17 11-15 10Z" fill="#c3dc8b" />
    <path d="m-11-10 14-10 2 17-15 9Z" fill="#9fc268" />
  </g>
}

function Lamp({ x, y }: { x: number; y: number }) {
  return <g transform={`translate(${x} ${y})`}>
    <ellipse cx="0" cy="3" rx="10" ry="4" fill="#abc585" />
    <path d="M0 0v-53" stroke="#557852" strokeWidth="4" />
    <path d="m-7-54 7-8 7 8-2 10H-5Z" fill="#f5eac4" stroke="#6d8b58" strokeWidth="2" />
  </g>
}

function Planter({ x, y, pink = false }: { x: number; y: number; pink?: boolean }) {
  return <g transform={`translate(${x} ${y})`}>
    <polygon points="0,0 42,-13 74,0 32,13" fill="#eee7d7" />
    <polygon points="0,0 32,13 32,25 0,12" fill="#dbd3c2" />
    <polygon points="32,13 74,0 74,12 32,25" fill="#c9c6b3" />
    <polygon points="7,-9 25,-15 38,-9 20,-3" fill={pink ? '#e7aab4' : '#b9d1aa'} />
    <polygon points="7,-9 20,-3 20,8 7,2" fill={pink ? '#d792a1' : '#a5c297'} />
    <polygon points="20,-3 38,-9 38,2 20,8" fill={pink ? '#c99ba9' : '#91b486'} />
    <polygon points="34,-13 54,-19 68,-13 48,-7" fill={pink ? '#eed0d2' : '#c9ddbb'} />
    <polygon points="34,-13 48,-7 48,5 34,-1" fill={pink ? '#e7b2bd' : '#b1cda3'} />
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

export function CampusScene() {
  const svg = useRef<SVGSVGElement>(null)
  const [frame, setFrame] = useState(() => campusFrame(1440, 460))
  useLayoutEffect(() => {
    const update = () => { const bounds = svg.current!.getBoundingClientRect(); if (bounds.width && bounds.height) setFrame(campusFrame(bounds.width, bounds.height)) }
    const observer = new ResizeObserver(update)
    observer.observe(svg.current!); update()
    return () => observer.disconnect()
  }, [])
  return <svg ref={svg} className="campus-art" viewBox="0 400 1536 624" preserveAspectRatio={frame.width < 700 ? "xMidYMax meet" : "xMidYMax slice"} role="img" aria-label="A geometric school campus" aria-describedby="campus-art-description">
    <desc id="campus-art-description">An angular pastel landscape with block-shaped trees, stepped seating, a pond and footbridge, a school, and paved paths for the walking crowd.</desc>
    <rect width="1536" height="1024" fill="#fbfaf8" />
    <g transform={`translate(0 ${frame.campusY}) scale(1 ${frame.campusScaleY})`}>
      {/* Low rolling lawns frame the same walkable campus coordinates. */}
      <path d="M0 780Q130 612 300 578T610 470Q836 360 1030 356T1320 400Q1475 460 1536 690V922Q1390 998 1130 995L385 989Q130 982 0 917Z" fill="#c2db91" />
      <path d="M0 765Q160 615 310 568T620 455Q855 348 1040 350T1330 399Q1480 460 1536 680V906Q1350 979 1120 974L385 968Q130 962 0 898Z" fill="#d5e7a6" />
      <path d="M0 768Q150 615 320 570T660 445Q720 433 790 408Q705 527 529 590T232 739Q150 791 120 851L0 879Z" fill="#c2df8a" />
      <path d="M0 871Q190 851 300 874T570 896Q630 906 688 969L330 966Q115 959 0 898Z" fill="#c8e299" />
      <path d="M1018 896Q1210 860 1360 805T1536 745V905Q1370 973 1120 974L900 977Z" fill="#c0db8c" />
      {/* The pond occupies lawn, away from every existing pedestrian route. */}
      <path d="M61 780C88 724 201 717 271 744S333 786 377 799C419 810 440 848 413 868S345 868 314 851C279 829 256 850 199 844S83 834 60 809Z" fill="#abc78e" />
      <path d="M71 783C102 735 199 735 262 756S311 793 368 810C399 820 431 843 407 857S349 856 319 838C279 815 258 836 198 830S96 823 72 804Z" fill="#92cee0" />
      <path d="M86 783C121 751 196 748 254 769S290 805 359 818C382 823 397 836 393 842C360 846 340 823 313 819C274 808 243 823 193 817S113 811 86 799Z" fill="#a5d9e8" />
      <path d="m150 782 25-9 25 9-15 12-25-1Z" fill="#dbe7bf" />
      <g fill="#b5d28f"><ellipse cx="109" cy="772" rx="4" ry="2"/><ellipse cx="123" cy="765" rx="3" ry="2"/><ellipse cx="217" cy="791" rx="4" ry="2"/><ellipse cx="373" cy="838" rx="4" ry="2"/></g>
      <path d="M102 799h22m81-39h18m151 87h15" stroke="#cae9ee" strokeWidth="3" />
      {/* Arched timber bridge crosses the narrow neck of the pond. */}
      <path d="M272 811Q296 774 328 784L370 806 326 845Z" fill="#cba06a" />
      <path d="M272 811 326 837 370 806V816L326 849 272 821Z" fill="#b98b53" />
      <path d="m281 805 53 26m-43-36 53 27m-42-35 53 27" stroke="#e4bd87" strokeWidth="3" />
      <path d="M274 801Q296 763 328 776L371 797M274 815V801m13-4v-13m14 7v-16m14 15v-17m14 20v-16m14 23v-17m14 24v-17m14 24v-17" fill="none" stroke="#a97843" strokeWidth="4" />
      {/* Paving is shared with the world coordinates used by the walkers. */}
      <path d="M175 916 285 876 370 863 445 844 488 815 502 767 520 725 580 692 660 670 740 642 790 610 812 580 812 550 812 530 822 515 845 502 880 490 920 482 960 475 995 466 1012 450" fill="none" stroke="#cbd6bd" strokeWidth="70" strokeLinejoin="miter" />
      <path d="M175 912 285 872 370 859 445 840 488 811 502 763 520 721 580 688 660 666 740 638 790 606 812 576 812 546 812 526 822 511 845 498 880 486 920 478 960 471 995 462 1012 446" fill="none" stroke="#fcf2e5" strokeWidth="62" strokeLinejoin="miter" />
      <polygon points="490,726 620,668 742,680 820,723 900,785 932,845 820,905 675,904 540,861 484,807" fill="#fcf2e5" />
      <path d="M660 790 740 775 795 748 839 727 873 711" fill="none" stroke="#fcf2e5" strokeWidth="44" strokeLinejoin="miter" />
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
      <polygon points="1088,421 1432,451 1310,850 938,728" fill="#fff1e2" />
      <polygon points="1090,408 1443,439 1432,456 1081,425" fill="#fffdf5" />
      <polygon points="1090,408 1081,425 945,737 964,744 1110,427" fill="#e4decd" />
      <polygon points="1432,451 1443,439 1328,856 1310,850" fill="#d7d8c9" />
      <polygon points="1090,468 1407,492 1377,575 1064,543" fill="#f6ebdb" />
      <polygon points="1053,558 1370,591 1340,686 1024,648" fill="#f7ecdf" />
      <polygon points="1014,665 1334,704 1299,817 977,753" fill="#f4e8d7" />
      {/* Cross walls are crisp planes, without texture or soft corners. */}
      <polygon points="1060,514 1385,545 1380,567 1054,535" fill="#fffdf5" />
      <polygon points="1054,535 1380,567 1380,584 1054,551" fill="#dbd7c8" />
      <polygon points="1026,622 1350,664 1344,687 1020,644" fill="#fffdf5" />
      <polygon points="1020,644 1344,687 1342,704 1017,661" fill="#ded8c8" />
      {[0, 1, 2].map(row => <g key={row} transform={`translate(${-35 * row} ${105 * row})`}>
        <polygon points="1240,432 1398,444 1391,493 1230,478" fill="#96cee7" />
        <path d="m1282 435-9 47m62-42-9 47" stroke="#eef3ed" strokeWidth="3" />
        <Desk x={1142} y={492} /><Desk x={1240} y={505} />
      </g>)}
      {/* Front facade and its blue window blocks. */}
      <polygon points="950,718 1315,809 1315,875 940,759" fill="#edddca" />
      <polygon points="950,708 1327,800 1315,813 940,722" fill="#fffdf5" />
      <polygon points="1040,752 1235,801 1235,850 1036,793" fill="#8ec9e2" />
      <path d="M1085 763v44m49-31v45m49-33v46" stroke="#edf2e9" strokeWidth="4" />
      {/* Entry pavilion: doorway aligns with the fading crowd's destination. */}
      <polygon points="810,643 866,579 980,603 930,665" fill="#fffaf0" />
      <polygon points="821,644 870,591 966,609 922,654" fill="#e4e3d5" />
      <polygon points="810,643 930,665 930,745 810,724" fill="#f9e8d1" />
      <polygon points="930,665 980,603 980,686 930,745" fill="#d9d9c8" />
      <polygon points="833,663 908,676 908,728 833,715" fill="#a0d6e8" />
      <polygon points="857,668 886,673 886,726 857,721" fill="#9ebbb5" />
      <path d="M852 666v52m35-46v53" stroke="#eaf0e5" strokeWidth="3" />
      {/* Simple seating and planters are functional landmarks, not texture. */}
      <g fill="#dcc9a6"><polygon points="675,606 733,589 755,597 697,615" /><polygon points="675,606 697,615 697,624 675,615" /><path d="M684 615v14m53-17v13" stroke="#aaa48a" strokeWidth="4" /></g>
      <Planter x={380} y={923} pink /><Planter x={950} y={845} pink /><Planter x={895} y={427} pink /><Planter x={550} y={613} />
      <g transform="translate(112 869)"><polygon points="0,0 47,-14 67,-7 20,8" fill="#dec49b" /><path d="M8 5v15m45-14v13" stroke="#a8997b" strokeWidth="4" /></g>
      <g transform="translate(961 402)"><polygon points="0,0 51,-15 75,-7 24,8" fill="#eda8b1" /><path d="M10 5v13m49-13v12" stroke="#c29e8c" strokeWidth="4" /></g>
      <g fill="#c0d39f"><polygon points="430,927 449,912 472,922 452,938" /><polygon points="466,935 481,920 500,931 483,944" /></g>
      {/* Park planting stays off the pavement and gives the pond a garden edge. */}
      {[[95,865,1],[210,886,1.15],[275,915,.8],[448,913,1.3],[549,941,.75],[1020,928,1.2],[1415,888,1],[1490,823,.8],[520,599,.65],[765,487,.6],[1045,392,.55]].map(([x,y,size],i) => <Shrub key={i} x={x} y={y} s={size} />)}
      {[[70,854],[646,620],[1388,852]].map(([x,y],i) => <Lamp key={i} x={x} y={y} />)}
      <g transform="translate(646 620)">
        <ellipse rx="26" ry="14" fill="#c8a576" /><ellipse cy="-5" rx="25" ry="13" fill="#ead3a4" />
        <ellipse cy="-7" rx="19" ry="9" fill="#a9c674" />
      </g>
      <g fill="#c5c3a6"><path d="m585 924 17-13 19 4 12 16-27 7Z"/><path d="m1356 929 12-12 21 3 9 12-25 7Z"/></g>
      <g fill="#dddbc0"><path d="m585 924 17-13 19 4-15 12Z"/><path d="m1356 929 12-12 21 3-16 10Z"/></g>
      {TREES.map((tree, index) => <BlockTree key={index} {...tree} />)}


    </g>
  </svg>
}
