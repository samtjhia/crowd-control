import { z } from 'zod';
import { ContractErrorSchema, CounterSchema, IdSchema, PositiveIntegerSchema, TickSchema, type ContractError } from './common.js';
import { MetricSampleSchema } from './metrics.js';
import { SavedSimulationSchema } from './runtime.js';

export const StoragePrincipalSchema = z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('user'), subject: z.string().min(1) }), z.strictObject({ kind: z.literal('guest'), sessionId: IdSchema })]);
export const SaveRunRequestSchema = z.strictObject({ runId: IdSchema.optional(), expectedStorageRevision: PositiveIntegerSchema.optional(), saved: SavedSimulationSchema }).refine((v) => (v.runId !== undefined) === (v.expectedStorageRevision !== undefined), 'Updating requires both runId and expectedStorageRevision');
export const SaveRunReplySchema = z.discriminatedUnion('status', [z.strictObject({ status: z.literal('saved'), runId: IdSchema, storageRevision: PositiveIntegerSchema, savedAt: z.iso.datetime({ offset: true }) }), z.strictObject({ status: z.literal('disabled') })]);
export const MetricBatchSchema = z.strictObject({ runId: IdSchema, historyRevision: CounterSchema, samples: z.array(z.strictObject({ tick: TickSchema, sample: MetricSampleSchema })) });
export const MetricBatchReplySchema = z.strictObject({ accepted: CounterSchema, historyRevision: CounterSchema });
export const ServiceErrorSchema = z.strictObject({ code: z.enum(['AUTH_REQUIRED', 'FORBIDDEN', 'STORAGE_UNAVAILABLE', 'PLANNER_UNAVAILABLE']), message: z.string().min(1), retryable: z.boolean() });
export function serviceResultSchema<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), value }), z.strictObject({ ok: z.literal(false), error: z.union([ServiceErrorSchema, ContractErrorSchema]) })]);
}
export const ServerEnvSchema = z.strictObject({ GEMINI_API_KEY: z.string().min(1), GEMINI_MODEL: z.string().min(1), DATABASE_URL: z.string().min(1).optional(), AUTH0_DOMAIN: z.string().min(1).optional(), AUTH0_AUDIENCE: z.string().min(1).optional() }).refine((v) => (v.AUTH0_DOMAIN !== undefined) === (v.AUTH0_AUDIENCE !== undefined), 'Auth0 requires both domain and audience');
export const PublicEnvSchema = z.strictObject({ VITE_AUTH0_DOMAIN: z.string().min(1).optional(), VITE_AUTH0_CLIENT_ID: z.string().min(1).optional(), VITE_AUTH0_AUDIENCE: z.string().min(1).optional() });
export type StoragePrincipal = z.infer<typeof StoragePrincipalSchema>;
export type SaveRunRequest = z.infer<typeof SaveRunRequestSchema>;
export type SaveRunReply = z.infer<typeof SaveRunReplySchema>;
export type MetricBatch = z.infer<typeof MetricBatchSchema>;
export type MetricBatchReply = z.infer<typeof MetricBatchReplySchema>;
export type ServiceError = z.infer<typeof ServiceErrorSchema>;
export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: ServiceError | ContractError };
export type ServerEnv = z.infer<typeof ServerEnvSchema>;
export type PublicEnv = z.infer<typeof PublicEnvSchema>;
export type WasmEngineBindings = {
  abi_version(): number;
  engine_version(): string;
  create_engine(): number;
  dispatch(engineHandle: number, commandJson: string): string;
  destroy_engine(engineHandle: number): void;
};
