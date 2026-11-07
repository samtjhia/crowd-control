import { drawPerson, useCanvas } from './canvas'
import { campusPeopleAt } from './campusMotion'
import { campusFrame } from './campusFrame'
import { journeyPeopleAt } from './journeyCrowdMotion'
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
      drawPerson(ctx, person.x, frame.campusY + person.y * frame.campusScaleY, Math.max(person.size, .52 / frame.scale), person.i, time * person.pace, !still && person.walking)
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
  const geometry = useJourney()
  const canvas = useCanvas((ctx, width, height, _time, still, flowTime) => {
    if (!geometry?.handoff) return
    const box = geometry.handoff
    const time = still ? 0 : flowTime
    for (const person of journeyPeopleAt(geometry, time, 35)) {
      const beyond = Math.max(0, person.distance - geometry.length)
      const fallingTime = beyond / (13 * person.pace)
      const drop = Math.min(1, fallingTime / 1.5)
      const x = person.x - box.x + Math.sin(person.identity * 2.7) * drop * 72
      const y = beyond ? 55 + 24 * fallingTime * fallingTime : person.y - box.y
      if (y < 0 || y > height + 20 || x < -10 || x > width + 10) continue
      ctx.save(); ctx.translate(x, y); ctx.rotate(still ? 0 : Math.sin(person.identity) * drop * .4)
      drawPerson(ctx, 0, 0, person.size, person.identity, time * person.pace, !still && !beyond)
      ctx.restore()
    }
  }, reduced, playing)
  return <canvas ref={canvas} className="falling-crowd" aria-hidden="true" />
}
