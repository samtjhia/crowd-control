import type { Vec2 } from '@crowd-control/contract'
import type { TimedFrame } from '../worker/simulationClient.ts'

/**
 * Display positions between the two latest worker frames. Rendering trails the worker by
 * one frame so motion stays smooth at any frame rate; it never changes simulation state.
 * No interpolation across streams (reset/replay) or for agents absent from either frame.
 */
export function displayPositions(previous: TimedFrame | null, current: TimedFrame, now: number): Map<string, Vec2> {
  const positions = new Map<string, Vec2>()
  const usable = previous !== null
    && previous.frame.streamId === current.frame.streamId
    && current.frame.tick > previous.frame.tick
    && current.receivedAt > previous.receivedAt
  const alpha = usable ? Math.min(1, Math.max(0, (now - current.receivedAt) / (current.receivedAt - previous.receivedAt))) : 1
  const before = usable ? new Map(previous.frame.agents.map((agent) => [agent.id, agent])) : null
  for (const agent of current.frame.agents) {
    if (agent.state === 'departed') continue
    const from = before?.get(agent.id)
    positions.set(agent.id, from && alpha < 1
      ? { x: from.x + (agent.x - from.x) * alpha, y: from.y + (agent.y - from.y) * alpha }
      : { x: agent.x, y: agent.y })
  }
  return positions
}
