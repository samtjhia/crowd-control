import { z } from 'zod';
import { ComparisonSchema, CounterSchema, EdgeSchema, EntityKindSchema, FiniteSchema, IdSchema, JsonValueSchema, NonnegativeSchema, PositiveIntegerSchema, PositiveSchema, SelectionSchema, SimTimeSchema } from './common.js';
import { AgentTemplateSchema, EntityBlueprintSchema, SetValuesSchema } from './entities.js';

export const NumericPathSchema = z.enum([
  'components.physical.radius', 'components.navigation.preferredSpeed', 'components.navigation.maximumSpeed',
  'components.navigation.acceleration', 'components.navigation.personalSpace', 'components.behavior.reactionDelay',
  'components.behavior.routeCompliance', 'components.behavior.avoidanceStrength', 'components.behavior.groupCohesion',
  'components.behavior.goalPersistence', 'components.mobility.speedMultiplier', 'components.capacity.maximumOccupants',
  'components.capacity.serviceRate', 'components.portal.traversalTime', 'components.interaction.duration', 'components.interaction.slots',
]);
export const PredicateSchema = z.union([
  z.strictObject({ path: NumericPathSchema, comparison: ComparisonSchema, value: FiniteSchema }),
  z.strictObject({ path: z.enum(['state', 'zoneId']), comparison: z.enum(['eq', 'neq']), value: z.string() }),
  z.strictObject({ path: z.enum(['components.physical.blocksMovement', 'components.physical.movable', 'components.portal.open', 'components.portal.oneWay']), comparison: z.enum(['eq', 'neq']), value: z.boolean() }),
]);
export const SampleSchema = z.union([z.strictObject({ count: CounterSchema }), z.strictObject({ fraction: NonnegativeSchema.max(1) })]);
const SelectorFieldsSchema = z.strictObject({
  ids: z.array(IdSchema).min(1).optional(), kind: EntityKindSchema.optional(), tags: z.array(IdSchema).min(1).optional(), label: z.string().min(1).optional(),
  where: z.array(PredicateSchema).min(1).optional(), sample: SampleSchema.optional(),
});
// Recursive edges need explicit types; leaf fields remain inferred from their schemas.
export type EntitySelector = z.infer<typeof SelectorFieldsSchema> & { inside?: EntitySelector; near?: { targets: EntitySelector; distance: number } };
export const EntitySelectorSchema: z.ZodType<EntitySelector> = z.lazy(() => SelectorFieldsSchema.extend({
  inside: EntitySelectorSchema.optional(), near: z.strictObject({ targets: EntitySelectorSchema, distance: NonnegativeSchema }).optional(),
}).refine((v) => Object.keys(v).some((key) => key !== 'sample'), 'Selector must contain a filter'));
export const SelectorSchema = z.union([EntitySelectorSchema, z.strictObject({ binding: z.literal('subject') })]);
const placementOptions = { distance: NonnegativeSchema.optional(), edge: EdgeSchema.optional(), awayFrom: z.array(EntitySelectorSchema).min(1).optional() };
export const PlacementSchema = z.union([
  z.strictObject({ inside: EntitySelectorSchema, ...placementOptions }), z.strictObject({ near: EntitySelectorSchema, ...placementOptions }), z.strictObject({ along: EntitySelectorSchema, ...placementOptions }),
]);
const GoalLeafSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('reach'), target: SelectorSchema, selection: SelectionSchema.optional(), stopDistance: NonnegativeSchema.optional(), urgency: NonnegativeSchema.optional() }),
  z.strictObject({ kind: z.literal('avoid'), target: SelectorSchema, distance: NonnegativeSchema, urgency: NonnegativeSchema.optional() }),
  z.strictObject({ kind: z.literal('wait'), duration: SimTimeSchema, inside: SelectorSchema.optional() }),
  z.strictObject({ kind: z.literal('wander'), inside: SelectorSchema, duration: SimTimeSchema.optional(), changeTargetEvery: PositiveSchema.optional() }),
  z.strictObject({ kind: z.literal('follow'), target: SelectorSchema, distance: NonnegativeSchema }),
  z.strictObject({ kind: z.literal('queue'), target: SelectorSchema, maximumWait: SimTimeSchema.optional() }),
  z.strictObject({ kind: z.literal('interact'), target: SelectorSchema }),
]);
export type Goal = z.infer<typeof GoalLeafSchema> | { kind: 'sequence'; goals: Goal[]; repeat?: number };
export const GoalSchema: z.ZodType<Goal> = z.lazy(() => z.union([GoalLeafSchema, z.strictObject({ kind: z.literal('sequence'), goals: z.array(GoalSchema).min(1), repeat: PositiveIntegerSchema.optional() })]));
export const EntityMetricSchema = z.literal('contactLoadRatio');
export const ConditionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('event'), name: IdSchema }),
  z.strictObject({ kind: z.literal('count'), targets: EntitySelectorSchema, comparison: ComparisonSchema, value: CounterSchema }),
  z.strictObject({ kind: z.literal('density'), inside: EntitySelectorSchema, comparison: ComparisonSchema, value: NonnegativeSchema }),
  z.strictObject({ kind: z.literal('time'), comparison: ComparisonSchema, value: SimTimeSchema }),
  z.strictObject({ kind: z.literal('entity_metric'), targets: EntitySelectorSchema, metric: EntityMetricSchema, comparison: ComparisonSchema, value: NonnegativeSchema, for: SimTimeSchema }),
]);
export const ScenarioEventSchema = z.strictObject({ name: IdSchema, source: IdSchema.optional(), data: JsonValueSchema.optional() });
export type ScheduleOperation = { op: 'schedule'; id: string; operations: Operation[] } & ({ at: number; after?: never } | { after: number; at?: never });
const RuleFieldsSchema = z.strictObject({ op: z.literal('define_rule'), id: IdSchema, when: ConditionSchema, once: z.boolean().optional(), cooldown: PositiveSchema.optional() });
export type DefineRuleOperation = z.infer<typeof RuleFieldsSchema> & { operations: Operation[] };
export const ScheduleOperationSchema: z.ZodType<ScheduleOperation> = z.lazy(() => z.union([
  z.strictObject({ op: z.literal('schedule'), id: IdSchema, operations: z.array(OperationSchema).min(1), at: SimTimeSchema }),
  z.strictObject({ op: z.literal('schedule'), id: IdSchema, operations: z.array(OperationSchema).min(1), after: SimTimeSchema }),
]));
export const DefineRuleOperationSchema: z.ZodType<DefineRuleOperation> = z.lazy(() => RuleFieldsSchema.extend({ operations: z.array(OperationSchema).min(1) }).refine((v) => v.once !== false || v.cooldown !== undefined, 'Repeating rule requires a positive cooldown'));
const OperationLeafSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('add'), entity: EntityBlueprintSchema, placement: PlacementSchema.optional() }).refine((v) => v.entity.shape !== undefined || v.placement !== undefined, 'Add requires a shape or placement'),
  z.strictObject({ op: z.literal('spawn'), template: AgentTemplateSchema, count: PositiveIntegerSchema, placement: PlacementSchema }),
  z.strictObject({ op: z.literal('remove'), targets: SelectorSchema }),
  z.strictObject({ op: z.literal('set'), targets: SelectorSchema, values: SetValuesSchema }),
  z.strictObject({ op: z.literal('assign_goal'), targets: SelectorSchema, goal: GoalSchema, mode: z.enum(['replace', 'enqueue']).optional() }),
  z.strictObject({ op: z.literal('clear_goal'), targets: SelectorSchema, scope: z.enum(['current', 'queued', 'all']).optional() }),
  z.strictObject({ op: z.literal('remove_rule'), id: IdSchema }),
  z.strictObject({ op: z.literal('emit'), event: ScenarioEventSchema }),
]);
export type Operation = z.infer<typeof OperationLeafSchema> | ScheduleOperation | DefineRuleOperation;
export const OperationSchema: z.ZodType<Operation> = z.lazy(() => z.union([OperationLeafSchema, ScheduleOperationSchema, DefineRuleOperationSchema]));
export type NumericPath = z.infer<typeof NumericPathSchema>;
export type Predicate = z.infer<typeof PredicateSchema>;
export type Sample = z.infer<typeof SampleSchema>;
export type Selector = z.infer<typeof SelectorSchema>;
export type Placement = z.infer<typeof PlacementSchema>;
export type EntityMetric = z.infer<typeof EntityMetricSchema>;
export type Condition = z.infer<typeof ConditionSchema>;
export type ScenarioEvent = z.infer<typeof ScenarioEventSchema>;
