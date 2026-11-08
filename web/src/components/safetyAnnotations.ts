import type { SafetySceneType } from './CrowdSafetyScene'
import type { ScenePoint } from './safetyGeometry'

export type SafetyAnnotation = { title: string; copy: string; target: ScenePoint; marker: readonly [number, number] }
export const safetyAnnotations: Record<SafetySceneType, SafetyAnnotation[]> = {
  concert: [
    { title: 'High crowd density', copy: 'People gather near the stage. As the crowd becomes denser, there is less room for each person to move.', target: [250, 120], marker: [440, 172] },
    { title: 'Crowd barriers', copy: 'Barriers separate audience areas and limit where people can pass between them.', target: [245, 185], marker: [493, 308] },
    { title: 'Access corridors', copy: 'Side corridors can provide routes through the venue and access for assistance.', target: [65, 230], marker: [77, 250] },
  ],
  alley: [
    { title: 'Narrow passage', copy: 'The alley has a fixed width. More people entering can leave less space for movement.', target: [238, 173], marker: [409, 246] },
    { title: 'Limited space to move aside', copy: 'Buildings on both sides leave few places to step away from a dense crowd.', target: [235, 84], marker: [315, 130] },
    { title: 'Opposing flows', copy: 'People approaching from different directions meet at the same junction.', target: [238, 283], marker: [390, 413] },
  ],
  nightclub: [
    { title: 'Main entrance', copy: 'Routes converge when many people use the same entrance to leave. Crowding at the opening can slow evacuation.', target: [245, 286], marker: [349, 417] },
    { title: 'Other exits', copy: 'Exit placement, visible signs, and clear routes affect which exits people can use.', target: [448, 204], marker: [626, 359] },
    { title: 'Fire and available routes', copy: 'As a fire spreads, some routes can become harder to use. Evacuation planning needs to account for those changing conditions.', target: [320, 79], marker: [567, 190] },
  ],
  consequences: [
    { title: 'Longer evacuations', copy: 'A bottleneck can slow the flow of people leaving a venue.', target: [245, 287], marker: [254, 433] },
    { title: 'Dangerous crowd pressure', copy: 'Very dense crowds can limit movement and create dangerous pressure.', target: [245, 220], marker: [365, 277] },
    { title: 'Delayed emergency access', copy: 'Blocked or crowded routes can delay first responders trying to reach people.', target: [462, 262], marker: [623, 419] },
    { title: 'Greater risk of harm', copy: 'When people cannot leave quickly, they may be exposed to fire, smoke, or other hazards for longer.', target: [320, 79], marker: [557, 183] },
  ],
}
