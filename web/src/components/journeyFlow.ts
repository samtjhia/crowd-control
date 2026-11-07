import { createContext, useContext } from 'react'
import type { JourneyGeometry } from './journeyGeometry'
import { journeyPeopleAt } from './journeyCrowdMotion'
import { drawPerson } from './canvas'

export const JourneyContext = createContext<JourneyGeometry | null>(null)
export function useJourney() { return useContext(JourneyContext) }


export function drawJourneyPeople(ctx: CanvasRenderingContext2D, geometry: JourneyGeometry, time: number, reduced: boolean, region: 'campus' | 'story') {
  const box = geometry[region]
  for (const person of journeyPeopleAt(geometry, reduced ? 0 : time)) {
    const x = person.x - box.x, y = person.y - box.y
    if (y < -2 || y > box.height + 16 || x < -10 || x > box.width + 10) continue
    drawPerson(ctx, x, y, person.size, person.identity, time * person.pace, !reduced)
  }
}
