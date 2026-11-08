import {
  PlannerRequestSchema,
  parseContract,
  parsePlannerReply,
  plannerJsonSchema,
  type PlannerReply,
  type ServiceError,
  type ServiceResult,
} from '@crowd-control/contract'

export type GeminiPlannerOptions = {
  apiKey?: string
  model?: string
  fetcher?: typeof fetch
}

const unavailable = (message: string, retryable: boolean): ServiceResult<never> => ({
  ok: false,
  error: { code: 'PLANNER_UNAVAILABLE', message, retryable } satisfies ServiceError,
})

function extractText(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null || !('candidates' in payload) || !Array.isArray(payload.candidates)) return
  const candidate = payload.candidates[0]
  if (typeof candidate !== 'object' || candidate === null || !('content' in candidate)) return
  const content = candidate.content
  if (typeof content !== 'object' || content === null || !('parts' in content) || !Array.isArray(content.parts)) return
  const text = content.parts
    .map((part: unknown) => typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string' ? part.text : '')
    .join('')
  return text || undefined
}

export function createGeminiPlanner(options: GeminiPlannerOptions) {
  const fetcher = options.fetcher ?? fetch

  return async (input: unknown): Promise<ServiceResult<PlannerReply>> => {
    const request = parseContract(PlannerRequestSchema, input)
    if (!request.ok) return request
    if (!options.apiKey || !options.model) {
      return unavailable('Planner is not configured. Set GEMINI_API_KEY and GEMINI_MODEL in the server .env file.', false)
    }

    const prompt = (validationFeedback?: string) => [
      'You are the planning assistant for Crowd Control, a crowd-simulation planning estimate, not certified safety advice.',
      'Return exactly one JSON object that conforms to the supplied PlannerReply JSON Schema.',
      'When context.askWhy is true, answer the user question using only context.metricSamples, context.events, context.inventory, and context.interventions. Return kind "answer". Do not infer causes that the supplied evidence does not establish; state when evidence is insufficient. Cite only event IDs present in context.events using evidenceEventIds. Metrics have simulation-time timestamps; distinguish observed correlation from proven cause.',
      'When context.askWhy is false and context.capabilities.editableHistory is true, this is a NEW SCENARIO request: return kind "scenario" and a complete plan. Never return kind "followup" for this request, even if the prompt mentions a change, gate, door, or timed action.',
      'When context.askWhy is false and context.capabilities.editableHistory is false, this is a FOLLOW-UP to the already-loaded simulation: return kind "followup" with a create_intervention request, copying simulationId and requestId from the Planner request. Do not return scenario plans or edit/delete requests.',
      // The allowed changes come from the request, so the simulator decides what is supported, not this prompt.
      `For follow-ups, use only these operations: ${request.value.context.capabilities.operations.join(', ') || 'none'}; and only these goal kinds: ${request.value.context.capabilities.goals.join(', ') || 'none'}. Anything else is rejected. Refer to rooms, doors and people only by IDs from context.inventory.`,
      [
        'How to express common follow-ups with those operations (use each only if it is listed):',
        '- Add people: op "spawn" with placement.inside.ids containing one zone ID from inventory and a positive count.',
        '- Open or close a door: op "set" on the door IDs with values.components.portal.open. Slow people down: values.components.navigation.preferredSpeed or values.components.mobility.speedMultiplier.',
        '- Send people somewhere (evacuate, move to a room, leave by an exit): op "assign_goal" with targets selecting who (by tags or ids, e.g. {"tags":["attendee"]} or {"kind":"agent"} for everyone) and goal {"kind":"reach","target":{"ids":[zone or door ID]}}; add "selection":"nearest" when several targets are listed. Use mode "replace" unless they should finish what they are doing first ("enqueue"). Goal targets must be explicit IDs from inventory.',
        '- Make people wait or mill about: goal {"kind":"wait","duration":seconds} or {"kind":"wander","inside":{"ids":[zone ID]}}; stop what they are doing: op "clear_goal".',
        '- Sound an alarm or make an announcement: op "emit" with event {"name":"alarm"} (or another short name); rules already listening for that name react.',
        '- "When X happens, do Y": op "define_rule" with when {"kind":"event","name":...} and the operations to run; set once true unless it should repeat, in which case give a cooldown in seconds. Prefer event conditions; counts and density may not be supported. Remove a rule with op "remove_rule".',
        '- Do it later: wrap operations in op "schedule" with "at" (seconds since the start) or "after" (seconds from now).',
        '- Use a table, counter or stand: goal {"kind":"interact","target":{"ids":[one object ID]}}; line up at a desk or door: {"kind":"queue","target":{"ids":[one ID]}}. These take exactly one ID; to spread people over several tables, use reach with all their IDs (or their tag) and "selection":"nearest".',
        '- A danger (fire, spill, threat): op "add" with entity {"id":"danger_1","kind":"object","label":"Fire","tags":["hazard"]} and placement {"inside":{"ids":[zone ID]}}, then op "assign_goal" for the people who should react (e.g. {"kind":"agent","inside":{"ids":[zone ID]}}) with goal {"kind":"avoid","target":{"ids":["danger_1"]},"distance":6}. People keep that far away and then stand clear; to evacuate instead, send them to exits with reach.',
      ].join('\n'),
      'For new scenarios, make people behave like real visitors: use sequence goals for multi-step visits (for example arrive outside, walk in through the check-in point, reach the nearest table, wait there, then wander), and use the places listed in the prompt by their IDs, respecting how many each serves at once.',
      [
        'The prompt may list points the person marked on the map ("Point A at (x, y), in <area>, nearest doors ..."). They are spots, not entities: never use "A" or "point_a" as an ID. Use them like this:',
        '- Put something at a point (a check-in desk, a stand, a snack table): op "add" with entity {"id": a new short ID such as "checkin_point_a", "kind":"object", "label": what it is, "shape":{"kind":"rectangle","x": x - 0.5, "y": y - 0.5, "width":1, "height":1}} centred on the point\'s coordinates, and "components":{"interaction":{"duration": seconds per person, "slots": how many at once}} if people use it. Then send people to it with goal interact (or queue) on that new ID, usually inside a sequence. In a new scenario, put these adds first in initialOperations.',
        '- People come in, arrive, or come from the door by a point: spawn them in the area on the OTHER side of that door from where they are going (the outside one, if a side is marked outside). Their FIRST goal must be reach on that door\'s ID, so their route uses it and no other door; then the rest of their visit. For a natural arrival, spawn small groups over time with schedule (a group every 10 to 20 seconds). Give every group its own extra tag (wave1, wave2, ...) and assign each group\'s goals to that tag only, right after its spawn, so a later group never restarts the people already inside.',
        '- Send people to a point to wait or hang around: wander or wait inside the point\'s area.',
        '- Where people START can only be set by a new scenario. If a follow-up asks to change where people start or come from, return kind "clarification" saying to ask again with New scenario; do not place or move anything instead.',
      ].join('\n'),
      'When context.layout is given for a new scenario, the plan must use exactly that layout (same mode, venue and floor, or asset); never invent a generated building in its place.',
      'Include every activity the prompt mentions. When only some people do something ("some", "a few", "half"), split the crowd into separate spawns with their own tags (for example 30 tagged "attendee" and 10 tagged "attendee" and "hungry") and give each group its own goals; never give that activity to everyone. Keep waits short (30-60 s) so each activity is visible within the first two minutes, and use a sequence "repeat" for things people do again and again (a snack run every so often).',
      'A follow-up cannot change where people already in the run started or came in from. If the request is about that ("they should start outside", "they only come in from the door at point A"), return kind "clarification" explaining that where people start is set when the scenario is created, so ask again under New scenario; do not add objects or goals in its place.',
      'For follow-ups, first check whether the requested change can be expressed with the allowed operations and entities in inventory. If it cannot, return kind "clarification" and briefly explain what is possible instead. Never substitute an unrelated action.',
      'Do not invent unsupported operations, goals, entities, map facts, or physical measurements. Ask for clarification when key details are ambiguous.',
      'For layout.mode "generate", the spaces array is ordered. connections must contain exactly spaces.length - 1 entries. connections[i].connects must connect spaces[i].id to spaces[i + 1].id (either endpoint order). For spaces ["a", "b", "c"], use connections [["a", "b"], ["b", "c"]]. Every space and connection id must be unique.',
      `Planner request:\n${JSON.stringify(request.value)}`,
      `PlannerReply JSON Schema:\n${JSON.stringify(plannerJsonSchema())}`,
      ...(validationFeedback ? [`Your previous response failed validation: ${validationFeedback}\nReturn a corrected complete JSON reply. Do not repeat the invalid layout.`] : []),
    ].join('\n\n')

    let validationFeedback: string | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response
      try {
        response = await fetcher(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model)}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': options.apiKey },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt(validationFeedback) }] }],
              generationConfig: { responseMimeType: 'application/json' },
            }),
            signal: AbortSignal.timeout(45_000),
          },
        )
      } catch {
        return unavailable('Could not reach the Gemini planner. Check the server connection and try again.', true)
      }

      if (!response.ok) {
        if (response.status === 429) {
          return unavailable('Gemini rate limit or quota reached (HTTP 429). Check AI Studio usage and quota, then retry after the limit resets.', true)
        }
        const retryable = response.status >= 500
        if (retryable) console.warn(`Gemini planner returned HTTP ${response.status} for model ${options.model}.`)
        return unavailable(
          retryable
            ? `Gemini service error (HTTP ${response.status}). Try again shortly.`
            : `Gemini rejected the planner request (HTTP ${response.status}). Check the server model and API key configuration.`,
          retryable,
        )
      }

      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        return unavailable('Gemini returned an unreadable response. Please try again.', true)
      }
      const text = extractText(payload)
      if (!text) return unavailable('Gemini returned no planner response. Please try again.', true)

      let output: unknown
      try {
        output = JSON.parse(text)
      } catch {
        if (attempt === 0) {
          validationFeedback = 'the response was not valid JSON'
          continue
        }
        return unavailable('Gemini returned invalid JSON after one correction attempt; no plan was applied.', true)
      }

      const reply = parsePlannerReply(output, { capabilities: request.value.context.capabilities })
      if (!reply.ok) {
        if (attempt === 0) {
          validationFeedback = reply.error.message
          continue
        }
        return unavailable(`Gemini's response did not pass planner validation after one correction attempt: ${reply.error.message}`, true)
      }
      const expectsFollowup = !request.value.context.capabilities.editableHistory
      if (
        (request.value.context.askWhy && reply.value.kind !== 'answer')
        || (!request.value.context.askWhy && (
          (expectsFollowup && reply.value.kind === 'scenario')
          || (!expectsFollowup && reply.value.kind === 'followup')
        ))
      ) {
        const expectedKind = request.value.context.askWhy ? 'answer' : expectsFollowup ? 'followup' : 'scenario'
        if (attempt === 0) {
          validationFeedback = `this request requires kind "${expectedKind}" based on context.capabilities.editableHistory`
          continue
        }
        return unavailable(`Gemini returned the wrong planner reply kind twice; expected "${expectedKind}" for this request.`, true)
      }
      if (
        (reply.value.kind === 'scenario' && reply.value.plan.simulationId !== request.value.simulationId)
        || (reply.value.kind === 'followup' && reply.value.request.simulationId !== request.value.simulationId)
      ) {
        return unavailable('Gemini returned a plan for a different simulation; no changes were applied.', true)
      }
      if (request.value.context.askWhy && reply.value.kind === 'answer') {
        const availableEventIds = new Set((request.value.context.events ?? []).map((event) => event.id))
        if (reply.value.evidenceEventIds.some((id) => !availableEventIds.has(id))) {
          return unavailable('Gemini cited an event that was not included in the supplied run evidence.', false)
        }
      }
      return { ok: true, value: reply.value }
    }
    return unavailable('Gemini could not produce a valid plan after one correction attempt.', true)
  }
}
