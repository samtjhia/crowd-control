import { drawPerson, useCanvas } from './canvas'
import { campusPeopleAt } from './campusMotion'
import { campusFrame } from './campusFrame'
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
