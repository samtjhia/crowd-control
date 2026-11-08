/**
 * Mock simulation: a deterministic, deliberately simple stand-in for A's Rust engine.
 *
 * It speaks the real WorkerCommand/WorkerMessage protocol so the renderer, controls,
 * click tools and chat can be built before the engine exists. People walk straight lines
 * from room to room through open doorways (rooms are treated as convex): there is no
 * avoidance, flow field, queueing, contact physics or replay. Unsupported requests return explicit UNSUPPORTED_CAPABILITY errors. Its output
 * is development data and must never be presented or tested as real simulation results.
 */
import {
  SCHEMA_VERSION,
  parseWorkerCommand,
  type AgentState,
  type Appearance,
  type ApplyAck,
  type PortalRecord,
  type CompactSpawn,
  type CompileOutput,
  type CompiledGoal,
  type CompiledOperation,
  type CompiledScene,
  type ContractError,
  type DensityGrid,
  type EntityKind,
  type EntitySelector,
  type ErrorCode,
  type EventRecord,
  type FollowupRequest,
  type Goal,
  type InventoryItem,
  type JsonValue,
  type MetricSample,
  type Operation,
  type Predicate,
  type ReadQuery,
  type ReadReply,
  type RenderScene,
  type Selector,
  type SetValues,
  type Stamp,
  type Vec2,
  type WorkerCommand,
  type WorkerMessage,
} from '@crowd-control/contract'
import { buildCenters, buildZones, inZone, nextRandom, randomPointInZone, shapeBounds, streamSeed, type ZoneGeometry } from './geometry.ts'

const EPS = 1e-9
const METRICS_INTERVAL = 0.5
const MAX_LEAVES = 256
const MAX_CASCADE = 16
const MAX_RUN_TICKS = 100_000
const MAX_SAMPLES = 2_000

type Fail = { error: ContractError }
const fail = (code: ErrorCode, message: string, extra: Partial<ContractError> = {}): ContractError => ({ code, message, ...extra })
const unsupported = (what: string): ContractError => fail('UNSUPPORTED_CAPABILITY', `Mock worker does not support ${what}; it needs the real engine`)
const isFail = (value: unknown): value is Fail => typeof value === 'object' && value !== null && 'error' in value

/** One executable step of an agent's goal, flattened from a compiled goal tree. */
type Leaf =
  | { kind: 'reach'; zoneId: string | null; point: Vec2 }
  | { kind: 'wander'; zoneId: string; duration: number | null; changeTargetEvery: number | null }
  | { kind: 'wait'; duration: number; zoneId: string | null }
  | { kind: 'hold'; point: Vec2 | null; state: 'queueing' | 'interacting' | 'waiting' }
  /**
   * Use something (a table, a counter, a check-in desk): walk up beside it, wait for a free
   * slot, stay `duration` seconds. Several candidates means the nearest one. Reaching an
   * object is a use that takes no time and has room for everyone.
   */
  | { kind: 'service'; targetIds: string[]; duration: number; slots: number; serving: 'queueing' | 'interacting' }
  /** Keep at least `distance` from every target, stepping away when closer; never completes. */
  | { kind: 'avoid'; ids: string[]; distance: number }
  | { kind: 'fail'; message: string }

type MockAgent = {
  id: string
  label: string | null
  tags: string[]
  profile: string
  controller: string | null
  position: Vec2
  radius: number
  baseSpeed: number
  speedMultiplier: number
  appearance: Appearance
  leaves: Leaf[]
  cursor: number
  leafStartedAt: number | null
  target: Vec2 | null
  waitRemaining: number | null
  retargetAt: number | null
  /** Waypoints (doorway centres, then the target) for the current target, or null when unplanned. */
  route: Vec2[] | null
  routeKey: string | null
  /** No open doorway leads to the target; waits until the topology changes. */
  blocked: boolean
  /** The current route ends in front of a closed door rather than at the target. */
  waitingAtDoor: boolean
  random: number
  departedAt: number | null
  /** The object or desk this person is using (or walking to use), once chosen. */
  serviceTarget?: string | null
}

type Job = { id: string; dueTick: number; order: number; operations: CompiledOperation[] }

type Rule = { id: string; event: string; once: boolean; cooldownTicks: number; fired: boolean; nextEligibleTick: number } & (
  | { action: 'controller'; match: EntitySelector; controller: string; mode: 'replace' | 'enqueue' }
  | { action: 'operations'; operations: Operation[] }
)

type Outcome = { content: string; result: { ok: true; ack: ApplyAck } | { ok: false; error: ContractError } }

/** Everything an operation batch can mutate. Cloned before each batch so failures roll back atomically. */
type MutableState = {
  tick: number
  map: CompiledScene['map']
  agents: MockAgent[]
  jobs: Job[]
  jobOrder: number
  rules: Rule[]
  events: EventRecord[]
  pendingEvents: EventRecord[]
  nextEvent: number
  nextAgent: number
  nextIntervention: number
  removed: number
  topologyVersion: number
  sceneVersion: number
  sceneDirty: boolean
  historyRevision: number
  outcomes: Map<string, Outcome>
}

type World = {
  compiled: CompileOutput
  initialHistoryRevision: number
  simulationId: string
  dt: number
  seed: number
  zones: Map<string, ZoneGeometry>
  centers: Map<string, Vec2>
  entityKinds: Map<string, EntityKind>
  entityTags: Map<string, string[]>
  entityLabels: Map<string, string>
  exitZones: Set<string>
  streamId: string
  samples: MetricSample[]
  metricsBucket: number
  metricsDue: boolean
  state: MutableState
}

const ZERO_CLEARANCE = { t50: null, t90: null, t100: null }
const distance = (a: Vec2, b: Vec2) => Math.hypot(b.x - a.x, b.y - a.y)
const compare = (left: number | string | boolean, comparison: Predicate['comparison'], right: number | string | boolean) => {
  switch (comparison) {
    case 'eq': return left === right
    case 'neq': return left !== right
    case 'lt': return left < right
    case 'lte': return left <= right
    case 'gt': return left > right
    case 'gte': return left >= right
  }
}

function idsFrom(raw: unknown): { simulationId: string; commandId?: string } {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const simulationId = typeof record.simulationId === 'string' && record.simulationId.length > 0 ? record.simulationId : 'unknown'
  return typeof record.commandId === 'string' && record.commandId.length > 0 ? { simulationId, commandId: record.commandId } : { simulationId }
}

export class MockSimulation {
  private world: World | null = null
  private running = false
  private speed = 1
  private streams = 0

  get isRunning(): boolean { return this.running && this.world !== null }
  get speedMultiplier(): number { return this.speed }
  get dt(): number { return this.world?.dt ?? 0.1 }

  /** Handles one transport command and returns every resulting message, in order. */
  handle(raw: WorkerCommand): WorkerMessage[] {
    const parsed = parseWorkerCommand(raw)
    if (!parsed.ok) {
      const ids = idsFrom(raw)
      return [this.errorMessage(ids.simulationId, ids.commandId, parsed.error)]
    }
    const command = parsed.value
    if (command.type === 'load') return this.load(command.commandId, command.compiled, command.history.historyRevision)
    const world = this.world
    if (!world) return [this.errorMessage(command.simulationId, command.commandId, fail('NOT_FOUND', 'No simulation is loaded in the mock worker'))]
    if (command.simulationId !== world.simulationId) {
      return [this.errorMessage(command.simulationId, command.commandId, fail('INVALID_SCHEMA', 'Command simulationId does not match the loaded simulation'))]
    }
    switch (command.type) {
      case 'reset':
        return this.load(command.commandId, world.compiled, world.initialHistoryRevision)
      case 'pause':
        this.running = false
        return [this.ack(command.commandId)]
      case 'resume':
        this.running = true
        return [this.ack(command.commandId)]
      case 'speed':
        this.speed = command.multiplier
        return [this.ack(command.commandId)]
      case 'step':
        if (command.ticks > MAX_RUN_TICKS) return [this.errorMessage(world.simulationId, command.commandId, fail('RESOURCE_LIMIT', `Step exceeds ${MAX_RUN_TICKS} ticks`))]
        return [...this.advance(command.ticks, true), this.ack(command.commandId)]
      case 'run_to': {
        const target = this.ticksFor(command.time)
        if (target < world.state.tick) {
          return [this.errorMessage(world.simulationId, command.commandId, fail('INVALID_SCHEMA', 'run_to cannot move backward without a restore'))]
        }
        if (target - world.state.tick > MAX_RUN_TICKS) {
          return [this.errorMessage(world.simulationId, command.commandId, fail('RESOURCE_LIMIT', `run_to exceeds ${MAX_RUN_TICKS} ticks`))]
        }
        return [...this.advance(target - world.state.tick, true), this.ack(command.commandId)]
      }
      case 'apply_request':
        return this.apply(command.commandId, command.request)
      case 'query':
        return this.query(command.commandId, command.query)
      case 'seek':
        return [this.errorMessage(world.simulationId, command.commandId, unsupported('rewind; use the Rust engine'))]
      case 'snapshot':
      case 'restore':
        return [this.errorMessage(world.simulationId, command.commandId, unsupported('snapshots or restore'))]
    }
  }

  /** Advances the fixed clock. `force` always emits metrics (used by step/run_to). */
  advance(ticks: number, force = false): WorkerMessage[] {
    const world = this.world
    if (!world || ticks <= 0) return []
    const errors: WorkerMessage[] = []
    for (let i = 0; i < ticks; i++) {
      world.state.tick++
      this.runDueJobs(errors)
      this.stepAgents()
      this.sampleOnCadence()
    }
    return [...errors, ...this.publish(force)]
  }

  // ---------------------------------------------------------------- load

  private load(commandId: string, compiled: CompileOutput, historyRevision: number): WorkerMessage[] {
    const scene = compiled.scene
    const map = structuredClone(scene.map)
    const zones = buildZones(map)
    const centers = buildCenters(map, zones)
    const entityKinds = new Map<string, EntityKind>()
    const entityTags = new Map<string, string[]>()
    const entityLabels = new Map<string, string>()
    const describe = (id: string, kind: EntityKind, tags: string[] | undefined, label: string | undefined) => {
      entityKinds.set(id, kind)
      entityTags.set(id, tags ?? [])
      if (label !== undefined) entityLabels.set(id, label)
    }
    for (const room of map.rooms) describe(room.id, 'zone', room.tags, room.label)
    for (const portal of map.portals) describe(portal.id, 'portal', portal.tags, portal.label)
    for (const entity of map.entities ?? []) describe(entity.id, entity.kind, entity.tags, entity.label)
    if ('grid' in map && map.grid) {
      for (const id of map.grid.zoneIds) if (id && !entityKinds.has(id)) describe(id, 'zone', [], undefined)
      for (const id of map.grid.portalIds) if (id && !entityKinds.has(id)) describe(id, 'portal', [], undefined)
    }
    // A zone is a departure destination when it lies beyond a portal tagged "exit".
    const exitZones = new Set<string>()
    for (const portal of map.portals) if (portal.tags?.includes('exit')) exitZones.add(portal.connects[1])
    for (const entity of map.entities ?? []) {
      const portal = entity.components?.portal
      if (portal && entity.tags?.includes('exit')) exitZones.add(portal.connects[1])
    }

    this.running = false
    this.world = {
      compiled,
      initialHistoryRevision: historyRevision,
      simulationId: scene.simulationId,
      dt: scene.model.dt,
      seed: scene.seed,
      zones,
      centers,
      entityKinds,
      entityTags,
      entityLabels,
      exitZones,
      streamId: `mock-stream-${++this.streams}`,
      samples: [],
      metricsBucket: -1,
      metricsDue: false,
      state: {
        tick: 0,
        map,
        agents: [],
        jobs: [],
        jobOrder: 0,
        rules: [],
        events: [],
        pendingEvents: [],
        nextEvent: 1,
        nextAgent: 1,
        nextIntervention: 1,
        removed: 0,
        topologyVersion: 0,
        sceneVersion: 1,
        sceneDirty: true,
        historyRevision,
        outcomes: new Map(),
      },
    }
    const world = this.world
    const errors: WorkerMessage[] = []

    for (const blueprint of scene.agents) {
      const agent = this.makeAgent({
        id: blueprint.id, tags: blueprint.tags, profile: blueprint.profile, position: { x: blueprint.x, y: blueprint.y },
        ...(blueprint.label === undefined ? {} : { label: blueprint.label }),
        ...(blueprint.components === undefined ? {} : { components: blueprint.components }),
        ...(blueprint.appearance === undefined ? {} : { appearance: blueprint.appearance }),
      })
      world.state.agents.push(agent)
      if (blueprint.controller) this.assignController(agent, blueprint.controller, 'replace')
    }
    world.state.nextAgent = Math.max(0, ...scene.agents.map((a) => Number(/^a(\d+)$/.exec(a.id)?.[1] ?? 0))) + 1

    for (const rule of scene.rules) {
      if ('controller' in rule) {
        world.state.rules.push({
          id: rule.id, event: rule.event, once: rule.once ?? true, cooldownTicks: this.ticksFor(rule.cooldown ?? 0), fired: false, nextEligibleTick: 0,
          action: 'controller', match: rule.match, controller: rule.controller, mode: rule.mode,
        })
      } else if (rule.when.kind === 'event') {
        world.state.rules.push({
          id: rule.id, event: rule.when.name, once: rule.once ?? true, cooldownTicks: this.ticksFor(rule.cooldown ?? 0), fired: false, nextEligibleTick: 0,
          action: 'operations', operations: rule.operations,
        })
      } else {
        errors.push(this.errorMessage(world.simulationId, undefined, { ...unsupported(`${rule.when.kind} rule conditions`), path: `rules.${rule.id}` }))
      }
    }
    for (const job of scene.jobs) {
      world.state.jobs.push({ id: job.id, dueTick: this.ticksFor(job.at), order: world.state.jobOrder++, operations: job.operations })
    }
    this.runDueJobs(errors)
    return [this.ack(commandId), ...this.publish(true), ...errors]
  }

  private makeAgent(spec: {
    id: string; label?: string; tags: string[]; profile: string; position: Vec2
    components?: CompactSpawn['components']; appearance?: Appearance
  }): MockAgent {
    const world = this.world!
    const profile = Object.hasOwn(world.compiled.scene.profiles, spec.profile) ? world.compiled.scene.profiles[spec.profile] : undefined
    const defaults = world.compiled.resolvedModel.defaultAgent
    return {
      id: spec.id,
      label: spec.label ?? null,
      tags: [...spec.tags],
      profile: spec.profile,
      controller: null,
      position: { ...spec.position },
      radius: spec.components?.physical?.radius ?? profile?.radius ?? defaults.physical.radius,
      baseSpeed: spec.components?.navigation?.preferredSpeed ?? profile?.preferredSpeed ?? defaults.navigation.preferredSpeed,
      speedMultiplier: spec.components?.mobility?.speedMultiplier ?? profile?.mobility?.speedMultiplier ?? defaults.mobility.speedMultiplier,
      appearance: { ...spec.appearance },
      leaves: [],
      cursor: 0,
      leafStartedAt: null,
      target: null,
      waitRemaining: null,
      retargetAt: null,
      route: null,
      routeKey: null,
      blocked: false,
      waitingAtDoor: false,
      random: streamSeed(world.seed, spec.id),
      departedAt: null,
    }
  }

  // ---------------------------------------------------------------- clock

  private ticksFor(time: number): number {
    return Math.ceil(time / this.dt - 1e-6)
  }

  private time(): number {
    return Math.round(this.world!.state.tick * this.dt * 1e9) / 1e9
  }

  private runDueJobs(errors: WorkerMessage[]) {
    const world = this.world!
    for (;;) {
      const tick = world.state.tick
      const due = world.state.jobs.filter((job) => job.dueTick <= tick).sort((a, b) => a.dueTick - b.dueTick || a.order - b.order)[0]
      if (!due) return
      world.state.jobs = world.state.jobs.filter((job) => job.order !== due.order)
      const error = this.transact(() => this.runOperations(due.operations, 0))
      if (error) errors.push(this.errorMessage(world.simulationId, undefined, { ...error, jobId: due.id }))
    }
  }

  private stepAgents() {
    const world = this.world!
    const time = this.time()
    for (const agent of world.state.agents) {
      if (agent.departedAt !== null || agent.speedMultiplier === 0) continue
      const leaf = agent.leaves[agent.cursor]
      if (!leaf) continue
      if (agent.leafStartedAt === null) {
        agent.leafStartedAt = time
        agent.target = null
        agent.waitRemaining = null
        agent.retargetAt = null
      }
      const step = agent.baseSpeed * agent.speedMultiplier * this.dt
      switch (leaf.kind) {
        case 'reach':
          if (this.travel(agent, leaf.point, step)) this.completeLeaf(agent, time)
          break
        case 'wander': {
          if (leaf.duration !== null && time - agent.leafStartedAt >= leaf.duration - EPS) {
            this.completeLeaf(agent, time)
            break
          }
          if (!agent.target || (agent.retargetAt !== null && time >= agent.retargetAt - EPS)) {
            const drawn = randomPointInZone(world.zones.get(leaf.zoneId)!, agent.random, agent.radius)
            agent.random = drawn.state
            agent.target = drawn.point
            agent.retargetAt = leaf.changeTargetEvery === null ? null : time + leaf.changeTargetEvery
          }
          if (this.travel(agent, agent.target, step)) agent.target = null
          break
        }
        case 'wait': {
          if (agent.waitRemaining === null) {
            const zone = leaf.zoneId === null ? undefined : world.zones.get(leaf.zoneId)
            if (zone && !inZone(zone, agent.position)) {
              this.travel(agent, zone.center, step)
              break
            }
            agent.waitRemaining = leaf.duration
          }
          agent.waitRemaining -= this.dt
          if (agent.waitRemaining <= EPS) this.completeLeaf(agent, time)
          break
        }
        case 'hold':
          if (leaf.point) this.travel(agent, leaf.point, step)
          break
        case 'service': {
          if (!agent.target) agent.target = this.approach(leaf.targetIds, agent)
          if (agent.waitRemaining === null) {
            if (!this.travel(agent, agent.target, step)) break
            const serving = world.state.agents.filter((other) => {
              const current = other.leaves[other.cursor]
              return other !== agent && other.waitRemaining !== null && current?.kind === 'service' && other.serviceTarget === agent.serviceTarget
            }).length
            if (serving >= leaf.slots) break // waits beside it for a turn
            agent.waitRemaining = leaf.duration
          }
          agent.waitRemaining -= this.dt
          if (agent.waitRemaining <= EPS) this.completeLeaf(agent, time)
          break
        }
        case 'avoid':
          agent.target = this.stepAway(agent, leaf, step)
          break
        case 'fail':
          break
      }
    }
  }

  /**
   * Walks toward `target` via the doorways between rooms; returns true on arrival. The
   * route is replanned when the target or the door layout (topology) changes.
   *
   * With no open route the agent keeps its goal and never passes a closed door: it walks up
   * to the first closed door on its way and waits there, reporting blocked, so a crowd forms
   * at the door. When the door reopens the topology changes and the route is replanned.
   */
  private travel(agent: MockAgent, target: Vec2, step: number): boolean {
    const key = `${target.x},${target.y}|${this.world!.state.topologyVersion}`
    if (agent.routeKey !== key) {
      const open = this.planRoute(agent.position, target)
      agent.route = open ?? this.routeToClosedDoor(agent, target)
      agent.waitingAtDoor = open === null
      agent.routeKey = key
    }
    agent.blocked = false
    if (!agent.route) return false
    let budget = step
    while (agent.route.length > 0 && budget > EPS) {
      const next = agent.route[0]!
      const gap = distance(agent.position, next)
      if (gap <= budget + EPS) {
        agent.position = { ...next }
        budget -= gap
        agent.route.shift()
      } else {
        this.moveToward(agent, next, budget)
        budget = 0
      }
    }
    if (agent.route.length > 0) return false
    if (agent.waitingAtDoor) {
      agent.blocked = true
      return false
    }
    agent.routeKey = null
    return true
  }

  /**
   * The way to the first closed door between the agent and its target, ending at a waiting
   * spot on the agent's side of it. Spots spread across the door's width and a few body
   * widths back (stable per person), so waiting people form a cluster rather than a stack.
   * Empty when even closed doors don't lead there; the agent then waits where it is.
   */
  private routeToClosedDoor(agent: MockAgent, to: Vec2): Vec2[] {
    const hops = this.routeHops(agent.position, to, () => true)
    const index = hops?.findIndex((portal) => !portal.open) ?? -1
    if (!hops || index < 0) return []
    const centre = (portal: PortalRecord) => ({ x: portal.x + portal.width / 2, y: portal.y + portal.height / 2 })
    const door = hops[index]!
    const before = index > 0 ? centre(hops[index - 1]!) : agent.position
    const middle = centre(door)
    // A door taller than it is wide is crossed left-right; otherwise top-bottom.
    const acrossX = door.height >= door.width
    const side = Math.sign(acrossX ? before.x - middle.x : before.y - middle.y) || 1
    const spread = streamSeed(0, `${agent.id}-door-spread`) / 4294967296 - 0.5
    const back = streamSeed(0, `${agent.id}-door-back`) / 4294967296
    const span = Math.max(0, (acrossX ? door.height : door.width) - agent.radius * 2)
    const half = (acrossX ? door.width : door.height) / 2
    // Between about half a body and three bodies back from the door.
    const depth = half + agent.radius * (1.2 + back * 4.8)
    const spot = acrossX
      ? { x: middle.x + side * depth, y: middle.y + spread * span }
      : { x: middle.x + spread * span, y: middle.y + side * depth }
    // Keep the spot in the room the agent arrives from; fall back to just in front of the door.
    const zoneId = this.zoneOf(before)
    const zone = zoneId ? this.world!.zones.get(zoneId) : undefined
    const front = half + agent.radius * 1.2
    const near = acrossX ? { x: middle.x + side * front, y: middle.y } : { x: middle.x, y: middle.y + side * front }
    const waitAt = !zone || inZone(zone, spot) ? spot : near
    return [...hops.slice(0, index).map(centre), waitAt]
  }

  /** Doorway centres from the agent's room to the target's room (breadth-first over open portals). */
  private planRoute(from: Vec2, to: Vec2): Vec2[] | null {
    const hops = this.routeHops(from, to, (portal) => portal.open)
    if (!hops) return null
    return [...hops.map((portal) => ({ x: portal.x + portal.width / 2, y: portal.y + portal.height / 2 })), { ...to }]
  }

  /** The doors passed, in order, from one room to another (breadth-first over `usable` doors); null when unreachable. */
  private routeHops(from: Vec2, to: Vec2, usable: (portal: PortalRecord) => boolean): PortalRecord[] | null {
    const start = this.zoneOf(from)
    const goal = this.zoneOf(to)
    if (!start || !goal || start === goal) return []
    const portals = this.world!.state.map.portals.filter(usable)
    const previous = new Map<string, { zone: string; door: PortalRecord }>()
    const queue = [start]
    const seen = new Set([start])
    while (queue.length > 0) {
      const zone = queue.shift()!
      if (zone === goal) break
      for (const portal of portals) {
        const [a, b] = portal.connects
        if (a !== zone && b !== zone) continue
        if (portal.oneWay && a !== zone) continue
        const other = a === zone ? b : a
        if (seen.has(other)) continue
        seen.add(other)
        previous.set(other, { zone, door: portal })
        queue.push(other)
      }
    }
    if (!seen.has(goal)) return null
    const zones = [goal]
    for (let zone = goal; zone !== start;) {
      zone = previous.get(zone)!.zone
      zones.unshift(zone)
    }
    // Between each pair of rooms, use the nearest door, so a crowd spreads over every exit
    // instead of all taking whichever door is listed first.
    const doors: PortalRecord[] = []
    let at = from
    for (let i = 0; i + 1 < zones.length; i++) {
      const here = zones[i]!, next = zones[i + 1]!
      const centre = (portal: PortalRecord) => ({ x: portal.x + portal.width / 2, y: portal.y + portal.height / 2 })
      const options = portals.filter((portal) => {
        const [a, b] = portal.connects
        return (a === here && b === next) || (!portal.oneWay && a === next && b === here)
      })
      const door = options.reduce((best, portal) => (distance(at, centre(portal)) < distance(at, centre(best)) ? portal : best))
      doors.push(door)
      at = centre(door)
    }
    return doors
  }

  /** Straight-line movement toward one waypoint; returns true on arrival. */
  private moveToward(agent: MockAgent, target: Vec2, step: number): boolean {
    const remaining = distance(agent.position, target)
    if (remaining <= step + EPS) {
      agent.position = { ...target }
      return true
    }
    agent.position = {
      x: agent.position.x + ((target.x - agent.position.x) / remaining) * step,
      y: agent.position.y + ((target.y - agent.position.y) / remaining) * step,
    }
    return false
  }

  /**
   * Where to stand to use one of `ids`: beside the nearest one. For an object, a free spot
   * just outside its edge (people spread around a table rather than stacking on one point);
   * for a room or door, its centre.
   */
  private approach(ids: string[], agent: MockAgent): Vec2 {
    const world = this.world!
    let best: { id: string; at: Vec2 } | null = null
    for (const id of ids) {
      const at = world.centers.get(id)
      if (at && (!best || distance(agent.position, at) < distance(agent.position, best.at))) best = { id, at }
    }
    if (!best) return agent.position
    const chosen = best
    agent.serviceTarget = chosen.id
    const shape = world.state.map.entities?.find((entity) => entity.id === chosen.id && entity.kind === 'object')?.shape
    if (!shape) return chosen.at
    const b = shapeBounds(shape)
    const gap = agent.radius + 0.15
    const spots: Vec2[] = []
    for (let k = 0; k < 8; k++) {
      const t = (k + 0.5) / 8
      spots.push({ x: b.x + t * b.width, y: b.y - gap }, { x: b.x + t * b.width, y: b.y + b.height + gap }, { x: b.x - gap, y: b.y + t * b.height }, { x: b.x + b.width + gap, y: b.y + t * b.height })
    }
    const free = spots.filter((p) => this.zoneOf(p) !== null)
    if (free.length === 0) return chosen.at
    agent.random = nextRandom(agent.random)
    return free[agent.random % free.length]!
  }

  /** Distance from a point to an entity: to the edge of its shape, else to its centre or position. */
  private distanceTo(id: string, p: Vec2): number | null {
    const world = this.world!
    const shape = world.state.map.entities?.find((entity) => entity.id === id)?.shape
    if (shape?.kind === 'circle') return Math.max(0, distance(p, shape.center) - shape.radius)
    if (shape) {
      const b = shapeBounds(shape)
      return Math.hypot(Math.max(b.x - p.x, 0, p.x - b.x - b.width), Math.max(b.y - p.y, 0, p.y - b.y - b.height))
    }
    const at = world.centers.get(id) ?? world.state.agents.find((a) => a.id === id)?.position
    return at ? distance(p, at) : null
  }

  /** One step directly away from the nearest thing to avoid, turning to stay on the floor; null when safe or cornered. */
  private stepAway(agent: MockAgent, leaf: Extract<Leaf, { kind: 'avoid' }>, step: number): Vec2 | null {
    const world = this.world!
    let nearest: { d: number; from: Vec2 } | null = null
    for (const id of leaf.ids) {
      const d = this.distanceTo(id, agent.position)
      const from = world.centers.get(id) ?? world.state.agents.find((a) => a.id === id)?.position
      if (d !== null && from && (!nearest || d < nearest.d)) nearest = { d, from }
    }
    if (!nearest || nearest.d >= leaf.distance - EPS) return null
    const dx = agent.position.x - nearest.from.x, dy = agent.position.y - nearest.from.y
    const base = Math.hypot(dx, dy) < EPS ? 0 : Math.atan2(dy, dx)
    for (const turn of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
      const next = { x: agent.position.x + Math.cos(base + turn) * step, y: agent.position.y + Math.sin(base + turn) * step }
      if (this.zoneOf(next) !== null) {
        agent.position = next
        return next
      }
    }
    return null
  }

  private completeLeaf(agent: MockAgent, time: number) {
    const leaf = agent.leaves[agent.cursor]
    agent.serviceTarget = null
    agent.cursor++
    agent.leafStartedAt = null
    agent.target = null
    agent.waitRemaining = null
    agent.retargetAt = null
    if (agent.cursor >= agent.leaves.length && leaf?.kind === 'reach' && leaf.zoneId !== null && this.world!.exitZones.has(leaf.zoneId)) {
      agent.departedAt = time
      this.recordEvent('departed', agent.id)
    }
  }

  // ---------------------------------------------------------------- goals

  private assignController(agent: MockAgent, controllerId: string, mode: 'replace' | 'enqueue') {
    const controllers = this.world!.compiled.scene.controllers
    const goal = Object.hasOwn(controllers, controllerId) ? controllers[controllerId] : undefined
    this.assignGoal(agent, goal ?? null, controllerId, mode)
  }

  private assignGoal(agent: MockAgent, goal: CompiledGoal | null, controllerId: string | null, mode: 'replace' | 'enqueue') {
    const leaves = goal ? this.compileLeaves(goal, [], 0) : [{ kind: 'fail' as const, message: `Unknown controller ${controllerId}` }]
    if (mode === 'enqueue' && agent.cursor < agent.leaves.length) {
      agent.leaves = [...agent.leaves.slice(agent.cursor), ...leaves]
      agent.cursor = 0
    } else {
      agent.leaves = leaves
      agent.cursor = 0
      agent.leafStartedAt = null
      agent.target = null
      agent.waitRemaining = null
      agent.retargetAt = null
      agent.route = null
      agent.routeKey = null
      agent.blocked = false
    }
    agent.controller = controllerId
  }

  private compileLeaves(goal: CompiledGoal, out: Leaf[], depth: number): Leaf[] {
    const world = this.world!
    if (out.length >= MAX_LEAVES || depth > MAX_CASCADE) return out
    const centerOf = (id: string): Vec2 | null => world.centers.get(id) ?? world.state.agents.find((a) => a.id === id)?.position ?? null
    switch (goal.kind) {
      case 'sequence':
        for (let r = 0; r < (goal.repeat ?? 1); r++) for (const child of goal.goals) this.compileLeaves(child, out, depth + 1)
        return out
      case 'reach': {
        // Objects (tables, counters): walk up beside the nearest one.
        const candidates = 'targetZone' in goal ? [goal.targetZone] : 'targetEntityId' in goal ? [goal.targetEntityId] : goal.targetIds
        if (candidates.every((candidate) => world.entityKinds.get(candidate) === 'object')) {
          out.push({ kind: 'service', targetIds: candidates, duration: 0, slots: Infinity, serving: 'interacting' })
          return out
        }
        // A fixed candidate set is not route-ranked in the mock; it takes the first candidate.
        const id = 'targetZone' in goal ? goal.targetZone : 'targetEntityId' in goal ? goal.targetEntityId : goal.targetIds[0]
        const point = id === undefined ? null : centerOf(id)
        out.push(point && id !== undefined ? { kind: 'reach', zoneId: world.zones.has(id) ? id : null, point: { ...point } } : { kind: 'fail', message: `Unknown reach target ${id}` })
        return out
      }
      case 'wander':
        out.push(world.zones.has(goal.insideZone)
          ? { kind: 'wander', zoneId: goal.insideZone, duration: goal.duration ?? null, changeTargetEvery: goal.changeTargetEvery ?? null }
          : { kind: 'fail', message: `Unknown wander zone ${goal.insideZone}` })
        return out
      case 'wait':
        out.push({ kind: 'wait', duration: goal.duration, zoneId: goal.insideZone ?? null })
        return out
      case 'avoid': {
        const ids = 'targetZone' in goal ? [goal.targetZone] : 'targetEntityId' in goal ? [goal.targetEntityId] : goal.targetIds
        out.push({ kind: 'avoid', ids, distance: goal.distance })
        return out
      }
      case 'queue':
      case 'interact': {
        const id = goal.targetEntityId
        const entity = world.state.map.entities?.find((candidate) => candidate.id === id)
        const portal = world.state.map.portals.find((candidate) => candidate.id === id)
        const interaction = entity?.components?.interaction
        const capacity = entity?.components?.capacity
        if (!world.centers.has(id)) out.push({ kind: 'fail', message: `Unknown target ${id}` })
        else if (goal.kind === 'interact' && !interaction) out.push({ kind: 'fail', message: 'Interact target needs interaction components' })
        else if (goal.kind === 'queue' && !portal && !capacity && !interaction) out.push({ kind: 'fail', message: 'Queue target needs capacity or portal components' })
        else {
          const duration = interaction?.duration ?? portal?.traversalTime ?? (capacity?.serviceRate ? 1 / capacity.serviceRate : 2)
          const slots = interaction?.slots ?? capacity?.maximumOccupants ?? 1
          out.push({ kind: 'service', targetIds: [id], duration, slots, serving: goal.kind === 'queue' ? 'queueing' : 'interacting' })
        }
        return out
      }
      case 'follow': {
        const point = centerOf(goal.targetEntityId)
        out.push(point ? { kind: 'hold', point: { ...point }, state: 'waiting' } : { kind: 'fail', message: `Unknown target ${goal.targetEntityId}` })
        return out
      }
    }
  }

  private toCompiledGoal(goal: Goal): CompiledGoal | Fail {
    const single = (selector: Selector): string | Fail => {
      const ids = this.resolve(selector)
      if (isFail(ids)) return ids
      if (ids.length === 0) return { error: fail('NOT_FOUND', 'Goal target matched nothing') }
      if (ids.length > 1) return { error: fail('AMBIGUOUS_SELECTOR', 'Goal target must match exactly one entity') }
      return ids[0]!
    }
    const zone = (selector: Selector): string | Fail => {
      const ids = this.resolve(selector)
      if (isFail(ids)) return ids
      const id = ids.find((candidate) => this.world!.zones.has(candidate))
      return id ?? { error: fail('NOT_FOUND', 'Goal region matched no zone') }
    }
    switch (goal.kind) {
      case 'sequence': {
        const goals: CompiledGoal[] = []
        for (const child of goal.goals) {
          const compiled = this.toCompiledGoal(child)
          if (isFail(compiled)) return compiled
          goals.push(compiled)
        }
        return goal.repeat === undefined ? { kind: 'sequence', goals } : { kind: 'sequence', goals, repeat: goal.repeat }
      }
      case 'reach':
      case 'avoid': {
        const ids = this.resolve(goal.target)
        if (isFail(ids)) return ids
        if (ids.length === 0) return { error: fail('NOT_FOUND', 'Goal target matched nothing') }
        const destination = ids.length > 1 ? { targetIds: ids } : this.world!.zones.has(ids[0]!) ? { targetZone: ids[0]! } : { targetEntityId: ids[0]! }
        return goal.kind === 'reach' ? { kind: 'reach', ...destination } : { kind: 'avoid', distance: goal.distance, ...destination }
      }
      case 'wait': {
        if (!goal.inside) return { kind: 'wait', duration: goal.duration }
        const insideZone = zone(goal.inside)
        return isFail(insideZone) ? insideZone : { kind: 'wait', duration: goal.duration, insideZone }
      }
      case 'wander': {
        const insideZone = zone(goal.inside)
        if (isFail(insideZone)) return insideZone
        return { kind: 'wander', insideZone, ...(goal.duration === undefined ? {} : { duration: goal.duration }), ...(goal.changeTargetEvery === undefined ? {} : { changeTargetEvery: goal.changeTargetEvery }) }
      }
      case 'follow':
      case 'queue':
      case 'interact': {
        const targetEntityId = single(goal.target)
        if (isFail(targetEntityId)) return targetEntityId
        if (goal.kind === 'follow') return { kind: 'follow', targetEntityId, distance: goal.distance }
        return goal.kind === 'queue' ? { kind: 'queue', targetEntityId } : { kind: 'interact', targetEntityId }
      }
    }
  }

  private agentState(agent: MockAgent): AgentState {
    if (agent.departedAt !== null) return 'departed'
    if (agent.speedMultiplier === 0) return 'immobile'
    if (agent.blocked) return 'blocked'
    const leaf = agent.leaves[agent.cursor]
    if (!leaf) return 'idle'
    switch (leaf.kind) {
      case 'fail': return 'failed'
      case 'hold': return leaf.point && distance(agent.position, leaf.point) > EPS ? 'moving' : leaf.state
      case 'wait': return agent.waitRemaining === null ? 'moving' : 'waiting'
      case 'service':
        if (agent.waitRemaining !== null) return leaf.duration === 0 ? 'moving' : leaf.serving
        return agent.target && distance(agent.position, agent.target) > EPS ? 'moving' : 'queueing'
      case 'avoid': return agent.target ? 'moving' : 'waiting'
      default: return 'moving'
    }
  }

  // ---------------------------------------------------------------- selectors

  private agentsById(): Map<string, MockAgent> {
    return new Map(this.world!.state.agents.map((agent) => [agent.id, agent]))
  }

  private zoneOf(position: Vec2): string | null {
    for (const [id, zone] of this.world!.zones) if (inZone(zone, position)) return id
    return null
  }

  private resolve(selector: Selector): string[] | Fail {
    if ('binding' in selector) return { error: unsupported('subject bindings (entity_metric rules)') }
    return this.resolveEntities(selector)
  }

  private resolveEntities(selector: EntitySelector): string[] | Fail {
    const world = this.world!
    const agents = this.agentsById()
    const kindOf = (id: string) => (agents.has(id) ? 'agent' : world.entityKinds.get(id))
    const positionOf = (id: string) => agents.get(id)?.position ?? world.centers.get(id)
    let ids = [...world.entityKinds.keys(), ...agents.keys()]
    if (selector.ids) {
      const wanted = new Set(selector.ids)
      ids = ids.filter((id) => wanted.has(id))
    }
    if (selector.kind) ids = ids.filter((id) => kindOf(id) === selector.kind)
    if (selector.tags) {
      const tags = selector.tags
      ids = ids.filter((id) => {
        const own = agents.get(id)?.tags ?? world.entityTags.get(id) ?? []
        return tags.every((tag) => own.includes(tag))
      })
    }
    if (selector.label !== undefined) ids = ids.filter((id) => (agents.get(id)?.label ?? world.entityLabels.get(id)) === selector.label)
    if (selector.inside) {
      const regions = this.resolveEntities(selector.inside)
      if (isFail(regions)) return regions
      const zones = regions.flatMap((id) => world.zones.get(id) ?? [])
      ids = ids.filter((id) => {
        const position = positionOf(id)
        return position !== undefined && zones.some((zone) => inZone(zone, position))
      })
    }
    for (const predicate of selector.where ?? []) {
      const kept: string[] = []
      for (const id of ids) {
        const value = this.readPath(id, predicate.path, agents)
        if (isFail(value)) return value
        if (value !== undefined && compare(value, predicate.comparison, predicate.value)) kept.push(id)
      }
      ids = kept
    }
    if (selector.near) {
      // Within `distance` of any of the targets (a door, a danger, a person), nearest first, so
      // "two people near the door" are the two closest to it.
      const targets = this.resolveEntities(selector.near.targets)
      if (isFail(targets)) return targets
      const { distance: within } = selector.near
      const gapTo = (id: string) => {
        const at = positionOf(id)
        if (!at) return Infinity
        return Math.min(...targets.filter((target) => target !== id).map((target) => this.distanceTo(target, at) ?? Infinity))
      }
      ids = ids.map((id) => ({ id, gap: gapTo(id) })).filter(({ gap }) => gap <= within + EPS).sort((a, b) => a.gap - b.gap).map(({ id }) => id)
    }
    if (selector.sample) {
      // Deterministic but not seeded: the mock takes the first matches in stable order.
      ids = 'count' in selector.sample ? ids.slice(0, selector.sample.count) : ids.slice(0, Math.floor(ids.length * selector.sample.fraction))
    }
    return ids
  }

  private readPath(id: string, path: Predicate['path'], agents: Map<string, MockAgent>): number | string | boolean | undefined | Fail {
    const agent = agents.get(id)
    switch (path) {
      case 'state': return agent ? this.agentState(agent) : undefined
      case 'zoneId': return agent ? (this.zoneOf(agent.position) ?? undefined) : undefined
      case 'components.mobility.speedMultiplier': return agent?.speedMultiplier
      case 'components.navigation.preferredSpeed': return agent?.baseSpeed
      case 'components.physical.radius': return agent?.radius
      case 'components.portal.open': return this.portalRecord(id)?.open
      default: return { error: unsupported(`where path ${path}`) }
    }
  }

  private portalRecord(id: string): { open: boolean } | undefined {
    const map = this.world!.state.map
    return map.portals.find((portal) => portal.id === id) ?? map.entities?.find((entity) => entity.id === id)?.components?.portal
  }

  // ---------------------------------------------------------------- operations

  /** Runs `fn` against a cloned state; on error the original state is restored untouched. */
  private transact(fn: () => ContractError | null): ContractError | null {
    const world = this.world!
    const backup = structuredClone(world.state)
    const error = fn()
    if (error) world.state = backup
    return error
  }

  private runOperations(operations: CompiledOperation[], depth: number): ContractError | null {
    for (let index = 0; index < operations.length; index++) {
      const error = this.runOperation(operations[index]!, depth)
      if (error) return depth === 0 && error.operationIndex === undefined ? { ...error, operationIndex: index } : error
    }
    return null
  }

  private runOperation(op: CompiledOperation, depth: number): ContractError | null {
    const world = this.world!
    switch (op.op) {
      case 'spawn':
        return 'zone' in op ? this.spawnCompact(op) : this.spawnTemplate(op)
      case 'emit':
        return typeof op.event === 'string' ? this.dispatch(op.event, undefined, undefined, depth) : this.dispatch(op.event.name, op.event.source, op.event.data, depth)
      case 'set':
        return this.setValues(op.targets, op.values)
      case 'assign_goal': {
        const targets = this.agentTargets(op.targets)
        if (isFail(targets)) return targets.error
        const goal = this.toCompiledGoal(op.goal)
        if (isFail(goal)) return goal.error
        for (const agent of targets) this.assignGoal(agent, goal, null, op.mode ?? 'replace')
        return null
      }
      case 'clear_goal': {
        const targets = this.agentTargets(op.targets)
        if (isFail(targets)) return targets.error
        for (const agent of targets) {
          const scope = op.scope ?? 'all'
          if (scope === 'queued') {
            agent.leaves = agent.leaves.slice(0, agent.cursor + 1)
            continue
          }
          agent.leaves = scope === 'all' ? [] : agent.leaves.filter((_, i) => i !== agent.cursor)
          if (scope === 'all') { agent.cursor = 0; agent.controller = null }
          agent.leafStartedAt = null
          agent.target = null
          agent.waitRemaining = null
          agent.retargetAt = null
        }
        return null
      }
      case 'remove': {
        const ids = this.resolve(op.targets)
        if (isFail(ids)) return ids.error
        if (ids.length === 0) return fail('NOT_FOUND', 'remove matched nothing')
        const agents = this.agentsById()
        if (ids.some((id) => !agents.has(id))) return unsupported('removing map entities')
        const removing = new Set(ids)
        world.state.agents = world.state.agents.filter((agent) => !removing.has(agent.id))
        world.state.removed += ids.length
        for (const id of ids) this.recordEvent('removed', id)
        this.markSceneDirty()
        return null
      }
      case 'schedule': {
        const now = this.time()
        if (op.at !== undefined && op.at < now - EPS) return fail('INVALID_SCHEMA', `Schedule ${op.id} is in the past`)
        const dueTick = op.at !== undefined ? this.ticksFor(op.at) : world.state.tick + this.ticksFor(op.after ?? 0)
        world.state.jobs.push({ id: op.id, dueTick, order: world.state.jobOrder++, operations: op.operations })
        return null
      }
      case 'define_rule': {
        if (op.when.kind !== 'event') return unsupported(`${op.when.kind} rule conditions`)
        if (world.state.rules.some((rule) => rule.id === op.id)) return fail('INVALID_SCHEMA', `Rule ${op.id} already exists`)
        world.state.rules.push({
          id: op.id, event: op.when.name, once: op.once ?? true, cooldownTicks: this.ticksFor(op.cooldown ?? 0), fired: false, nextEligibleTick: 0,
          action: 'operations', operations: op.operations,
        })
        return null
      }
      case 'remove_rule': {
        if (!world.state.rules.some((rule) => rule.id === op.id)) return fail('NOT_FOUND', `Rule ${op.id} does not exist`)
        world.state.rules = world.state.rules.filter((rule) => rule.id !== op.id)
        return null
      }
      case 'add':
        return this.addEntity(op)
    }
  }

  /**
   * Adds a map object mid-run (a danger, a new stand). Without a shape it gets a body-sized
   * square at the centre of the first room its placement names. Rooms and doors are not added.
   */
  private addEntity(op: Extract<CompiledOperation, { op: 'add' }>): ContractError | null {
    const world = this.world!
    const entity = structuredClone(op.entity)
    if (entity.kind === 'zone' || entity.kind === 'portal') return unsupported('adding rooms or doors')
    if (world.entityKinds.has(entity.id) || world.state.agents.some((agent) => agent.id === entity.id)) return fail('INVALID_SCHEMA', `Entity ID ${entity.id} already exists`)
    if (!entity.shape) {
      const placement = op.placement
      const region = placement && 'inside' in placement ? this.resolveEntities(placement.inside) : []
      if (isFail(region)) return region.error
      const zone = region.map((id) => world.zones.get(id)).find((candidate) => candidate !== undefined)
      if (!zone) return fail('NO_WALKABLE_SPACE', 'Add needs a shape, or a placement inside a room')
      const size = world.compiled.resolvedModel.layout.bodyDiameter
      entity.shape = { kind: 'rectangle', x: zone.center.x - size / 2, y: zone.center.y - size / 2, width: size, height: size }
    }
    const bounds = shapeBounds(entity.shape)
    world.state.map.entities = [...(world.state.map.entities ?? []), entity]
    world.entityKinds.set(entity.id, entity.kind)
    world.entityTags.set(entity.id, entity.tags ?? [])
    if (entity.label !== undefined) world.entityLabels.set(entity.id, entity.label)
    world.centers.set(entity.id, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 })
    this.markSceneDirty()
    return null
  }

  private agentTargets(selector: Selector): MockAgent[] | Fail {
    const ids = this.resolve(selector)
    if (isFail(ids)) return ids
    const agents = this.agentsById()
    const targets = ids.flatMap((id) => agents.get(id) ?? [])
    return targets.length > 0 ? targets : { error: fail('NOT_FOUND', 'Selector matched no agents') }
  }

  private dispatch(name: string, source: string | undefined, data: JsonValue | undefined, depth: number): ContractError | null {
    const world = this.world!
    if (depth > MAX_CASCADE) return fail('RESOURCE_LIMIT', 'Rule cascade exceeded the mock limit')
    this.recordEvent(name, source, data)
    for (const rule of [...world.state.rules]) {
      if (rule.event !== name || (rule.once && rule.fired) || world.state.tick < rule.nextEligibleTick) continue
      rule.fired = true
      rule.nextEligibleTick = world.state.tick + rule.cooldownTicks
      if (rule.action === 'controller') {
        const ids = this.resolveEntities(rule.match)
        if (isFail(ids)) return ids.error
        const agents = this.agentsById()
        for (const id of ids) {
          const agent = agents.get(id)
          if (agent && agent.departedAt === null) this.assignController(agent, rule.controller, rule.mode)
        }
      } else {
        const error = this.runOperations(rule.operations, depth + 1)
        if (error) return error
      }
    }
    return null
  }

  private setValues(selector: Selector, values: SetValues): ContractError | null {
    const world = this.world!
    const ids = this.resolve(selector)
    if (isFail(ids)) return ids.error
    if (ids.length === 0) return fail('NOT_FOUND', 'set matched nothing')
    const agents = this.agentsById()
    for (const id of ids) {
      const agent = agents.get(id)
      const components = values.components ?? {}
      if (agent) {
        const extra = Object.keys(components).find((key) => key !== 'mobility' && key !== 'navigation')
        if (extra) return unsupported(`setting ${extra} on agents`)
        if (components.navigation) {
          const field = Object.keys(components.navigation).find((key) => key !== 'preferredSpeed')
          if (field) return unsupported(`setting navigation.${field}`)
          if (components.navigation.preferredSpeed !== undefined) agent.baseSpeed = components.navigation.preferredSpeed
        }
        const multiplier = components.mobility?.speedMultiplier
        if (multiplier !== undefined) {
          if (agent.speedMultiplier > 0 && multiplier === 0) this.recordEvent('fall', agent.id)
          if (agent.speedMultiplier === 0 && multiplier > 0) this.recordEvent('recover', agent.id)
          agent.speedMultiplier = multiplier
        }
        if (values.appearance) {
          agent.appearance = { ...agent.appearance, ...values.appearance }
          this.markSceneDirty()
        }
        continue
      }
      const kind = world.entityKinds.get(id)
      const extra = Object.keys(components).find((key) => key !== 'portal' || kind !== 'portal')
      if (extra) return unsupported(`setting ${extra} on ${kind ?? 'entities'}`)
      if (components.portal) {
        const field = Object.keys(components.portal).find((key) => key !== 'open')
        if (field) return unsupported(`setting portal.${field}`)
        const portal = this.portalRecord(id)
        const open = components.portal.open
        if (!portal) return fail('NOT_FOUND', `Portal ${id} has no state`)
        if (open !== undefined && open !== portal.open) {
          portal.open = open
          world.state.topologyVersion++
          this.markSceneDirty()
          this.recordEvent(open ? 'portal_opened' : 'portal_closed', id)
        }
      }
      if (values.appearance) {
        const { symbol, pose, ...mapAppearance } = values.appearance
        if (symbol !== undefined || pose !== undefined) return fail('INVALID_SCHEMA', `symbol and pose apply only to agents, not ${id}`)
        const record = world.state.map.rooms.find((room) => room.id === id) ?? world.state.map.portals.find((portal) => portal.id === id) ?? world.state.map.entities?.find((entity) => entity.id === id)
        if (!record) return unsupported(`styling ${id}`)
        record.appearance = { ...record.appearance, ...mapAppearance }
        this.markSceneDirty()
      }
    }
    return null
  }

  private spawnCompact(op: CompactSpawn): ContractError | null {
    const zone = this.world!.zones.get(op.zone)
    if (!zone) return fail('NOT_FOUND', `Spawn zone ${op.zone} does not exist`)
    return this.spawn({
      zone, count: op.count, profile: op.profile, tags: op.tags, controller: op.controller ?? null,
      ...(op.label === undefined ? {} : { label: op.label }),
      ...(op.components === undefined ? {} : { components: op.components }),
      ...(op.appearance === undefined ? {} : { appearance: op.appearance }),
    })
  }

  private spawnTemplate(op: Extract<Operation, { op: 'spawn' }>): ContractError | null {
    const world = this.world!
    if (!('inside' in op.placement)) return unsupported('spawn placement other than inside')
    const regions = this.resolveEntities(op.placement.inside)
    if (isFail(regions)) return regions.error
    const zone = regions.flatMap((id) => world.zones.get(id) ?? [])[0]
    if (!zone) return fail('NOT_FOUND', 'Spawn placement matched no zone')
    const profile = op.template.profile ?? Object.keys(world.compiled.scene.profiles)[0]
    if (profile === undefined) return fail('NOT_FOUND', 'No agent profile available for spawn')
    return this.spawn({
      zone, count: op.count, profile, tags: op.template.tags ?? [], controller: null,
      ...(op.template.label === undefined ? {} : { label: op.template.label }),
      ...(op.template.components === undefined ? {} : { components: op.template.components }),
      ...(op.template.appearance === undefined ? {} : { appearance: op.template.appearance }),
    })
  }

  private spawn(spec: {
    zone: ZoneGeometry; count: number; profile: string; tags: string[]; controller: string | null
    label?: string; components?: CompactSpawn['components']; appearance?: Appearance
  }): ContractError | null {
    const world = this.world!
    if (!Object.hasOwn(world.compiled.scene.profiles, spec.profile)) return fail('NOT_FOUND', `Profile ${spec.profile} does not exist`)
    const probe = this.makeAgent({ id: 'probe', tags: [], profile: spec.profile, position: { x: 0, y: 0 }, ...(spec.components ? { components: spec.components } : {}) })
    const slots = this.freeSlots(spec.zone, spec.count, probe.radius)
    if (!slots) return fail('NO_WALKABLE_SPACE', `Cannot place ${spec.count} people in ${spec.zone.id} without overlap`)
    const used = new Set([...world.entityKinds.keys(), ...world.state.agents.map((agent) => agent.id)])
    for (const position of slots) {
      let id = `a${world.state.nextAgent++}`
      while (used.has(id)) id = `a${world.state.nextAgent++}`
      used.add(id)
      const agent = this.makeAgent({
        id, tags: spec.tags, profile: spec.profile, position,
        ...(spec.label === undefined ? {} : { label: spec.label }),
        ...(spec.components === undefined ? {} : { components: spec.components }),
        ...(spec.appearance === undefined ? {} : { appearance: spec.appearance }),
      })
      world.state.agents.push(agent)
      if (spec.controller) this.assignController(agent, spec.controller, 'replace')
    }
    this.recordEvent('spawned', spec.zone.id, { count: spec.count })
    this.markSceneDirty()
    return null
  }

  /** Lattice slots at two-radius pitch whose body fits inside the zone and overlaps no one. */
  private freeSlots(zone: ZoneGeometry, count: number, radius: number): Vec2[] | null {
    if (count === 0) return []
    const occupied = this.world!.state.agents.filter((agent) => agent.departedAt === null).map((agent) => ({ position: agent.position, radius: agent.radius }))
    const minX = Math.min(...zone.boxes.map((b) => b.x)), minY = Math.min(...zone.boxes.map((b) => b.y))
    const maxX = Math.max(...zone.boxes.map((b) => b.x + b.width)), maxY = Math.max(...zone.boxes.map((b) => b.y + b.height))
    const reach = radius * 0.999
    const slots: Vec2[] = []
    for (let y = minY + radius; y <= maxY - radius + EPS; y += 2 * radius) {
      for (let x = minX + radius; x <= maxX - radius + EPS; x += 2 * radius) {
        const p = { x, y }
        const fits = [p, { x: x - reach, y }, { x: x + reach, y }, { x, y: y - reach }, { x, y: y + reach }].every((q) => inZone(zone, q))
        if (!fits || occupied.some((o) => distance(o.position, p) < o.radius + radius - EPS)) continue
        slots.push(p)
        occupied.push({ position: p, radius })
        if (slots.length === count) return slots
      }
    }
    return null
  }

  // ---------------------------------------------------------------- requests and queries

  private apply(commandId: string, request: FollowupRequest): WorkerMessage[] {
    const world = this.world!
    const content = JSON.stringify(request)
    const prior = world.state.outcomes.get(request.requestId)
    if (prior) {
      if (prior.content !== content) {
        return [this.errorMessage(world.simulationId, commandId, fail('INVALID_SCHEMA', 'requestId was already used with different content', { requestId: request.requestId }))]
      }
      return [prior.result.ok ? this.ack(commandId, prior.result.ack) : this.errorMessage(world.simulationId, commandId, prior.result.error)]
    }
    if (!('operations' in request)) {
      return [this.errorMessage(world.simulationId, commandId, { ...unsupported('editing or deleting interventions (replay)'), requestId: request.requestId })]
    }
    const now = this.time()
    const at = request.at ?? now
    if (at < now - EPS) {
      return [this.errorMessage(world.simulationId, commandId, { ...unsupported('creating interventions in the past (replay)'), requestId: request.requestId })]
    }
    const interventionId = `mock-intervention-${world.state.nextIntervention}`
    const error = this.transact(() => {
      if (at > now + EPS) {
        world.state.jobs.push({ id: `${interventionId}-at`, dueTick: this.ticksFor(at), order: world.state.jobOrder++, operations: request.operations })
        return null
      }
      return this.runOperations(request.operations, 0)
    })
    if (error) {
      const failure = { ...error, requestId: request.requestId }
      world.state.outcomes.set(request.requestId, { content, result: { ok: false, error: failure } })
      return [this.errorMessage(world.simulationId, commandId, failure)]
    }
    world.state.nextIntervention++
    world.state.historyRevision++
    const ack: ApplyAck = { requestId: request.requestId, interventionId, revision: 1, at, historyRevision: world.state.historyRevision }
    world.state.outcomes.set(request.requestId, { content, result: { ok: true, ack } })
    const published = this.publish(true)
    return [...published.filter((m) => m.type === 'scene'), this.ack(commandId, ack), ...published.filter((m) => m.type !== 'scene')]
  }

  private query(commandId: string, query: ReadQuery): WorkerMessage[] {
    const world = this.world!
    const inRange = (time: number, from?: number, to?: number) => (from === undefined || time >= from) && (to === undefined || time <= to)
    let result: ReadReply
    switch (query.kind) {
      case 'inventory': {
        const agents: InventoryItem[] = world.state.agents.map((agent) => ({
          id: agent.id, kind: 'agent', tags: [...agent.tags], componentNames: ['physical', 'navigation', 'behavior', 'mobility'],
          ...(agent.label === null ? {} : { label: agent.label }),
        }))
        result = { kind: 'inventory', items: [...world.compiled.inventory.filter((item) => item.kind !== 'agent'), ...agents] }
        break
      }
      case 'metrics': {
        const zones = query.zones ? new Set(query.zones) : null
        const samples = world.samples
          .filter((sample) => inRange(sample.time, query.from, query.to))
          .map((sample) => (zones ? { ...sample, zones: sample.zones.filter((z) => zones.has(z.zoneId)) } : sample))
        result = { kind: 'metrics', samples }
        break
      }
      case 'events': {
        const names = query.names ? new Set(query.names) : null
        result = { kind: 'events', events: world.state.events.filter((event) => inRange(event.time, query.from, query.to) && (!names || names.has(event.name))) }
        break
      }
      default:
        return [this.errorMessage(world.simulationId, commandId, unsupported(`${query.kind} queries`))]
    }
    return [{ schemaVersion: SCHEMA_VERSION, simulationId: world.simulationId, type: 'query_result', commandId, stamp: this.stamp(), result }]
  }

  // ---------------------------------------------------------------- messages

  private recordEvent(name: string, source?: string, data?: JsonValue) {
    const state = this.world!.state
    const event: EventRecord = {
      id: `mock-event-${state.nextEvent++}`, tick: state.tick, time: this.time(), name,
      ...(source === undefined ? {} : { source }),
      ...(data === undefined ? {} : { data }),
    }
    state.events.push(event)
    state.pendingEvents.push(event)
  }

  private markSceneDirty() {
    const state = this.world!.state
    if (!state.sceneDirty) {
      state.sceneVersion++
      state.sceneDirty = true
    }
  }

  private stamp(): Stamp {
    const world = this.world!
    return {
      streamId: world.streamId, tick: world.state.tick, time: this.time(),
      topologyVersion: world.state.topologyVersion, sceneVersion: world.state.sceneVersion, historyRevision: world.state.historyRevision,
    }
  }

  /** Scene (if changed), frame, events (if any) and metrics (when a cadence sample was taken, or forced). */
  private publish(force: boolean): WorkerMessage[] {
    const world = this.world!
    const header = { schemaVersion: SCHEMA_VERSION, simulationId: world.simulationId } as const
    const messages: WorkerMessage[] = []
    if (world.state.sceneDirty) {
      world.state.sceneDirty = false
      messages.push({ ...header, type: 'scene', stamp: this.stamp(), scene: this.renderScene() })
    }
    const stamp = this.stamp()
    messages.push({
      ...header, type: 'frame',
      frame: {
        ...stamp,
        agents: world.state.agents.map((agent) => ({
          id: agent.id, x: agent.position.x, y: agent.position.y, profile: agent.profile, controller: agent.controller, state: this.agentState(agent),
        })),
      },
    })
    if (world.state.pendingEvents.length > 0) {
      messages.push({ ...header, type: 'events', stamp, events: world.state.pendingEvents })
      world.state.pendingEvents = []
    }
    if (force || world.metricsDue) {
      world.metricsDue = false
      world.metricsBucket = Math.floor(stamp.time / METRICS_INTERVAL + EPS)
      const { sample, density } = this.measure(stamp.time)
      if (world.samples.at(-1)?.time !== sample.time) this.keepSample(sample)
      messages.push({ ...header, type: 'metrics', stamp, sample, density })
    }
    return messages
  }

  /** Records history on a fixed simulation-time cadence, even inside a long step or run_to. */
  private sampleOnCadence() {
    const world = this.world!
    const time = this.time()
    const bucket = Math.floor(time / METRICS_INTERVAL + EPS)
    if (bucket === world.metricsBucket) return
    world.metricsBucket = bucket
    world.metricsDue = true
    this.keepSample(this.measure(time).sample)
  }

  private keepSample(sample: MetricSample) {
    const samples = this.world!.samples
    samples.push(sample)
    if (samples.length > MAX_SAMPLES) samples.shift()
  }

  private renderScene(): RenderScene {
    const world = this.world!
    const profiles = world.compiled.scene.profiles
    return {
      map: structuredClone(world.state.map),
      entities: structuredClone(world.state.map.entities ?? []),
      agents: world.state.agents.map((agent) => ({
        id: agent.id,
        radius: agent.radius,
        appearance: { ...(Object.hasOwn(profiles, agent.profile) ? profiles[agent.profile]?.appearance : undefined), ...agent.appearance },
        ...(agent.label === null ? {} : { label: agent.label }),
      })),
    }
  }

  private measure(time: number): { sample: MetricSample; density: DensityGrid } {
    const world = this.world!
    const map = world.state.map
    const present = world.state.agents.filter((agent) => agent.departedAt === null)
    const occupancy = new Map<string, number>()
    for (const agent of present) {
      const zoneId = this.zoneOf(agent.position)
      if (zoneId) occupancy.set(zoneId, (occupancy.get(zoneId) ?? 0) + 1)
    }
    const columns = 'grid' in map && map.grid ? map.grid.width : Math.round(map.width / map.cellSize)
    const rows = 'grid' in map && map.grid ? map.grid.height : Math.round(map.height / map.cellSize)
    const cellArea = map.cellSize * map.cellSize
    const values = new Array<number>(columns * rows).fill(0)
    for (const agent of present) {
      const cx = Math.floor(agent.position.x / map.cellSize), cy = Math.floor(agent.position.y / map.cellSize)
      if (cx >= 0 && cx < columns && cy >= 0 && cy < rows) values[cy * columns + cx]! += 1 / cellArea
    }
    return {
      sample: {
        time,
        present: present.length,
        departed: world.state.agents.length - present.length,
        blocked: 0,
        immobile: present.filter((agent) => agent.speedMultiplier === 0).length,
        removed: world.state.removed,
        zones: [...world.zones.values()].map((zone) => {
          const count = occupancy.get(zone.id) ?? 0
          return { zoneId: zone.id, occupancy: count, density: zone.area > 0 ? count / zone.area : 0 }
        }),
        portals: [],
        queues: [],
        clearance: ZERO_CLEARANCE,
      },
      density: {
        width: columns, height: rows, cellSize: map.cellSize, origin: { x: 0, y: 0 },
        units: map.units === 'm' ? 'people/m2' : 'people/model-unit2', values,
      },
    }
  }

  private ack(commandId: string, applied?: ApplyAck): WorkerMessage {
    const world = this.world!
    return {
      schemaVersion: SCHEMA_VERSION, simulationId: world.simulationId, type: 'ack', commandId, stamp: this.stamp(),
      ...(applied ? { applied } : {}),
    }
  }

  private errorMessage(simulationId: string, commandId: string | undefined, error: ContractError): WorkerMessage {
    return { schemaVersion: SCHEMA_VERSION, simulationId, type: 'error', ...(commandId === undefined ? {} : { commandId }), error }
  }
}
