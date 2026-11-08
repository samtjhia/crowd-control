import { loadAssistant } from './assistantStore.ts'
import { loadSavedVenues, savedScenarioId } from './savedVenues.ts'

/**
 * A saved run knows only its simulation ID. This recovers what a person would call it, which
 * scenario in the simulator opens it again, and whether its densities are people per square
 * metre (prepared venues and scaled floor plans) or per body width (the worked example).
 */
export type RunIdentity = { title: string; scenario: string | null; metres: boolean | null }

const DEMOS: Record<string, RunIdentity> = {
  'worked-demo': { title: 'Worked example', scenario: 'worked-example', metres: false },
  'hillside-alley-demo': { title: 'Two-way alley', scenario: 'hillside-alley', metres: true },
  'school-wing-demo': { title: 'School fire drill', scenario: 'school-wing', metres: true },
  'concert-floor-demo': { title: 'Concert evacuation', scenario: 'concert-floor', metres: true },
  'hackathon-hall-demo': { title: 'Hackathon check-in', scenario: 'hackathon-hall', metres: true },
}

/** "my_venue-demo" reads "My venue". */
export function readable(id: string): string {
  const words = id.replace(/-demo$/, '').replace(/[-_]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : id
}

export function runIdentity(simulationId: string): RunIdentity {
  const demo = DEMOS[simulationId]
  if (demo) return demo
  const venue = loadSavedVenues().find((saved) => `${saved.map.id}-demo`.slice(0, 200) === simulationId)
  if (venue) return { title: `${venue.name} (uploaded)`, scenario: savedScenarioId(venue), metres: venue.map.grid.units === 'm' }
  const written = loadAssistant().scenarios.find((scenario) => scenario.plan.simulationId === simulationId)
  if (written) return { title: written.title.replace(/^Assistant: /, ''), scenario: written.id, metres: written.model.units === 'm' }
  return { title: readable(simulationId), scenario: null, metres: null }
}
