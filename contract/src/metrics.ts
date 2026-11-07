import { z } from 'zod';
import { CounterSchema, IdSchema, JsonValueSchema, NonnegativeSchema, PositiveIntegerSchema, PositiveSchema, SimTimeSchema, TickSchema, Vec2Schema } from './common.js';
import { EntitySelectorSchema } from './operations.js';

export const OriginSchema = z.strictObject({ interventionId: IdSchema, revision: PositiveIntegerSchema, parentJobId: IdSchema.optional(), parentRuleId: IdSchema.optional() });
export const ZoneMetricsSchema = z.strictObject({ zoneId: IdSchema, occupancy: CounterSchema, density: NonnegativeSchema });
export const PortalMetricsSchema = z.strictObject({ portalId: IdSchema, crossed: CounterSchema, flowRate: NonnegativeSchema, windowSeconds: PositiveSchema });
export const QueueMetricsSchema = z.strictObject({ targetId: IdSchema, length: CounterSchema, served: CounterSchema, totalWait: SimTimeSchema, maximumWait: SimTimeSchema });
const clearance = z.strictObject({ t50: SimTimeSchema.nullable(), t90: SimTimeSchema.nullable(), t100: SimTimeSchema.nullable() });
export const MetricSampleSchema = z.strictObject({ time: SimTimeSchema, present: CounterSchema, departed: CounterSchema, blocked: CounterSchema, immobile: CounterSchema, removed: CounterSchema, zones: z.array(ZoneMetricsSchema), portals: z.array(PortalMetricsSchema), queues: z.array(QueueMetricsSchema), clearance });
export const DensityGridSchema = z.strictObject({ width: PositiveIntegerSchema, height: PositiveIntegerSchema, cellSize: PositiveSchema, origin: Vec2Schema, units: z.enum(['people/m2', 'people/model-unit2']), values: z.array(NonnegativeSchema) }).refine((v) => v.values.length === v.width * v.height, 'Density buffer length must equal width × height');
export const DepartureRecordSchema = z.strictObject({ agentId: IdSchema, at: SimTimeSchema, travelTime: SimTimeSchema });
export const MetricsStateSchema = z.strictObject({ samples: z.array(MetricSampleSchema), departures: z.array(DepartureRecordSchema), removedCount: CounterSchema, portalCrossings: z.array(z.strictObject({ portalId: IdSchema, agentId: IdSchema, at: SimTimeSchema })), queueTotals: z.array(QueueMetricsSchema), clearance: z.strictObject({ cohortIds: z.array(IdSchema), startedAt: SimTimeSchema }).nullable() });
export const EventRecordSchema = z.strictObject({ id: IdSchema, tick: TickSchema, time: SimTimeSchema, name: IdSchema, source: IdSchema.optional(), origin: OriginSchema.optional(), data: JsonValueSchema.optional() });
export const ReadQuerySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('inventory') }), z.strictObject({ kind: z.literal('agents'), targets: EntitySelectorSchema }),
  z.strictObject({ kind: z.literal('metrics'), from: SimTimeSchema.optional(), to: SimTimeSchema.optional(), zones: z.array(IdSchema).optional() }),
  z.strictObject({ kind: z.literal('events'), from: SimTimeSchema.optional(), to: SimTimeSchema.optional(), names: z.array(IdSchema).optional() }), z.strictObject({ kind: z.literal('history') }),
]).refine((v) => !('from' in v && 'to' in v) || v.from === undefined || v.to === undefined || v.from <= v.to, 'Query range is reversed');
export type Origin = z.infer<typeof OriginSchema>;
export type ZoneMetrics = z.infer<typeof ZoneMetricsSchema>;
export type PortalMetrics = z.infer<typeof PortalMetricsSchema>;
export type QueueMetrics = z.infer<typeof QueueMetricsSchema>;
export type MetricSample = z.infer<typeof MetricSampleSchema>;
export type DensityGrid = z.infer<typeof DensityGridSchema>;
export type DepartureRecord = z.infer<typeof DepartureRecordSchema>;
export type MetricsState = z.infer<typeof MetricsStateSchema>;
export type EventRecord = z.infer<typeof EventRecordSchema>;
export type ReadQuery = z.infer<typeof ReadQuerySchema>;
