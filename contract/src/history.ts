import { z } from 'zod';
import { CounterSchema, IdSchema, PositiveIntegerSchema, SimTimeSchema, TickSchema, resultSchema } from './common.js';
import { OperationSchema } from './operations.js';

export const InterventionRevisionSchema = z.strictObject({ id: IdSchema, revision: PositiveIntegerSchema, origin: z.enum(['base', 'followup']), label: z.string(), at: SimTimeSchema, order: CounterSchema, operations: z.array(OperationSchema), deleted: z.boolean() }).refine((v) => v.deleted || v.operations.length > 0, 'Active intervention must have operations');
export const CommandCursorSchema = z.strictObject({ tick: TickSchema, order: CounterSchema, prefixHash: IdSchema });
export const ApplyAckSchema = z.strictObject({ requestId: IdSchema, interventionId: IdSchema, revision: PositiveIntegerSchema, at: SimTimeSchema, historyRevision: CounterSchema });
export const RequestOutcomeSchema = z.strictObject({ requestId: IdSchema, contentHash: IdSchema, result: resultSchema(ApplyAckSchema) }).refine((v) => !v.result.ok || v.result.value.requestId === v.requestId, 'Outcome requestId mismatch');
export const HistoryStateSchema = z.strictObject({ historyRevision: CounterSchema, records: z.array(InterventionRevisionSchema), outcomes: z.array(RequestOutcomeSchema) }).refine((v) => new Set(v.records.map((r) => `${r.id}:${r.revision}`)).size === v.records.length && new Set(v.outcomes.map((r) => r.requestId)).size === v.outcomes.length, 'Duplicate intervention revision or request outcome');
export type InterventionRevision = z.infer<typeof InterventionRevisionSchema>;
export type CommandCursor = z.infer<typeof CommandCursorSchema>;
export type ApplyAck = z.infer<typeof ApplyAckSchema>;
export type RequestOutcome = z.infer<typeof RequestOutcomeSchema>;
export type HistoryState = z.infer<typeof HistoryStateSchema>;
