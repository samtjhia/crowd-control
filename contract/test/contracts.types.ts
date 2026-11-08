import type { ChatPanelProps, CompiledDestination, CompiledGoal, FollowupAction, Operation, Result, ScenarioPlan, WorkerEndpoint } from '../src/index.js';

export const destinations = [{ targetZone: 'hall' }, { targetEntityId: 'door' }, { targetIds: ['door'] }] satisfies CompiledDestination[];
export const compiledGoals = [
  { kind: 'reach', targetZone: 'hall' }, { kind: 'avoid', targetEntityId: 'door', distance: 1 },
  { kind: 'reach', targetIds: ['door'] }, { kind: 'sequence', goals: [{ kind: 'wait', duration: 1 }] },
] satisfies CompiledGoal[];
export const create = { operations: [{ op: 'emit', event: { name: 'alarm' } }] } satisfies FollowupAction;
export const edit = { action: 'edit_intervention', interventionId: 'i1', expectedRevision: 1, replacement: { label: 'test', at: 0, operations: create.operations } } satisfies FollowupAction;
export const remove = { action: 'delete_intervention', interventionId: 'i1', expectedRevision: 1 } satisfies FollowupAction;
export const nested: Operation = { op: 'schedule', id: 'later', at: 10, operations: [{ op: 'assign_goal', targets: { kind: 'agent' }, goal: { kind: 'sequence', goals: [{ kind: 'reach', target: { ids: ['hall'] } }] } }] };
export function startScenario(props: ChatPanelProps, plan: ScenarioPlan) { return props.startScenario(plan); }
export function pause(endpoint: WorkerEndpoint) { endpoint.send({ schemaVersion: 1, simulationId: 'demo', commandId: 'pause', type: 'pause' }); }
export function unwrap<T>(result: Result<T>) { return result.ok ? result.value : result.error.code; }
// @ts-expect-error Runtime state is not part of a writable spawn.
export const invalid: Operation = { op: 'spawn', template: { kind: 'agent', position: { x: 0, y: 0 } }, count: 1, placement: { inside: { ids: ['hall'] } } };
// @ts-expect-error A compiled reach goal requires a destination.
export const invalidGoal: CompiledGoal = { kind: 'reach' };
