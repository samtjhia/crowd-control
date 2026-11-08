import { z } from 'zod';
import { EntityKindSchema, HeaderSchema, IdSchema, PositiveIntegerSchema, RandomStateSchema, SimTimeSchema, uniqueIds } from './common.js';
import { MapAppearanceSchema } from './entities.js';
import { DefineRuleOperationSchema, EntityMetricSchema, OperationSchema, ScheduleOperationSchema } from './operations.js';
import { EventRecordSchema, MetricSampleSchema, ReadQuerySchema } from './metrics.js';

export const SpacePlanSchema = z.strictObject({ id: IdSchema, label: z.string().optional(), tags: z.array(IdSchema).optional(), areaWeight: PositiveIntegerSchema, appearance: MapAppearanceSchema.optional() });
export const ConnectionPlanSchema = z.strictObject({ id: IdSchema, connects: z.tuple([IdSchema, IdSchema]).refine(([a, b]) => a !== b), label: z.string().optional(), tags: z.array(IdSchema).optional(), appearance: MapAppearanceSchema.optional() });
export const LayoutSourceSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('generate'), spaces: z.array(SpacePlanSchema).min(1), connections: z.array(ConnectionPlanSchema) }).superRefine((v, ctx) => {
    if (!uniqueIds([...v.spaces, ...v.connections])) ctx.addIssue({ code: 'custom', message: 'Layout IDs must be unique' });
    if (v.connections.length !== v.spaces.length - 1 || v.connections.some((c, i) => !c.connects.includes(v.spaces[i]!.id) || !c.connects.includes(v.spaces[i + 1]!.id))) ctx.addIssue({ code: 'custom', message: 'Baseline generated layout requires a connection between each consecutive space' });
  }),
  z.strictObject({ mode: z.literal('upload'), assetId: IdSchema, page: PositiveIntegerSchema }),
  z.strictObject({ mode: z.literal('lookup'), venue: z.string().min(1), floor: z.string().min(1) }),
]);
export const CapabilitiesSchema = z.strictObject({
  operations: z.array(z.enum(['add', 'spawn', 'remove', 'set', 'assign_goal', 'clear_goal', 'schedule', 'define_rule', 'remove_rule', 'emit'])),
  goals: z.array(z.enum(['reach', 'avoid', 'wait', 'wander', 'follow', 'queue', 'interact', 'sequence'])),
  geometry: z.array(z.enum(['rectangle', 'circle', 'polygon', 'thick_line'])), layouts: z.array(z.enum(['generate', 'upload', 'lookup'])), entityMetrics: z.array(EntityMetricSchema), editableHistory: z.boolean(),
});
export const ScenarioPlanSchema = HeaderSchema.extend({ seed: RandomStateSchema, layout: LayoutSourceSchema, initialOperations: z.array(OperationSchema), timeline: z.array(ScheduleOperationSchema), rules: z.array(DefineRuleOperationSchema) });
const followupHeader = { ...HeaderSchema.shape, requestId: IdSchema };
export const CreateInterventionRequestSchema = z.strictObject({ ...followupHeader, action: z.literal('create_intervention').optional(), label: z.string().optional(), at: SimTimeSchema.optional(), operations: z.array(OperationSchema).min(1) });
export const FollowupRequestSchema = z.union([
  CreateInterventionRequestSchema,
  z.strictObject({ ...followupHeader, action: z.literal('edit_intervention'), interventionId: IdSchema, expectedRevision: PositiveIntegerSchema, replacement: z.strictObject({ label: z.string(), at: SimTimeSchema, operations: z.array(OperationSchema).min(1) }) }),
  z.strictObject({ ...followupHeader, action: z.literal('delete_intervention'), interventionId: IdSchema, expectedRevision: PositiveIntegerSchema }),
]);
export const InventoryItemSchema = z.strictObject({ id: IdSchema, kind: EntityKindSchema, label: z.string().optional(), tags: z.array(IdSchema), componentNames: z.array(IdSchema) });
export const InterventionSummarySchema = z.strictObject({ id: IdSchema, revision: PositiveIntegerSchema, label: z.string(), at: SimTimeSchema, deleted: z.boolean() });
export const PlannerRequestSchema = HeaderSchema.extend({ requestId: IdSchema, prompt: z.string().min(1), context: z.strictObject({ capabilities: CapabilitiesSchema, layout: LayoutSourceSchema.optional(), inventory: z.array(InventoryItemSchema), summary: MetricSampleSchema.optional(), metricSamples: z.array(MetricSampleSchema).max(100).optional(), events: z.array(EventRecordSchema).max(100).optional(), interventions: z.array(InterventionSummarySchema), selectedInterventionId: IdSchema.optional(), askWhy: z.boolean().optional() }) });
export const PlannerReplySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('scenario'), plan: ScenarioPlanSchema }), z.strictObject({ kind: z.literal('followup'), request: FollowupRequestSchema }), z.strictObject({ kind: z.literal('query'), query: ReadQuerySchema }),
  z.strictObject({ kind: z.literal('clarification'), message: z.string().min(1), candidateIds: z.array(IdSchema).optional() }), z.strictObject({ kind: z.literal('answer'), text: z.string().min(1), evidenceEventIds: z.array(IdSchema) }),
]);
export type SpacePlan = z.infer<typeof SpacePlanSchema>;
export type ConnectionPlan = z.infer<typeof ConnectionPlanSchema>;
export type LayoutSource = z.infer<typeof LayoutSourceSchema>;
export type Capabilities = z.infer<typeof CapabilitiesSchema>;
export type ScenarioPlan = z.infer<typeof ScenarioPlanSchema>;
/** What replaying a saved run needs: its scenario (when saved with it) and its changes in time order. */
export const RunReplaySchema = z.strictObject({
  runId: z.uuid(), simulationId: IdSchema, startedAt: z.iso.datetime(), title: z.string().optional(), plan: ScenarioPlanSchema.nullable(),
  changes: z.array(z.strictObject({ at: SimTimeSchema, label: z.string(), prompt: z.string(), operations: z.array(OperationSchema).min(1) })),
});
export type RunReplay = z.infer<typeof RunReplaySchema>;
/** The AI safety report for a saved run: a summary, rated findings, recommendations and caveats. */
export const RunReportSchema = z.strictObject({
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(1500),
  findings: z.array(z.strictObject({ heading: z.string().min(1).max(160), detail: z.string().min(1).max(800), severity: z.enum(['high', 'medium', 'low']), when: z.string().max(60).optional(), where: z.string().max(120).optional() })).min(1).max(8),
  recommendations: z.array(z.string().min(1).max(400)).min(1).max(6),
  caveats: z.array(z.string().min(1).max(400)).min(1).max(5),
});
export type RunReport = z.infer<typeof RunReportSchema>;
export type FollowupRequest = z.infer<typeof FollowupRequestSchema>;
export type CreateInterventionRequest = z.infer<typeof CreateInterventionRequestSchema>;
export type FollowupAction = Omit<Extract<FollowupRequest, { operations: unknown }>, keyof z.infer<typeof HeaderSchema> | 'requestId'> | Omit<Extract<FollowupRequest, { action: 'edit_intervention' }>, keyof z.infer<typeof HeaderSchema> | 'requestId'> | Omit<Extract<FollowupRequest, { action: 'delete_intervention' }>, keyof z.infer<typeof HeaderSchema> | 'requestId'>;
export type InventoryItem = z.infer<typeof InventoryItemSchema>;
export type InterventionSummary = z.infer<typeof InterventionSummarySchema>;
export type PlannerRequest = z.infer<typeof PlannerRequestSchema>;
export type PlannerReply = z.infer<typeof PlannerReplySchema>;
