import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;
export const ABI_VERSION = 1 as const;
export const IdSchema = z.string().min(1).max(256).refine(
  (id) => !['__proto__', 'prototype', 'constructor'].includes(id), 'Reserved property name',
);
export const FiniteSchema = z.number().finite();
export const NonnegativeSchema = FiniteSchema.nonnegative();
export const PositiveSchema = FiniteSchema.positive();
export const CounterSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const PositiveIntegerSchema = CounterSchema.positive();
export const RandomStateSchema = CounterSchema.max(0xffff_ffff);
export const SimTimeSchema = NonnegativeSchema;
export const TickSchema = CounterSchema;
export const Vec2Schema = z.strictObject({ x: FiniteSchema, y: FiniteSchema });
export const UnitsSchema = z.enum(['model', 'm']);
export const EntityKindSchema = z.enum(['agent', 'zone', 'barrier', 'portal', 'object']);
export const ComparisonSchema = z.enum(['eq', 'neq', 'lt', 'lte', 'gt', 'gte']);
export const SelectionSchema = z.enum(['nearest', 'lowest-cost', 'random']);
export const EdgeSchema = z.enum(['north', 'south', 'east', 'west']);
export const HeaderSchema = z.strictObject({ schemaVersion: z.literal(SCHEMA_VERSION), simulationId: IdSchema });
export const VersionsSchema = z.strictObject({ compiler: IdSchema, model: IdSchema, random: IdSchema, engine: IdSchema.optional() });
export const ErrorCodeSchema = z.enum([
  'INVALID_SCHEMA', 'NOT_FOUND', 'AMBIGUOUS_SELECTOR', 'INTERVENTION_NOT_FOUND',
  'REVISION_CONFLICT', 'REPLAY_FAILED', 'MAP_NOT_FOUND', 'SCALE_CALIBRATION_REQUIRED',
  'NO_WALKABLE_SPACE', 'GOAL_FAILED', 'LAYOUT_CONSTRAINTS_UNSATISFIABLE',
  'UNSUPPORTED_CAPABILITY', 'RESOURCE_LIMIT',
]);
export const ContractErrorSchema = z.strictObject({
  code: ErrorCodeSchema, message: z.string().min(1), path: z.string().optional(),
  operationIndex: CounterSchema.optional(), requestId: IdSchema.optional(),
  jobId: IdSchema.optional(), affectedIds: z.array(IdSchema).optional(),
});
export function resultSchema<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), value }),
    z.strictObject({ ok: z.literal(false), error: ContractErrorSchema }),
  ]);
}
export const LimitsSchema = z.strictObject({
  maxAgents: PositiveIntegerSchema, maxGridCells: PositiveIntegerSchema,
  maxOperationsPerBatch: PositiveIntegerSchema, maxSelectorDepth: PositiveIntegerSchema,
  maxSelectorWork: PositiveIntegerSchema, maxGoalDepth: PositiveIntegerSchema,
  maxRuleCascades: PositiveIntegerSchema, maxRuleCounters: PositiveIntegerSchema,
  maxPendingJobs: PositiveIntegerSchema, maxUploadBytes: PositiveIntegerSchema,
  maxSourcePixels: PositiveIntegerSchema, maxPages: PositiveIntegerSchema,
});
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(), z.boolean(), FiniteSchema, z.string(), z.array(JsonValueSchema), z.record(z.string().refine((key) => !['__proto__', 'prototype', 'constructor'].includes(key)), JsonValueSchema),
]));
export type Id = z.infer<typeof IdSchema>;
export type SimTime = z.infer<typeof SimTimeSchema>;
export type Tick = z.infer<typeof TickSchema>;
export type Vec2 = z.infer<typeof Vec2Schema>;
export type Units = z.infer<typeof UnitsSchema>;
export type EntityKind = z.infer<typeof EntityKindSchema>;
export type Comparison = z.infer<typeof ComparisonSchema>;
export type Selection = z.infer<typeof SelectionSchema>;
export type Edge = z.infer<typeof EdgeSchema>;
export type Header = z.infer<typeof HeaderSchema>;
export type Versions = z.infer<typeof VersionsSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type ContractError = z.infer<typeof ContractErrorSchema>;
export type Limits = z.infer<typeof LimitsSchema>;
export type Result<T> = { ok: true; value: T } | { ok: false; error: ContractError };

export const uniqueIds = (items: readonly { id: string }[]) => new Set(items.map((item) => item.id)).size === items.length;
export const nonemptyPatch = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape).refine(
  (value) => Object.keys(value).length > 0, 'Patch must contain at least one field',
);
