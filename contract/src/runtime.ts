import { z } from 'zod';
import { DISC_IMPULSE_VERSION, DiscImpulseStateSchema } from './contact.js';
import { CounterSchema, HeaderSchema, IdSchema, JsonValueSchema, NonnegativeSchema, RandomStateSchema, SimTimeSchema, TickSchema, Vec2Schema, VersionsSchema, uniqueIds } from './common.js';
import { AppearanceSchema, EntityBlueprintSchema, ResolvedAgentComponentsSchema } from './entities.js';
import { DefineRuleOperationSchema } from './operations.js';
import { AgentProfileSchema, CompileOutputSchema, CompiledGoalSchema, CompiledMapSchema, CompiledOperationSchema, ModelPresetSchema } from './world.js';
import { EventRecordSchema, MetricsStateSchema, OriginSchema } from './metrics.js';
import { CommandCursorSchema, HistoryStateSchema } from './history.js';
import { ScenarioPlanSchema } from './planner.js';

export const AgentStateSchema = z.enum(['idle', 'reacting', 'moving', 'waiting', 'queueing', 'interacting', 'blocked', 'immobile', 'departed', 'failed']);
export const GoalRuntimeSchema = z.strictObject({ id: IdSchema, spec: CompiledGoalSchema, execution: z.strictObject({ phase: z.enum(['new', 'travel', 'arrived', 'active']), elapsed: SimTimeSchema, targetPoint: Vec2Schema.nullable() }).optional(), status: z.enum(['pending', 'active', 'suspended', 'completed', 'failed']), cursor: z.array(z.strictObject({ childIndex: CounterSchema, repeatsRemaining: CounterSchema })), startedAt: SimTimeSchema.nullable(), failure: z.strictObject({ code: IdSchema, message: z.string() }).nullable() });
export const AgentRuntimeSchema = z.strictObject({
  id: IdSchema, kind: z.literal('agent'), label: z.string().optional(), tags: z.array(IdSchema), profile: IdSchema, components: ResolvedAgentComponentsSchema, appearance: AppearanceSchema.optional(),
  sensors: z.strictObject({ contactLoad: NonnegativeSchema, contactLoadRatio: NonnegativeSchema }).nullable(),
  state: AgentStateSchema, stateReason: z.string().nullable(), position: Vec2Schema, velocity: Vec2Schema, zoneId: IdSchema.nullable(), controller: IdSchema.nullable(), currentGoal: GoalRuntimeSchema.nullable(), goalQueue: z.array(GoalRuntimeSchema),
  navigation: z.strictObject({ targetEntityId: IdSchema.nullable(), targetPoint: Vec2Schema.nullable(), flowFieldId: IdSchema.nullable(), mapVersion: CounterSchema }),
  timers: z.strictObject({ reactionRemaining: SimTimeSchema, waitRemaining: SimTimeSchema, wanderRefreshRemaining: SimTimeSchema.nullable() }),
  queueRef: z.strictObject({ targetId: IdSchema, ticketId: IdSchema, joinedAt: SimTimeSchema }).nullable(), interactionRef: z.strictObject({ targetId: IdSchema, slotId: IdSchema, endsAt: SimTimeSchema }).nullable(),
  randomState: RandomStateSchema, departedAt: SimTimeSchema.nullable(),
}).refine((v) => (v.state !== 'immobile' || (v.components.mobility.speedMultiplier === 0 && v.velocity.x === 0 && v.velocity.y === 0)) && ((v.state === 'departed') === (v.departedAt !== null)), 'Agent mobility, departure and state disagree');
export const PendingJobSchema = z.strictObject({ id: IdSchema, subjectId: IdSchema.optional(), dueTick: TickSchema, order: CounterSchema, origin: OriginSchema, operations: z.array(CompiledOperationSchema).min(1) });
export const RuleRuntimeSchema = z.strictObject({ definition: DefineRuleOperationSchema, origin: OriginSchema, fired: z.boolean(), nextEligibleTick: TickSchema, subjects: z.record(IdSchema, z.strictObject({ heldTicks: CounterSchema, fired: z.boolean(), nextEligibleTick: TickSchema })) });
export const QueueRuntimeSchema = z.strictObject({ targetId: IdSchema, serviceCredit: NonnegativeSchema, entries: z.array(z.strictObject({ ticketId: IdSchema, agentId: IdSchema, joinedAt: SimTimeSchema })) });
export const SlotsRuntimeSchema = z.strictObject({ targetId: IdSchema, slots: z.array(z.strictObject({ id: IdSchema, agentId: IdSchema.nullable(), endsAt: SimTimeSchema.nullable() }).refine((v) => (v.agentId === null) === (v.endsAt === null), 'Slot agent and end time must both be null or both present')) });
export const MapOverlaySchema = z.strictObject({ id: IdSchema, entityId: IdSchema, cells: z.array(CounterSchema), kind: z.enum(['portal', 'obstacle', 'immobile']) });
export const AllocationStateSchema = z.strictObject({ nextEntity: CounterSchema, nextGoal: CounterSchema, nextJob: CounterSchema, nextTicket: CounterSchema, nextEvent: CounterSchema, reserved: z.array(z.strictObject({ key: IdSchema, ids: z.array(IdSchema) })) });
export const RandomStreamsSchema = z.strictObject({ layout: RandomStateSchema, placement: RandomStateSchema, ruleSampling: z.record(IdSchema, RandomStateSchema) });
export const EngineSnapshotSchema = HeaderSchema.extend({
  id: IdSchema, initialSceneHash: IdSchema, versions: VersionsSchema.extend({ engine: IdSchema }), tick: TickSchema, model: ModelPresetSchema, map: CompiledMapSchema, topologyVersion: CounterSchema, overlays: z.array(MapOverlaySchema), entities: z.array(EntityBlueprintSchema), entityOrigins: z.array(z.strictObject({ entityId: IdSchema, origin: OriginSchema })),
  profiles: z.record(IdSchema, AgentProfileSchema), controllers: z.record(IdSchema, CompiledGoalSchema), agents: z.array(AgentRuntimeSchema), jobs: z.array(PendingJobSchema), rules: z.array(RuleRuntimeSchema), queues: z.array(QueueRuntimeSchema), slots: z.array(SlotsRuntimeSchema), allocations: AllocationStateSchema, random: RandomStreamsSchema,
  metrics: MetricsStateSchema, events: z.array(EventRecordSchema), historyRevision: CounterSchema, appliedThrough: CommandCursorSchema, contactState: z.strictObject({ solverVersion: IdSchema, data: JsonValueSchema }).nullable(),
}).superRefine((v, ctx) => {
  if (v.versions.model !== v.model.version || v.map.units !== v.model.units || v.appliedThrough.tick > v.tick) ctx.addIssue({ code: 'custom', message: 'Snapshot version, units or cursor mismatch' });
  if (!uniqueIds([...v.entities, ...v.agents]) || !uniqueIds(v.jobs) || !uniqueIds(v.events) || !uniqueIds(v.overlays)) ctx.addIssue({ code: 'custom', message: 'Duplicate snapshot IDs' });
  const tickets = v.queues.flatMap((q) => q.entries);
  const occupied = v.slots.flatMap((s) => s.slots).filter((s) => s.agentId !== null);
  if (new Set(v.queues.map((q) => q.targetId)).size !== v.queues.length || new Set(v.slots.map((s) => s.targetId)).size !== v.slots.length || new Set(tickets.map((e) => e.ticketId)).size !== tickets.length || new Set(tickets.map((e) => e.agentId)).size !== tickets.length || new Set(occupied.map((s) => s.agentId)).size !== occupied.length || v.slots.some((s) => !uniqueIds(s.slots)) || new Set(v.rules.map((r) => r.definition.id)).size !== v.rules.length) ctx.addIssue({ code: 'custom', message: 'Duplicate queue, slot, claim or rule' });
  if (v.contactState && v.contactState.solverVersion !== v.model.contact?.solverVersion) ctx.addIssue({ code: 'custom', message: 'Contact solver state does not match model' });
  if (v.contactState?.solverVersion === DISC_IMPULSE_VERSION) {
    const state = DiscImpulseStateSchema.safeParse(v.contactState.data);
    if (state.success) {
      if (state.data.sampleTick === null ? v.tick !== 0 : state.data.sampleTick !== v.tick || state.data.dt !== v.model.dt) ctx.addIssue({ code: 'custom', message: 'Contact sample clock mismatch' });
      for (const a of v.agents) if (a.sensors) {
        const load = state.data.sampleTick === null ? NaN : (state.data.impulses[a.id] ?? []).reduce((sum, value) => sum + value, 0) / state.data.dt;
        if (!Number.isFinite(load) || Math.abs(load - a.sensors.contactLoad) > 1e-8 * Math.max(1, load)) ctx.addIssue({ code: 'custom', message: 'Contact impulse sum and sensor disagree' });
      }
    }
  }
  const agents = new Map(v.agents.map((a) => [a.id, a]));
  for (const a of v.agents) {
    if (!Object.hasOwn(v.profiles, a.profile) || (a.controller !== null && !Object.hasOwn(v.controllers, a.controller)) || a.navigation.mapVersion !== v.topologyVersion) ctx.addIssue({ code: 'custom', message: `Invalid runtime references for ${a.id}` });
    if (a.sensors && (!v.model.contact || Math.abs(a.sensors.contactLoad / v.model.contact.referenceLoad - a.sensors.contactLoadRatio) > 1e-8 * Math.max(1, a.sensors.contactLoadRatio))) ctx.addIssue({ code: 'custom', message: `Invalid contact sensor sample for ${a.id}` });
    if (a.queueRef && !v.queues.some((q) => q.targetId === a.queueRef!.targetId && q.entries.some((e) => e.agentId === a.id && e.ticketId === a.queueRef!.ticketId && e.joinedAt === a.queueRef!.joinedAt))) ctx.addIssue({ code: 'custom', message: `Missing queue claim for ${a.id}` });
    if (a.interactionRef && !v.slots.some((s) => s.targetId === a.interactionRef!.targetId && s.slots.some((slot) => slot.agentId === a.id && slot.id === a.interactionRef!.slotId && slot.endsAt === a.interactionRef!.endsAt))) ctx.addIssue({ code: 'custom', message: `Missing slot claim for ${a.id}` });
  }
  const portals = new Map([...v.map.portals.map((p) => [p.id, p.connects] as const), ...(v.map.entities ?? []).filter((e) => e.kind === 'portal' && e.components?.portal).map((e) => [e.id, e.components!.portal!.connects] as const)]);
  for (const visit of v.metrics.portalVisits ?? []) if (!agents.has(visit.agentId) || agents.get(visit.agentId)!.departedAt !== null || !portals.has(visit.portalId) || (visit.fromZone !== null && !portals.get(visit.portalId)!.includes(visit.fromZone))) ctx.addIssue({ code: 'custom', message: 'Invalid in-progress portal visit' });
  for (const q of v.queues) for (const e of q.entries) if (agents.get(e.agentId)?.queueRef?.ticketId !== e.ticketId || agents.get(e.agentId)?.queueRef?.targetId !== q.targetId) ctx.addIssue({ code: 'custom', message: 'Queue entry has no matching agent claim' });
  for (const s of v.slots) for (const slot of s.slots) if (slot.agentId !== null && (agents.get(slot.agentId)?.interactionRef?.slotId !== slot.id || agents.get(slot.agentId)?.interactionRef?.targetId !== s.targetId)) ctx.addIssue({ code: 'custom', message: 'Slot has no matching agent claim' });
});
export const SavedSimulationSchema = z.strictObject({ plan: ScenarioPlanSchema, compiled: CompileOutputSchema, history: HistoryStateSchema, snapshots: z.array(EngineSnapshotSchema) }).refine((v) => v.plan.simulationId === v.compiled.scene.simulationId && v.snapshots.every((s) => s.simulationId === v.plan.simulationId), 'Saved simulation IDs disagree');
export type AgentState = z.infer<typeof AgentStateSchema>;
export type GoalRuntime = z.infer<typeof GoalRuntimeSchema>;
export type AgentRuntime = z.infer<typeof AgentRuntimeSchema>;
export type PendingJob = z.infer<typeof PendingJobSchema>;
export type RuleRuntime = z.infer<typeof RuleRuntimeSchema>;
export type QueueRuntime = z.infer<typeof QueueRuntimeSchema>;
export type SlotsRuntime = z.infer<typeof SlotsRuntimeSchema>;
export type MapOverlay = z.infer<typeof MapOverlaySchema>;
export type AllocationState = z.infer<typeof AllocationStateSchema>;
export type RandomStreams = z.infer<typeof RandomStreamsSchema>;
export type EngineSnapshot = z.infer<typeof EngineSnapshotSchema>;
export type SavedSimulation = z.infer<typeof SavedSimulationSchema>;
