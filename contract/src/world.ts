import { z } from 'zod';
import { FiniteSchema, HeaderSchema, IdSchema, LimitsSchema, NonnegativeSchema, PositiveIntegerSchema, PositiveSchema, RandomStateSchema, SelectionSchema, SimTimeSchema, TickSchema, UnitsSchema, VersionsSchema, uniqueIds } from './common.js';
import { AgentOverridesSchema, AppearanceSchema, BehaviorSchema, EntityBlueprintSchema, MapAppearanceSchema, MobilitySchema, PortalSchema, RectSchema, ResolvedAgentComponentsSchema } from './entities.js';
import { DefineRuleOperationSchema, EntitySelectorSchema, OperationSchema } from './operations.js';
import { CapabilitiesSchema, InventoryItemSchema, ScenarioPlanSchema } from './planner.js';
import { GridDataSchema, MapSourceSchema, PreparedMapSchema } from './editor.js';

export const ContactModelSchema = z.strictObject({ solverVersion: IdSchema, referenceLoad: PositiveSchema, forceUnits: z.enum(['model-force', 'N']), parameters: z.record(IdSchema, FiniteSchema) });
export const ContactDiagnosticsSchema = z.strictObject({ solverVersion: IdSchema, tick: TickSchema, dt: PositiveSchema, measure: z.enum(['force', 'impulse']), forceUnits: z.enum(['model-force', 'N']), agents: z.array(z.strictObject({ agentId: IdSchema, normalMagnitudes: z.array(NonnegativeSchema) })) }).refine((v) => new Set(v.agents.map((a) => a.agentId)).size === v.agents.length, 'Duplicate contact diagnostic agent');
export const ModelPresetSchema = z.strictObject({ id: IdSchema, version: IdSchema, units: UnitsSchema, dt: PositiveSchema, defaultAgent: ResolvedAgentComponentsSchema, layout: z.strictObject({ bodyDiameter: PositiveSchema, spacingDiameters: PositiveSchema, preferredAspect: PositiveSchema, doorBodyWidths: PositiveSchema }), contact: ContactModelSchema.optional() });
export const CompileInputSchema = z.strictObject({ plan: ScenarioPlanSchema, assets: z.array(PreparedMapSchema), model: ModelPresetSchema, capabilities: CapabilitiesSchema, limits: LimitsSchema });
export const AgentProfileSchema = z.strictObject({ radius: PositiveSchema, preferredSpeed: NonnegativeSchema, maximumSpeed: NonnegativeSchema.optional(), acceleration: NonnegativeSchema.optional(), personalSpace: NonnegativeSchema.optional(), blocksMovement: z.boolean().optional(), movable: z.boolean().optional(), behavior: BehaviorSchema.partial().optional(), mobility: MobilitySchema.partial().optional(), appearance: AppearanceSchema.optional() }).refine((v) => v.maximumSpeed === undefined || v.maximumSpeed >= v.preferredSpeed, 'Invalid profile speed range');
const TargetZoneSchema = z.strictObject({ targetZone: IdSchema });
const TargetEntitySchema = z.strictObject({ targetEntityId: IdSchema });
const TargetIdsSchema = z.strictObject({ targetIds: z.array(IdSchema).min(1) });
export const CompiledDestinationSchema = z.union([TargetZoneSchema, TargetEntitySchema, TargetIdsSchema]);
const reach = { kind: z.literal('reach'), departOnArrival: z.boolean().optional(), selection: SelectionSchema.optional(), stopDistance: NonnegativeSchema.optional(), urgency: NonnegativeSchema.optional() };
const avoid = { kind: z.literal('avoid'), distance: NonnegativeSchema, urgency: NonnegativeSchema.optional() };
const CompiledGoalLeafSchema = z.union([
  TargetZoneSchema.extend(reach), TargetEntitySchema.extend(reach), TargetIdsSchema.extend(reach),
  TargetZoneSchema.extend(avoid), TargetEntitySchema.extend(avoid), TargetIdsSchema.extend(avoid),
  z.strictObject({ kind: z.literal('wait'), duration: SimTimeSchema, insideZone: IdSchema.optional() }),
  z.strictObject({ kind: z.literal('wander'), insideZone: IdSchema, duration: SimTimeSchema.optional(), changeTargetEvery: PositiveSchema.optional() }),
  z.strictObject({ kind: z.literal('follow'), targetEntityId: IdSchema, distance: NonnegativeSchema }),
  z.strictObject({ kind: z.literal('queue'), targetEntityId: IdSchema, maximumWait: SimTimeSchema.optional() }),
  z.strictObject({ kind: z.literal('interact'), targetEntityId: IdSchema }),
]);
export type CompiledGoal = z.infer<typeof CompiledGoalLeafSchema> | { kind: 'sequence'; goals: CompiledGoal[]; repeat?: number };
export const CompiledGoalSchema: z.ZodType<CompiledGoal> = z.lazy(() => z.union([CompiledGoalLeafSchema, z.strictObject({ kind: z.literal('sequence'), goals: z.array(CompiledGoalSchema).min(1), repeat: PositiveIntegerSchema.optional() })]));
export const AgentBlueprintSchema = z.strictObject({ id: IdSchema, label: z.string().optional(), tags: z.array(IdSchema), profile: IdSchema, x: FiniteSchema, y: FiniteSchema, controller: IdSchema.optional(), components: AgentOverridesSchema.optional(), appearance: AppearanceSchema.optional() });
const metadata = { id: IdSchema, label: z.string().optional(), tags: z.array(IdSchema).optional(), appearance: MapAppearanceSchema.optional() };
export const RoomRecordSchema = RectSchema.extend(metadata);
export const PortalRecordSchema = RectSchema.extend({ ...PortalSchema.shape, ...metadata });
const mapFields = { width: PositiveSchema, height: PositiveSchema, cellSize: PositiveSchema, units: UnitsSchema, rooms: z.array(RoomRecordSchema), portals: z.array(PortalRecordSchema), source: MapSourceSchema.optional(), entities: z.array(EntityBlueprintSchema).optional() };
export const CompiledMapSchema = z.union([
  z.strictObject({ ...mapFields, grid: GridDataSchema }),
  z.strictObject({ ...mapFields, rows: z.array(z.string().min(1)).min(1), legend: z.record(z.string().length(1), IdSchema) }),
]).superRefine((v, ctx) => {
  const columns = v.width / v.cellSize, rows = v.height / v.cellSize;
  if (!Number.isSafeInteger(columns) || !Number.isSafeInteger(rows)) ctx.addIssue({ code: 'custom', message: 'Map dimensions must be exact multiples of cellSize' });
  if ('grid' in v) {
    if (v.grid.width !== columns || v.grid.height !== rows || v.grid.cellSize !== v.cellSize || v.grid.units !== v.units) ctx.addIssue({ code: 'custom', message: 'Map and grid dimensions/units disagree' });
  } else if (v.rows.length !== rows || v.rows.some((r) => r.length !== columns)) ctx.addIssue({ code: 'custom', message: 'Rows must match map dimensions' });
  if (!uniqueIds([...v.rooms, ...v.portals, ...(v.entities ?? [])])) ctx.addIssue({ code: 'custom', message: 'Duplicate map entity IDs' });
  const zones = new Set([...v.rooms.map((r) => r.id), ...(v.entities ?? []).filter((e) => e.kind === 'zone').map((e) => e.id), ...('grid' in v ? v.grid.zoneIds.filter((id) => id !== null) : [])]);
  if (v.portals.some((p) => p.connects.some((id) => !zones.has(id)))) ctx.addIssue({ code: 'custom', message: 'Portal references unknown zone' });
  if (!('grid' in v)) {
    const ids = new Set([...zones, ...v.portals.map((p) => p.id), ...(v.entities ?? []).map((e) => e.id)]);
    if (Object.values(v.legend).some((id) => !ids.has(id)) || v.rows.some((r) => [...r].some((c) => c !== '#' && !Object.hasOwn(v.legend, c)))) ctx.addIssue({ code: 'custom', message: 'Unknown map legend glyph or entity' });
  }
});
export const CompactSpawnSchema = z.strictObject({ op: z.literal('spawn'), count: PositiveIntegerSchema, zone: IdSchema, profile: IdSchema, tags: z.array(IdSchema), label: z.string().optional(), controller: IdSchema.optional(), components: AgentOverridesSchema.optional(), appearance: AppearanceSchema.optional() });
export const CompiledOperationSchema = z.union([OperationSchema, CompactSpawnSchema, z.strictObject({ op: z.literal('emit'), event: IdSchema })]);
export const CompiledJobSchema = z.strictObject({ id: IdSchema, at: SimTimeSchema, operations: z.array(CompiledOperationSchema).min(1) });
export const EventControllerRuleSchema = z.strictObject({ id: IdSchema, event: IdSchema, match: EntitySelectorSchema, controller: IdSchema, mode: z.enum(['replace', 'enqueue']), once: z.boolean().optional(), cooldown: PositiveSchema.optional() }).refine((v) => v.once !== false || v.cooldown !== undefined, 'Repeating rule requires a positive cooldown');
export const CompiledSceneSchema = HeaderSchema.extend({ seed: RandomStateSchema, versions: VersionsSchema, model: z.strictObject({ units: UnitsSchema, dt: PositiveSchema }), map: CompiledMapSchema, profiles: z.record(IdSchema, AgentProfileSchema), controllers: z.record(IdSchema, CompiledGoalSchema), agents: z.array(AgentBlueprintSchema), jobs: z.array(CompiledJobSchema), rules: z.array(z.union([DefineRuleOperationSchema, EventControllerRuleSchema])) }).superRefine((v, ctx) => {
  if (v.model.units !== v.map.units) ctx.addIssue({ code: 'custom', message: 'Scene and map units disagree' });
  if (!uniqueIds(v.agents) || !uniqueIds(v.jobs) || !uniqueIds(v.rules)) ctx.addIssue({ code: 'custom', message: 'Duplicate agent, job or rule IDs' });
  if (v.agents.some((a) => !Object.hasOwn(v.profiles, a.profile) || (a.controller !== undefined && !Object.hasOwn(v.controllers, a.controller)))) ctx.addIssue({ code: 'custom', message: 'Agent references unknown profile or controller' });
  if (v.rules.some((r) => 'controller' in r && !Object.hasOwn(v.controllers, r.controller))) ctx.addIssue({ code: 'custom', message: 'Rule references unknown controller' });
  const zones = new Set([...v.map.rooms.map((r) => r.id), ...(v.map.entities ?? []).filter((e) => e.kind === 'zone').map((e) => e.id), ...('grid' in v.map ? v.map.grid.zoneIds.filter((id) => id !== null) : [])]);
  const entities = new Set([...zones, ...v.map.portals.map((p) => p.id), ...(v.map.entities ?? []).map((e) => e.id), ...v.agents.map((a) => a.id)]);
  if (v.agents.some((a) => zones.has(a.id) || v.map.portals.some((p) => p.id === a.id) || v.map.entities?.some((e) => e.id === a.id))) ctx.addIssue({ code: 'custom', message: 'Agent ID collides with map entity' });
  function checkGoal(goal: CompiledGoal) {
    if (goal.kind === 'sequence') { goal.goals.forEach(checkGoal); return; }
    if (('insideZone' in goal && goal.insideZone !== undefined && !zones.has(goal.insideZone)) || ('targetZone' in goal && !zones.has(goal.targetZone)) || ('targetEntityId' in goal && !entities.has(goal.targetEntityId)) || ('targetIds' in goal && goal.targetIds.some((id) => !entities.has(id)))) ctx.addIssue({ code: 'custom', message: 'Compiled goal references unknown initial entity or zone' });
  }
  Object.values(v.controllers).forEach(checkGoal);
});
export const CompileOutputSchema = z.strictObject({ scene: CompiledSceneSchema, resolvedModel: ModelPresetSchema, inventory: z.array(InventoryItemSchema) }).refine((v) => v.scene.versions.model === v.resolvedModel.version && v.scene.model.units === v.resolvedModel.units && v.scene.model.dt === v.resolvedModel.dt, 'Scene must match the resolved model');
export type ContactModel = z.infer<typeof ContactModelSchema>;
export type ContactDiagnostics = z.infer<typeof ContactDiagnosticsSchema>;
export type ModelPreset = z.infer<typeof ModelPresetSchema>;
export type CompileInput = z.infer<typeof CompileInputSchema>;
export type AgentProfile = z.infer<typeof AgentProfileSchema>;
export type CompiledDestination = z.infer<typeof CompiledDestinationSchema>;
export type AgentBlueprint = z.infer<typeof AgentBlueprintSchema>;
export type RoomRecord = z.infer<typeof RoomRecordSchema>;
export type PortalRecord = z.infer<typeof PortalRecordSchema>;
export type CompiledMap = z.infer<typeof CompiledMapSchema>;
export type CompactSpawn = z.infer<typeof CompactSpawnSchema>;
export type CompiledOperation = z.infer<typeof CompiledOperationSchema>;
export type CompiledJob = z.infer<typeof CompiledJobSchema>;
export type EventControllerRule = z.infer<typeof EventControllerRuleSchema>;
export type CompiledScene = z.infer<typeof CompiledSceneSchema>;
export type CompileOutput = z.infer<typeof CompileOutputSchema>;
