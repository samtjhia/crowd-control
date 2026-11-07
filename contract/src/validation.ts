import { z } from 'zod';
import { JsonValueSchema, type ContractError, type JsonValue, type Limits, type Result } from './common.js';
import type { Appearance, MutableComponents } from './entities.js';
import { OperationSchema, type Goal, type Operation, type Selector } from './operations.js';
import { FollowupRequestSchema, PlannerReplySchema, ScenarioPlanSchema, type Capabilities } from './planner.js';
import { CompileInputSchema } from './world.js';
import { EngineSnapshotSchema, SavedSimulationSchema } from './runtime.js';
import { WorkerCommandSchema, WorkerMessageSchema } from './worker.js';

// These are transport budgets, not physical model parameters or performance claims.
export const JSON_BUDGET = { maxDepth: 64, maxNodes: 1_000_000, maxBytes: 32 * 1024 * 1024 } as const;
export type ValidationOptions = {
  limits?: Limits;
  capabilities?: Capabilities;
  contactStateSchemas?: Readonly<Record<string, z.ZodType<JsonValue>>>;
};
const fail = (code: ContractError['code'], message: string, path?: string): Result<never> => ({ ok: false, error: { code, message, ...(path === undefined ? {} : { path }) } });

function inspectJson(input: unknown): Result<true> {
  const ancestors = new WeakSet<object>();
  const stack: { value: unknown; depth: number; exit?: boolean }[] = [{ value: input, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const item = stack.pop()!;
    if (item.exit) { ancestors.delete(item.value as object); continue; }
    if (++nodes > JSON_BUDGET.maxNodes || item.depth > JSON_BUDGET.maxDepth) return fail('RESOURCE_LIMIT', 'JSON nesting or node budget exceeded');
    const v = item.value;
    if (v === null || typeof v === 'boolean' || typeof v === 'string') continue;
    if (typeof v === 'number') { if (!Number.isFinite(v)) return fail('INVALID_SCHEMA', 'Numbers must be finite'); continue; }
    if (typeof v !== 'object') return fail('INVALID_SCHEMA', 'Expected JSON values only');
    const proto: unknown = Object.getPrototypeOf(v);
    if ((!Array.isArray(v) && proto !== Object.prototype && proto !== null) || (Array.isArray(v) && proto !== Array.prototype)) return fail('INVALID_SCHEMA', 'Expected plain objects and ordinary arrays');
    if (ancestors.has(v)) return fail('INVALID_SCHEMA', 'Cyclic JSON value');
    ancestors.add(v); stack.push({ ...item, exit: true });
    const keys = Reflect.ownKeys(v);
    if (keys.length > JSON_BUDGET.maxNodes - nodes) return fail('RESOURCE_LIMIT', 'JSON node budget exceeded');
    if (Array.isArray(v) && keys.length !== v.length + 1) return fail('INVALID_SCHEMA', 'Sparse arrays and array properties are unsupported');
    for (const key of keys) {
      if (Array.isArray(v) && key === 'length') continue;
      if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) return fail('INVALID_SCHEMA', 'Reserved or non-JSON property');
      const descriptor = Object.getOwnPropertyDescriptor(v, key)!;
      if (!('value' in descriptor) || !descriptor.enumerable) return fail('INVALID_SCHEMA', 'Accessors and hidden properties are unsupported');
      if (Array.isArray(v) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= v.length)) return fail('INVALID_SCHEMA', 'Unexpected array property');
      stack.push({ value: descriptor.value, depth: item.depth + 1 });
    }
  }
  return { ok: true, value: true };
}

function operationError(operations: Operation[], options: ValidationOptions, bound = false): ContractError | undefined {
  const { limits, capabilities } = options;
  if (limits && operations.length > limits.maxOperationsPerBatch) return { code: 'RESOURCE_LIMIT', message: 'Operation batch exceeds limit' };
  function selector(s: Selector, depth = 1): ContractError | undefined {
    if ('binding' in s) return bound ? undefined : { code: 'INVALID_SCHEMA', message: 'subject is only bound inside entity_metric rule actions' };
    if (limits && (depth > limits.maxSelectorDepth || (s.ids?.length ?? 0) + (s.tags?.length ?? 0) + (s.where?.length ?? 0) > limits.maxSelectorWork || (s.sample && 'count' in s.sample && s.sample.count > limits.maxAgents))) return { code: 'RESOURCE_LIMIT', message: 'Selector exceeds configured budget' };
    return (s.inside && selector(s.inside, depth + 1)) || (s.near && selector(s.near.targets, depth + 1)) || undefined;
  }
  function goal(g: Goal, depth = 1): ContractError | undefined {
    if (limits && depth > limits.maxGoalDepth) return { code: 'RESOURCE_LIMIT', message: 'Goal depth exceeds limit' };
    if (capabilities && !capabilities.goals.includes(g.kind)) return { code: 'UNSUPPORTED_CAPABILITY', message: `Unsupported goal: ${g.kind}` };
    if (g.kind === 'sequence') { for (const child of g.goals) { const error = goal(child, depth + 1); if (error) return error; } return; }
    return 'target' in g ? selector(g.target) : 'inside' in g && g.inside ? selector(g.inside) : undefined;
  }
  function patch(kind: string | undefined, components: MutableComponents | undefined, appearance: Appearance | undefined): ContractError | undefined {
    if (!kind) return;
    const allowed = kind === 'agent' ? ['physical', 'navigation', 'behavior', 'mobility'] : ['physical', 'capacity', 'portal', 'interaction'];
    if (Object.keys(components ?? {}).some((key) => !allowed.includes(key)) || (kind !== 'agent' && (appearance?.symbol !== undefined || appearance?.pose !== undefined))) return { code: 'INVALID_SCHEMA', message: 'Patch is incompatible with target kind' };
    return;
  }
  for (let operationIndex = 0; operationIndex < operations.length; operationIndex++) {
    const op = operations[operationIndex]!;
    let error: ContractError | undefined;
    if (capabilities && !capabilities.operations.includes(op.op)) error = { code: 'UNSUPPORTED_CAPABILITY', message: `Unsupported operation: ${op.op}` };
    else if (op.op === 'define_rule') {
      if (op.when.kind === 'entity_metric' && capabilities && !capabilities.entityMetrics.includes(op.when.metric)) error = { code: 'UNSUPPORTED_CAPABILITY', message: `Unavailable sensor: ${op.when.metric}` };
      else error = operationError(op.operations, options, op.when.kind === 'entity_metric');
      if (!error && 'targets' in op.when) error = selector(op.when.targets);
      if (!error && 'inside' in op.when) error = selector(op.when.inside);
    } else if (op.op === 'schedule') error = operationError(op.operations, options, bound);
    else {
      if ('targets' in op) error = selector(op.targets);
      if (!error && op.op === 'assign_goal') error = goal(op.goal);
      if (!error && op.op === 'set') error = patch('kind' in op.targets ? op.targets.kind : undefined, op.values.components, op.values.appearance);
      if (!error && op.op === 'add') {
        error = patch(op.entity.kind, op.entity.components, op.entity.appearance);
        if (!error && op.entity.shape && capabilities && !capabilities.geometry.includes(op.entity.shape.kind)) error = { code: 'UNSUPPORTED_CAPABILITY', message: `Unsupported geometry: ${op.entity.shape.kind}` };
      }
      if (!error && op.op === 'spawn' && limits && op.count > limits.maxAgents) error = { code: 'RESOURCE_LIMIT', message: 'Spawn exceeds agent limit' };
      if (!error && 'placement' in op && op.placement) {
        const p = op.placement;
        const anchor = 'inside' in p ? p.inside : 'near' in p ? p.near : p.along;
        for (const s of [anchor, ...(p.awayFrom ?? [])]) { error = selector(s); if (error) break; }
      }
    }
    if (error) return { ...error, operationIndex };
  }
  return;
}

function semanticError(value: unknown, options: ValidationOptions, goalDepth = 1, dictionary = false): ContractError | undefined {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const child of value) { const e = semanticError(child, options, goalDepth); if (e) return e; } return; }
  const v = value as Record<string, unknown>;
  if (dictionary) { for (const child of Object.values(v)) { const e = semanticError(child, options, goalDepth); if (e) return e; } return; }
  if (v.binding === 'subject') return { code: 'INVALID_SCHEMA', message: 'Unbound subject selector' };
  if (typeof v.kind === 'string' && ['reach', 'avoid', 'wait', 'wander', 'follow', 'queue', 'interact', 'sequence'].includes(v.kind)) {
    if (options.capabilities && !options.capabilities.goals.includes(v.kind as Goal['kind'])) return { code: 'UNSUPPORTED_CAPABILITY', message: `Unsupported goal: ${v.kind}` };
    if (options.limits && goalDepth > options.limits.maxGoalDepth) return { code: 'RESOURCE_LIMIT', message: 'Goal depth exceeds limit' };
  }
  // Operation trees must be checked as a unit so schedule descendants retain subject scope.
  if (typeof v.op === 'string') {
    const op = OperationSchema.safeParse(v);
    if (op.success) return operationError([op.data], options);
  }
  if (v.capabilities && v.limits && v.plan) options = { ...options, capabilities: v.capabilities as Capabilities, limits: v.limits as Limits };
  if (v.context && typeof v.context === 'object' && 'capabilities' in v.context) options = { ...options, capabilities: v.context.capabilities as Capabilities };
  if (v.layout && options.capabilities && typeof v.layout === 'object' && 'mode' in v.layout && !options.capabilities.layouts.includes(v.layout.mode as Capabilities['layouts'][number])) return { code: 'UNSUPPORTED_CAPABILITY', message: 'Layout source is unavailable' };
  if (v.source && typeof v.source === 'object' && 'mode' in v.source && v.source.mode === 'upload' && 'calibration' in v.source && v.source.calibration === null && (v.units === 'm' || (v.grid && typeof v.grid === 'object' && 'units' in v.grid && v.grid.units === 'm'))) return { code: 'SCALE_CALIBRATION_REQUIRED', message: 'Metric maps require source calibration' };
  if (options.capabilities?.editableHistory === false && (v.action === 'edit_intervention' || v.action === 'delete_intervention')) return { code: 'UNSUPPORTED_CAPABILITY', message: 'History editing is unavailable' };
  if (options.limits) {
    const l = options.limits;
    if ((Array.isArray(v.agents) && v.agents.length > l.maxAgents) || (Array.isArray(v.blocked) && v.blocked.length > l.maxGridCells) || (Array.isArray(v.jobs) && v.jobs.length > l.maxPendingJobs) || (Array.isArray(v.draftBlocked) && v.draftBlocked.length > l.maxSourcePixels) || (typeof v.page === 'number' && v.page > l.maxPages) || (v.subjects && typeof v.subjects === 'object' && Object.keys(v.subjects).length > l.maxRuleCounters)) return { code: 'RESOURCE_LIMIT', message: 'Record exceeds configured resource limits' };
    if (Array.isArray(v.rules) && v.rules.reduce((total, rule: unknown) => total + (rule && typeof rule === 'object' && 'subjects' in rule && rule.subjects && typeof rule.subjects === 'object' ? Object.keys(rule.subjects).length : 0), 0) > l.maxRuleCounters) return { code: 'RESOURCE_LIMIT', message: 'Total rule counters exceed limit' };
  }
  if (v.contactState && typeof v.contactState === 'object' && 'solverVersion' in v.contactState && 'data' in v.contactState) {
    const solver = String(v.contactState.solverVersion);
    const schema = options.contactStateSchemas && Object.hasOwn(options.contactStateSchemas, solver) ? options.contactStateSchemas[solver] : undefined;
    if (!schema) return { code: 'UNSUPPORTED_CAPABILITY', message: `No registered state schema for contact solver: ${solver}` };
    if (!schema.safeParse(v.contactState.data).success) return { code: 'INVALID_SCHEMA', message: 'Invalid contact solver state' };
  }
  for (const [key, child] of Object.entries(v)) {
    if ((key === 'contactState' && 'initialSceneHash' in v) || (key === 'data' && typeof v.name === 'string' && typeof v.tick === 'number')) continue;
    if (['operations', 'initialOperations', 'timeline', 'rules'].includes(key) && Array.isArray(child) && child.every((item) => OperationSchema.safeParse(item).success)) {
      const e = operationError(child as Operation[], options); if (e) return e;
    } else { const e = semanticError(child, options, key === 'goals' ? goalDepth + 1 : 1, ['controllers', 'profiles', 'subjects', 'parameters', 'ruleSampling'].includes(key)); if (e) return e; }
  }
  return;
}

/** Safe entry point for untrusted data; low-level schemas only describe structure. */
export function parseContract<T extends z.ZodType>(schema: T, input: unknown, options: ValidationOptions = {}): Result<z.output<T>> {
  const inspected = inspectJson(input);
  if (!inspected.ok) return inspected;
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return fail('INVALID_SCHEMA', issue.message, issue.path.map(String).join('.'));
  }
  const error = schema === JsonValueSchema ? undefined : semanticError(parsed.data, options);
  return error ? { ok: false, error } : { ok: true, value: parsed.data };
}
export function decodeContract<T extends z.ZodType>(schema: T, json: string, options: ValidationOptions = {}): Result<z.output<T>> {
  let bytes = 0;
  for (const c of json) { const cp = c.codePointAt(0)!; bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4; if (bytes > JSON_BUDGET.maxBytes) return fail('RESOURCE_LIMIT', 'JSON byte budget exceeded'); }
  let input: unknown;
  try { input = JSON.parse(json); } catch { return fail('INVALID_SCHEMA', 'Invalid JSON'); }
  return parseContract(schema, input, options);
}
export function encodeContract<T extends z.ZodType>(schema: T, input: unknown, options: ValidationOptions = {}): Result<string> {
  const parsed = parseContract(schema, input, options);
  return parsed.ok ? { ok: true, value: JSON.stringify(parsed.value) } : parsed;
}
export const parseScenarioPlan = (input: unknown, options?: ValidationOptions) => parseContract(ScenarioPlanSchema, input, options);
export const parseFollowupRequest = (input: unknown, options?: ValidationOptions) => parseContract(FollowupRequestSchema, input, options);
export const parsePlannerReply = (input: unknown, options?: ValidationOptions) => parseContract(PlannerReplySchema, input, options);
export const parseCompileInput = (input: unknown, options?: ValidationOptions) => parseContract(CompileInputSchema, input, options);
export const parseWorkerCommand = (input: unknown, options?: ValidationOptions) => parseContract(WorkerCommandSchema, input, options);
export const parseWorkerMessage = (input: unknown, options?: ValidationOptions) => parseContract(WorkerMessageSchema, input, options);
export const parseSnapshot = (input: unknown, options?: ValidationOptions) => parseContract(EngineSnapshotSchema, input, options);
export const parseSavedSimulation = (input: unknown, options?: ValidationOptions) => parseContract(SavedSimulationSchema, input, options);

/** Standard JSON Schema; a pinned Gemini adapter must bound recursive refs before submission. */
export const plannerJsonSchema = () => z.toJSONSchema(PlannerReplySchema);
