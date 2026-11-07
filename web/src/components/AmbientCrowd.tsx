import { drawPerson, useCanvas } from './canvas'
import { campusPeopleAt } from './campusMotion'
import { campusFrame, trailWidth } from './campusFrame'
import { useJourney, drawJourneyPeople } from './journeyFlow'

export function CampusCrowd({ reduced, playing }: { reduced: boolean; playing: boolean }) {
  const geometry = useJourney()
  const canvas = useCanvas((ctx, width, height, time, still, flowTime) => {
    // Match the SVG viewBox, bottom alignment, and lower-campus group transform.
    const frame = campusFrame(width, height)
    ctx.save(); ctx.translate(frame.offsetX, frame.offsetY); ctx.scale(frame.scale, frame.scale)
    const people = campusPeopleAt(still ? 0 : time)
    for (const person of people) {
      if (person.i < 12) continue
      ctx.globalAlpha = person.opacity
      drawPerson(ctx, person.x, frame.campusY + person.y * frame.campusScaleY, person.size, person.i, time * person.pace, !still && person.walking)
    }
    ctx.globalAlpha = 1
    ctx.restore()
    if (geometry) drawJourneyPeople(ctx, geometry, still ? 0 : flowTime, still, 'campus')
  }, reduced, playing)
  return <canvas ref={canvas} className="campus-crowd" aria-hidden="true" />
}

export function StoryCrowd({ reduced, playing }: { reduced: boolean; playing: boolean }) {
  const geometry = useJourney()
  const canvas = useCanvas((ctx, _width, _height, _time, still, flowTime) => {
    if (geometry) drawJourneyPeople(ctx, geometry, still ? 0 : flowTime, still, 'story')
  }, reduced, playing)
  return <canvas ref={canvas} className="story-crowd" aria-hidden="true" />
}

export function FallingCrowd({ reduced, playing }: { reduced: boolean; playing: boolean }) {
  const canvas = useCanvas((ctx, width, height, time, still) => {
    for (let i = 0; i < 32; i++) {
      const phase = (i / 32 + (still ? 0 : time * .09)) % 1
      const y = phase * phase * (height + 30)
      const drop = Math.max(0, (y - 55) / Math.max(1, height - 55))
      const spread = trailWidth(window.innerWidth) / 2 - 7 + drop * 100
      const x = width / 2 + Math.sin(i * 9.3) * spread
      ctx.save(); ctx.translate(x, y); ctx.rotate(still ? 0 : Math.sin(i) * drop * .4)
      drawPerson(ctx, 0, 0, .95, i, time, !still && y < 55); ctx.restore()
    }
  }, reduced, playing)
  return <canvas ref={canvas} className="falling-crowd" aria-hidden="true" />
}
