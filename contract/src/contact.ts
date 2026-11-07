import { z } from 'zod';
import { IdSchema, NonnegativeSchema, PositiveSchema, TickSchema } from './common.js';

export const DISC_IMPULSE_VERSION = 'disc-impulse-v1' as const;
export const DiscImpulseParametersSchema = z.strictObject({
  mass: PositiveSchema.min(1e-9).max(1e6), iterations: z.number().int().min(1).max(128),
  tolerance: PositiveSchema.max(0.001), maximumSpeed: PositiveSchema.max(100),
});
export const DiscImpulseStateSchema = z.strictObject({
  sampleTick: TickSchema.nullable(), dt: NonnegativeSchema,
  impulses: z.record(IdSchema, z.array(NonnegativeSchema)),
}).refine((v) => Object.values(v.impulses).reduce((n, a) => n + a.length, 0) <= 100_000, 'Contact diagnostic budget exceeded')
  .refine((v) => v.sampleTick === null ? v.dt === 0 : v.dt > 0, 'Contact sample tick and dt disagree');
export const CONTACT_STATE_SCHEMAS = { [DISC_IMPULSE_VERSION]: DiscImpulseStateSchema } as const;
