import { createContext, useContext } from 'react'
import { journeyPoint, type JourneyGeometry } from './journeyGeometry'
import { drawPerson } from './canvas'

export const JourneyContext = createContext<JourneyGeometry | null>(null)
export function useJourney() { return useContext(JourneyContext) }


export function drawJourneyPeople(ctx: CanvasRenderingContext2D, geometry: JourneyGeometry, time: number, reduced: boolean, region: 'campus' | 'story') {
  const box = geometry[region]
  const mobile = geometry.width < 700
  const spacing = mobile ? 21 : 25
  const travel = (reduced ? 0 : time) * 13
  const first = Math.ceil(-travel / spacing)
  for (let index = first; index * spacing + travel <= geometry.length; index++) {
    const point = journeyPoint(geometry, index * spacing + travel)
    const x = point.x - box.x + Math.sin(index * 2.1) * (mobile ? 6 : 11)
    const y = point.y - box.y
    if (y < -2 || y > box.height + 16 || x < -10 || x > box.width + 10) continue
    const identity = ((index % 120) + 120) % 120
    drawPerson(ctx, x, y, mobile ? .68 : .92, identity, time, !reduced)
  }
}
