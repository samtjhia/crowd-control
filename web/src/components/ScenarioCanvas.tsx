import { alongPath, drawPerson, useCanvas, type Point } from './canvas'

export type ScenarioId = 'school' | 'concert' | 'checkin' | 'alley'
type Props = { scenario: ScenarioId; changed: boolean; playing: boolean; reset: number; reduced: boolean }
const ROOMS = [
  { x: 140, y: 90, w: 170, h: 130, label: 'Classroom 01' },
  { x: 330, y: 90, w: 170, h: 130, label: 'Classroom 02' },
  { x: 520, y: 90, w: 210, h: 130, label: 'Science lab' },
  { x: 140, y: 310, w: 170, h: 150, label: 'Library' },
  { x: 330, y: 310, w: 170, h: 150, label: 'Classroom 03' },
  { x: 520, y: 310, w: 210, h: 150, label: 'Assembly hall' },
]
function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = '#587361') {
  ctx.fillStyle = color; ctx.font = '11px "DM Sans", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(text, x, y)
}
function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, radius = 4) {
  ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fill()
}
function exit(ctx: CanvasRenderingContext2D, x: number, y: number, name: string, closed = false) {
  box(ctx, x - 30, y - 12, 60, 23, closed ? '#f3dce0' : '#dcebd7')
  label(ctx, name, x, y + 3, closed ? '#9a4057' : '#346749')
  if (closed) { ctx.strokeStyle = '#b75f74'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - 7, y - 28); ctx.lineTo(x + 7, y - 14); ctx.moveTo(x + 7, y - 28); ctx.lineTo(x - 7, y - 14); ctx.stroke() }
}

export function ScenarioCanvas({ scenario, changed, playing, reset, reduced }: Props) {
  const canvas = useCanvas((ctx, width, height, elapsed, still) => {
    const scale = Math.min((width - 20) / 880, (height - 26) / 530)
    ctx.save(); ctx.translate(width / 2, height / 2); ctx.scale(scale, scale); ctx.translate(-440, -265)
    const time = still ? 6 : elapsed
    const people: { x: number; y: number; i: number; walking?: boolean }[] = []
    const personSize = Math.max(1, .72 / scale)
    if (scenario === 'school') {
      box(ctx, 120, 70, 630, 410, '#e6eadc')
      box(ctx, 140, 230, 590, 70, '#f7f8ee')
      for (const room of ROOMS) {
        box(ctx, room.x, room.y, room.w, room.h, '#fafbf6')
        ctx.strokeStyle = '#a4b59c'; ctx.lineWidth = 2; ctx.strokeRect(room.x, room.y, room.w, room.h)
        const doorY = room.y < 250 ? room.y + room.h : room.y
        ctx.strokeStyle = '#f7f8ee'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(room.x + room.w / 2 - 14, doorY); ctx.lineTo(room.x + room.w / 2 + 14, doorY); ctx.stroke()
        label(ctx, room.label, room.x + room.w / 2, room.y + 20)
        ctx.strokeStyle = '#dae1cf'; ctx.lineWidth = 1
        for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) ctx.strokeRect(room.x + 28 + j * 43, room.y + 40 + k * 24, 21, 12)
      }
      exit(ctx, 80, 269, 'West exit'); exit(ctx, 790, 269, changed ? 'Closed' : 'East exit', changed)
      if (changed) {
        box(ctx, 145, 233, 175, 63, '#efd8cf')
        ctx.save(); ctx.beginPath(); ctx.rect(145, 233, 175, 63); ctx.clip(); ctx.strokeStyle = '#ceaa9a'; ctx.lineWidth = 1
        for (let x = 100; x < 330; x += 12) { ctx.beginPath(); ctx.moveTo(x, 233); ctx.lineTo(x + 63, 296); ctx.stroke() }; ctx.restore()
        ctx.strokeStyle = '#bb6479'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(750, 246); ctx.lineTo(750, 286); ctx.stroke()
      }
      for (let i = 0; i < 100; i++) {
        const room = ROOMS[i % ROOMS.length]
        const p = (time * .035 + i * .173) % 1
        const phase = changed && p > .65 ? .65 + (p - .65) * .18 : p
        const end = changed || i % 3 === 0 ? 92 : 780
        const points: Point[] = [
          { x: room.x + 25 + i * 37 % (room.w - 50), y: room.y + 43 + i * 19 % (room.h - 62) },
          { x: room.x + room.w / 2, y: room.y < 250 ? room.y + room.h : room.y },
          { x: room.x + room.w / 2, y: 252 + i % 5 * 6 }, { x: end, y: 252 + i % 5 * 6 },
        ]
        people.push({ ...alongPath(points, phase), i })
      }
      label(ctx, 'NORTH WING · GROUND FLOOR', 435, 514)
    }
    if (scenario === 'concert') {
      box(ctx, 115, 55, 650, 440, '#edf0e5', 18)
      box(ctx, 290, 75, 300, 78, '#c1d8bd', 8); label(ctx, 'STAGE', 440, 119, '#346749')
      for (let i = 0; i < 6; i++) box(ctx, 305 + i * 48, 82, 20, 4, i % 2 ? '#b8839a' : '#7294bc', 2)
      exit(ctx, 100, 445, 'Exit A'); exit(ctx, 780, 445, 'Exit B')
      for (let i = 0; i < 100; i++) {
        const origin = { x: 225 + (i % 13) * 35 + Math.sin(i) * 9, y: 195 + Math.floor(i / 13) * 26 }
        const points = [origin, { x: i % 2 ? 690 : 180, y: 435 }, { x: i % 2 ? 790 : 90, y: 445 }]
        people.push({ ...(changed ? alongPath(points, (time * .025 + i * .139) % 1) : origin), i, walking: changed })
      }
      label(ctx, changed ? 'SHOW ENDED · DEPARTURES' : 'A CROWD GATHERS FOR THE SHOW', 440, 522)
    }
    if (scenario === 'checkin') {
      box(ctx, 100, 65, 680, 430, '#edf0e5', 12)
      box(ctx, 125, 85, 630, 120, '#e0e9db', 8); label(ctx, 'HACKATHON HALL', 440, 116)
      const desks = changed ? 5 : 4
      for (let d = 0; d < desks; d++) {
        const x = 210 + d * 110
        box(ctx, x - 32, 226, 64, 26, d % 2 ? '#b6c9dd' : '#c5d9b6')
        label(ctx, `Desk ${d + 1}`, x, 244, '#375c48')
        ctx.strokeStyle = '#d1d9c8'; ctx.setLineDash([3, 6]); ctx.beginPath(); ctx.moveTo(x - 25, 270); ctx.lineTo(x - 25, 431); ctx.moveTo(x + 25, 270); ctx.lineTo(x + 25, 431); ctx.stroke(); ctx.setLineDash([])
      }
      for (let i = 0; i < 100; i++) {
        const desk = i % desks
        const phase = (time * .027 + i * .137) % 1
        const x = 210 + desk * 110
        const points = [{ x: 150 + i % 8 * 18, y: 480 }, { x, y: 410 }, { x, y: 266 }, { x: x + 42, y: 193 }, { x: 710, y: 156 }]
        people.push({ ...alongPath(points, phase), i })
      }
      label(ctx, 'ARRIVE · CHECK IN · FIND YOUR PEOPLE', 440, 523)
    }
    if (scenario === 'alley') {
      box(ctx, 100, 48, 280, 450, '#e2e7db', 8); box(ctx, 535, 48, 245, 450, '#e4e9de', 8)
      box(ctx, 380, 48, 155, 450, '#f7f8ef', 0)
      for (let row = 0; row < 5; row++) {
        box(ctx, 125, 68 + row * 84, 225, 58, '#f6f7ef'); box(ctx, 560, 68 + row * 84, 195, 58, '#f5f6ee')
        label(ctx, row % 2 ? 'CAFÉ' : 'SHOP', 237, 101 + row * 84)
      }
      label(ctx, 'STATION', 457, 32); label(ctx, 'BAR STREET', 457, 522)
      for (let i = 0; i < 100; i++) {
        const uphill = changed || i % 2 === 0
        const phase = (time * (changed ? .035 : .019) + i * .137) % 1
        const x = 403 + i % 6 * 18
        people.push({ x, y: uphill ? 480 - phase * 410 : 70 + phase * 410, i: uphill ? i * 6 : i * 6 + 1 })
      }
      if (!changed) { ctx.strokeStyle = '#bd7d8d'; ctx.lineWidth = 2; ctx.setLineDash([4, 6]); ctx.strokeRect(390, 220, 135, 88); ctx.setLineDash([]) }
    }
    people.sort((a, b) => a.y - b.y).forEach(person => drawPerson(ctx, person.x, person.y, personSize, person.i, time, !still && playing && person.walking !== false))
    ctx.restore()
  }, reduced, playing, reset)
  return <canvas ref={canvas} className="scenario-canvas" role="img" aria-label={`Illustrative ${scenario === 'checkin' ? 'hackathon check-in' : scenario} scenario with 100 visible human figures. ${changed ? 'The selected change is applied.' : 'Original setup.'}`} />
}
