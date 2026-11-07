import { z } from 'zod';
import { ContractErrorSchema, CounterSchema, FiniteSchema, HeaderSchema, IdSchema, PositiveIntegerSchema, PositiveSchema, SimTimeSchema, TickSchema, Vec2Schema } from './common.js';
import { AppearanceSchema, EntityBlueprintSchema } from './entities.js';
import { ApplyAckSchema, HistoryStateSchema } from './history.js';
import { DensityGridSchema, EventRecordSchema, MetricSampleSchema, ReadQuerySchema } from './metrics.js';
import { FollowupRequestSchema, InventoryItemSchema } from './planner.js';
import { AgentRuntimeSchema, AgentStateSchema, EngineSnapshotSchema } from './runtime.js';
import { CompileOutputSchema, CompiledMapSchema } from './world.js';

export const ReadReplySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('inventory'), items: z.array(InventoryItemSchema) }), z.strictObject({ kind: z.literal('agents'), agents: z.array(AgentRuntimeSchema) }), z.strictObject({ kind: z.literal('metrics'), samples: z.array(MetricSampleSchema) }), z.strictObject({ kind: z.literal('events'), events: z.array(EventRecordSchema) }), z.strictObject({ kind: z.literal('history'), history: HistoryStateSchema }),
]);
const commandHeader = { ...HeaderSchema.shape, commandId: IdSchema };
export const WorkerCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...commandHeader, type: z.literal('load'), compiled: CompileOutputSchema, history: HistoryStateSchema }), z.strictObject({ ...commandHeader, type: z.literal('reset') }),
  z.strictObject({ ...commandHeader, type: z.literal('apply_request'), request: FollowupRequestSchema }),
  z.strictObject({ ...commandHeader, type: z.literal('pause') }), z.strictObject({ ...commandHeader, type: z.literal('resume') }),
  z.strictObject({ ...commandHeader, type: z.literal('step'), ticks: PositiveIntegerSchema }), z.strictObject({ ...commandHeader, type: z.literal('speed'), multiplier: PositiveSchema }),
  z.strictObject({ ...commandHeader, type: z.literal('query'), query: ReadQuerySchema }), z.strictObject({ ...commandHeader, type: z.literal('snapshot'), snapshotId: IdSchema }),
  z.strictObject({ ...commandHeader, type: z.literal('restore'), snapshot: EngineSnapshotSchema }), z.strictObject({ ...commandHeader, type: z.literal('run_to'), time: SimTimeSchema }),
]).refine((v) => (v.type !== 'load' || v.compiled.scene.simulationId === v.simulationId) && (v.type !== 'apply_request' || v.request.simulationId === v.simulationId) && (v.type !== 'restore' || v.snapshot.simulationId === v.simulationId), 'Nested simulationId must match command');
export const StampSchema = z.strictObject({ streamId: IdSchema, tick: TickSchema, time: SimTimeSchema, topologyVersion: CounterSchema, sceneVersion: CounterSchema, historyRevision: CounterSchema });
export const FrameAgentSchema = z.strictObject({ id: IdSchema, x: FiniteSchema, y: FiniteSchema, profile: IdSchema, controller: IdSchema.nullable(), state: AgentStateSchema });
export const FrameSchema = StampSchema.extend({ agents: z.array(FrameAgentSchema) });
export const RenderAgentMetadataSchema = z.strictObject({ id: IdSchema, label: z.string().optional(), radius: PositiveSchema, appearance: AppearanceSchema });
export const RenderSceneSchema = z.strictObject({ map: CompiledMapSchema, entities: z.array(EntityBlueprintSchema), agents: z.array(RenderAgentMetadataSchema) });
export const CameraSchema = z.strictObject({ pan: Vec2Schema, pixelsPerUnit: PositiveSchema });
export const RenderInputSchema = z.strictObject({ scene: RenderSceneSchema, frame: FrameSchema, camera: CameraSchema, selectedIds: z.array(IdSchema), metrics: MetricSampleSchema.optional(), density: DensityGridSchema.optional() });
const messageHeader = HeaderSchema.shape;
export const WorkerMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...messageHeader, type: z.literal('ack'), commandId: IdSchema, stamp: StampSchema, applied: ApplyAckSchema.optional() }),
  z.strictObject({ ...messageHeader, type: z.literal('error'), commandId: IdSchema.optional(), error: ContractErrorSchema }),
  z.strictObject({ ...messageHeader, type: z.literal('frame'), frame: FrameSchema }), z.strictObject({ ...messageHeader, type: z.literal('scene'), stamp: StampSchema, scene: RenderSceneSchema }),
  z.strictObject({ ...messageHeader, type: z.literal('metrics'), stamp: StampSchema, sample: MetricSampleSchema, density: DensityGridSchema.optional() }), z.strictObject({ ...messageHeader, type: z.literal('events'), stamp: StampSchema, events: z.array(EventRecordSchema) }),
  z.strictObject({ ...messageHeader, type: z.literal('query_result'), commandId: IdSchema, stamp: StampSchema, result: ReadReplySchema }), z.strictObject({ ...messageHeader, type: z.literal('snapshot'), commandId: IdSchema, snapshot: EngineSnapshotSchema }),
]).refine((v) => v.type !== 'snapshot' || v.snapshot.simulationId === v.simulationId, 'Snapshot simulationId mismatch');
export type ReadReply = z.infer<typeof ReadReplySchema>;
export type WorkerCommand = z.infer<typeof WorkerCommandSchema>;
export type Stamp = z.infer<typeof StampSchema>;
export type FrameAgent = z.infer<typeof FrameAgentSchema>;
export type Frame = z.infer<typeof FrameSchema>;
export type RenderAgentMetadata = z.infer<typeof RenderAgentMetadataSchema>;
export type RenderScene = z.infer<typeof RenderSceneSchema>;
export type Camera = z.infer<typeof CameraSchema>;
export type RenderInput = z.infer<typeof RenderInputSchema>;
export type WorkerMessage = z.infer<typeof WorkerMessageSchema>;
export type WorkerEndpoint = {
  kind: 'real' | 'mock';
  send(command: WorkerCommand): void;
  subscribe(listener: (message: WorkerMessage) => void): () => void;
  dispose?(): void;
};
