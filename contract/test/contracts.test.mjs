import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { z } from 'zod';
import * as c from '../dist/index.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));
const solverOptions = { contactStateSchemas: { 'fixture-contact-v1': z.strictObject({ warmStart: z.array(z.number()) }) } };
const capabilities = {
  operations: ['add', 'spawn', 'remove', 'set', 'assign_goal', 'clear_goal', 'schedule', 'define_rule', 'remove_rule', 'emit'],
  goals: ['reach', 'avoid', 'wait', 'wander', 'follow', 'queue', 'interact', 'sequence'],
  geometry: ['rectangle', 'circle', 'polygon', 'thick_line'], layouts: ['generate', 'upload', 'lookup'], entityMetrics: ['contactLoadRatio'], editableHistory: true,
};
const limits = { maxAgents: 2000, maxGridCells: 1_000_000, maxOperationsPerBatch: 100, maxSelectorDepth: 4, maxSelectorWork: 1000, maxGoalDepth: 4, maxRuleCascades: 100, maxRuleCounters: 2000, maxPendingJobs: 1000, maxUploadBytes: 10_000_000, maxSourcePixels: 1_000_000, maxPages: 10 };
const check = (schema, value, options) => {
  const result = c.parseContract(schema, value, options);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
};
const rejects = (schema, value, code = 'INVALID_SCHEMA', options) => {
  const result = c.parseContract(schema, value, options);
  assert.equal(result.ok, false, 'Unexpected acceptance');
  assert.equal(result.error.code, code, JSON.stringify(result));
};

test('PRD and worker fixtures pass strict contracts without normalization', () => {
  const fixtures = {
    'scenario-plan': c.ScenarioPlanSchema, 'compiled-scene': c.CompiledSceneSchema,
    'runtime-agent': c.AgentRuntimeSchema, 'compression-rule': c.DefineRuleOperationSchema,
    'followup-create': c.FollowupRequestSchema, 'followup-edit_intervention': c.FollowupRequestSchema, 'followup-delete_intervention': c.FollowupRequestSchema,
    'compile-output': c.CompileOutputSchema, 'snapshot': c.EngineSnapshotSchema,
    'worker-apply': c.WorkerCommandSchema, 'worker-ack': c.WorkerMessageSchema, 'worker-frame': c.WorkerMessageSchema,
    'engine-load': c.WorkerCommandSchema,
    'engine-static-load': c.WorkerCommandSchema,
    'engine-grid-load': c.WorkerCommandSchema,
    'engine-navigation-load': c.WorkerCommandSchema,
    'engine-movement-load': c.WorkerCommandSchema,
    'engine-crossing-load': c.WorkerCommandSchema,
    'engine-services-load': c.WorkerCommandSchema,
    'engine-contact-load': c.WorkerCommandSchema,
  };
  for (const [name, schema] of Object.entries(fixtures)) {
    const original = fixture(name);
    assert.deepEqual(check(schema, original, solverOptions), original, name);
    const encoded = c.encodeContract(schema, original, solverOptions);
    assert.equal(encoded.ok, true);
    assert.deepEqual(c.decodeContract(schema, encoded.value, solverOptions), { ok: true, value: original });
  }
});

test('all ten operations and eight goals round-trip as writable JSON', () => {
  const target = { ids: ['hall'] };
  const goals = [
    { kind: 'reach', target }, { kind: 'avoid', target, distance: 1 }, { kind: 'wait', duration: 0, inside: target },
    { kind: 'wander', inside: target, changeTargetEvery: 1 }, { kind: 'follow', target, distance: 1 },
    { kind: 'queue', target, maximumWait: 3 }, { kind: 'interact', target },
    { kind: 'sequence', goals: [{ kind: 'wait', duration: 1 }], repeat: 2 },
  ];
  const operations = [
    { op: 'add', entity: { id: 'rail', kind: 'barrier', shape: { kind: 'rectangle', x: 0, y: 0, width: 1, height: 1 } } },
    { op: 'spawn', template: { kind: 'agent' }, count: 1, placement: { inside: target } },
    { op: 'remove', targets: target }, { op: 'set', targets: target, values: { appearance: { fill: '#ABCDEF' } } },
    ...goals.map((goal) => ({ op: 'assign_goal', targets: { kind: 'agent' }, goal })),
    { op: 'clear_goal', targets: { kind: 'agent' }, scope: 'all' },
    { op: 'schedule', id: 'later', after: 0, operations: [{ op: 'emit', event: { name: 'alarm' } }] },
    { op: 'define_rule', id: 'on-alarm', when: { kind: 'event', name: 'alarm' }, once: false, cooldown: 1, operations: [{ op: 'emit', event: { name: 'heard' } }] },
    { op: 'remove_rule', id: 'on-alarm' }, { op: 'emit', event: { name: 'custom', data: { a: [null, true, 3] } } },
  ];
  for (const op of operations) assert.deepEqual(c.decodeContract(c.OperationSchema, JSON.stringify(op)), { ok: true, value: op });
});

test('patches use nested fields and reject runtime, geometry and invalid appearance writes', () => {
  const base = { op: 'set', targets: { kind: 'agent' } };
  check(c.OperationSchema, { ...base, values: { components: { physical: { movable: false }, mobility: { speedMultiplier: 0 } }, appearance: { opacity: 0 } } });
  for (const values of [{}, { appearance: {} }, { appearance: null }, { 'appearance.fill': '#123456' }, { state: 'fallen' }, { position: { x: 0, y: 0 } }, { components: { physical: { radius: 2 } } }, { components: { navigation: {} } }, { appearance: { fill: 'red' } }, { appearance: { css: 'display:none' } }, { appearance: { opacity: 2 } }, { components: { capacity: { maximumOccupants: 2 } } }]) rejects(c.OperationSchema, { ...base, values });
  rejects(c.OperationSchema, { op: 'set', targets: { kind: 'zone' }, values: { appearance: { symbol: 'triangle' } } });
  rejects(c.AgentTemplateSchema, { kind: 'agent', position: { x: 0, y: 0 } });
});

test('subject bindings are scoped to each entity-metric rule and captured by schedules', () => {
  const subjectSet = { op: 'set', targets: { binding: 'subject' }, values: { components: { mobility: { speedMultiplier: 0 } }, appearance: { pose: 'fallen' } } };
  rejects(c.OperationSchema, subjectSet);
  rejects(c.SelectorSchema, { binding: 'subject' });
  const rule = fixture('compression-rule');
  rule.operations = [{ op: 'schedule', id: 'delayed-fall', after: 1, operations: [subjectSet] }];
  check(c.OperationSchema, rule, { capabilities });
  rule.operations = [{ op: 'define_rule', id: 'inner', when: { kind: 'event', name: 'alarm' }, operations: [subjectSet] }];
  rejects(c.OperationSchema, rule);
  rule.operations = [subjectSet];
  rejects(c.OperationSchema, rule, 'UNSUPPORTED_CAPABILITY', { capabilities: { ...capabilities, entityMetrics: [] } });
  rule.when.metric = 'density'; rejects(c.OperationSchema, rule);
});

test('XOR forms, finite ranges, rule cooldown and strict keys are enforced', () => {
  for (const sample of [{}, { count: 1, fraction: .5 }, { count: -1 }, { fraction: 1.1 }]) rejects(c.SampleSchema, sample);
  rejects(c.EntitySelectorSchema, {}); rejects(c.EntitySelectorSchema, { tags: [] }); rejects(c.EntitySelectorSchema, { sample: { count: 1 } });
  rejects(c.PlacementSchema, { inside: { ids: ['hall'] }, near: { ids: ['foyer'] } });
  const schedule = { op: 'schedule', id: 'job', operations: [{ op: 'emit', event: { name: 'x' } }] };
  rejects(c.OperationSchema, schedule); rejects(c.OperationSchema, { ...schedule, at: 0, after: 1 });
  const rule = { ...fixture('compression-rule'), once: false };
  rejects(c.OperationSchema, rule); rejects(c.OperationSchema, { ...rule, cooldown: 0 });
  rejects(c.OperationSchema, { op: 'assign_goal', targets: { kind: 'agent' }, goal: { kind: 'sequence', goals: [] } });
  rejects(c.AgentRuntimeSchema, { ...fixture('runtime-agent'), randomState: 2 ** 32 });
  rejects(c.ScenarioPlanSchema, { ...fixture('scenario-plan'), schemaVersion: 2 });
  rejects(c.Vec2Schema, { x: Infinity, y: 0 }); rejects(c.Vec2Schema, { x: 0, y: 0, z: 0 });
});

test('untrusted values cannot invoke getters or smuggle non-JSON properties', () => {
  const cycle = {}; cycle.self = cycle;
  const getter = Object.defineProperty({}, 'x', { enumerable: true, get() { throw Error('getter executed'); } });
  const extra = [1]; extra.foo = 2;
  for (const value of [cycle, getter, new Date(), new Map(), new Uint8Array([1]), { x: undefined }, { x: BigInt(1) }, { x: NaN }, { x() {} }, { [Symbol('x')]: 1 }, JSON.parse('{"__proto__":{}}'), { constructor: {} }, [, 1], extra]) rejects(c.JsonValueSchema, value);
  let deep = {}; for (let i = 0; i < 70; i++) deep = { child: deep };
  rejects(c.JsonValueSchema, deep, 'RESOURCE_LIMIT');
  assert.equal(c.decodeContract(c.Vec2Schema, '{broken').error.code, 'INVALID_SCHEMA');
});

test('maps keep exact dimensions, dictionaries and source calibration', () => {
  check(c.CalibrationSchema, { pointsPx: [[0, 0], [250, 0]], distanceMetres: 10, metresPerPixel: .04 });
  rejects(c.CalibrationSchema, { pointsPx: [[0, 0], [250, 0]], distanceMetres: 10, metresPerPixel: .1 });
  const grid = { width: 2, height: 1, cellSize: .5, units: 'm', blocked: [0, 1], traversalCost: [1, 1], zoneIndex: [1, 0], portalIndex: [0, 0], zoneIds: [null, 'hall'], portalIds: [null] };
  check(c.GridDataSchema, grid);
  check(c.GridDataSchema, { ...grid, traversalCost: [1, 0] });
  rejects(c.GridDataSchema, { ...grid, traversalCost: [0, 0] });
  rejects(c.GridDataSchema, { ...grid, blocked: [0] }); rejects(c.GridDataSchema, { ...grid, zoneIndex: [2, 0] });
  const scene = fixture('compiled-scene');
  assert.deepEqual(scene.map.rooms.map(({ width, height }) => [width, height]), [[10, 4], [5, 4], [5, 4]]);
  assert.deepEqual([scene.map.width, scene.map.height], [24, 6]);
  rejects(c.CompiledMapSchema, { ...scene.map, rows: scene.map.rows.slice(1) });
  rejects(c.CompiledMapSchema, { ...scene.map, legend: { ...scene.map.legend, Z: 'missing' } });
  rejects(c.ShapeSchema, { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 }] });
  rejects(c.ShapeSchema, { kind: 'thick_line', points: [{ x: 0, y: 0 }, { x: 0, y: 0 }], width: 1 });
});

test('compiler-only shorthand never becomes an LLM operation', () => {
  const spawn = fixture('compiled-scene').jobs[0].operations[0];
  check(c.CompiledOperationSchema, spawn); rejects(c.OperationSchema, spawn);
  check(c.CompiledOperationSchema, { op: 'emit', event: 'alarm' }); rejects(c.OperationSchema, { op: 'emit', event: 'alarm' });
  rejects(c.CompiledGoalSchema, { kind: 'reach', targetZone: 'hall', targetEntityId: 'door' });
  const scene = fixture('compiled-scene'); scene.agents[0].profile = 'missing'; rejects(c.CompiledSceneSchema, scene);
  const missingGoal = fixture('compiled-scene'); missingGoal.controllers.leave.targetZone = 'missing'; rejects(c.CompiledSceneSchema, missingGoal);
  const plan = fixture('scenario-plan'); plan.layout.connections[0].connects = ['hall', 'outside']; rejects(c.ScenarioPlanSchema, plan);
});

test('capabilities and configured limits are checked at entry points', () => {
  const plan = fixture('scenario-plan');
  rejects(c.ScenarioPlanSchema, plan, 'UNSUPPORTED_CAPABILITY', { capabilities: { ...capabilities, goals: [] } });
  rejects(c.ScenarioPlanSchema, plan, 'RESOURCE_LIMIT', { limits: { ...limits, maxAgents: 4 } });
  let inside = { ids: ['hall'] }; for (let i = 0; i < 5; i++) inside = { inside };
  rejects(c.OperationSchema, { op: 'remove', targets: inside }, 'RESOURCE_LIMIT', { limits });
  rejects(c.FollowupRequestSchema, fixture('followup-delete_intervention'), 'UNSUPPORTED_CAPABILITY', { capabilities: { ...capabilities, editableHistory: false } });
  const compiled = fixture('compile-output');
  check(c.CompileInputSchema, { plan, assets: [], model: compiled.resolvedModel, limits, capabilities });
  rejects(c.CompiledGoalSchema, { kind: 'sequence', goals: [{ kind: 'wait', duration: 1 }] }, 'RESOURCE_LIMIT', { limits: { ...limits, maxGoalDepth: 1 } });
});

test('snapshots retain rule counters, claims, solver state and independent RNG', () => {
  const snapshot = fixture('snapshot');
  const restored = check(c.EngineSnapshotSchema, snapshot, solverOptions);
  assert.equal(restored.rules[0].subjects.a1.heldTicks, 2);
  assert.equal(restored.rules[0].subjects.a1.fired, false);
  assert.equal(restored.queues[0].serviceCredit, .25);
  assert.deepEqual(restored.random, snapshot.random);
  rejects(c.EngineSnapshotSchema, snapshot, 'UNSUPPORTED_CAPABILITY');
  snapshot.contactState.data = { executable: 'no' }; rejects(c.EngineSnapshotSchema, snapshot, 'INVALID_SCHEMA', solverOptions);
  const badQueue = fixture('snapshot'); badQueue.queues[0].entries[0].agentId = 'missing'; rejects(c.EngineSnapshotSchema, badQueue, 'INVALID_SCHEMA', solverOptions);
  const badSensor = fixture('snapshot'); badSensor.agents[0].sensors.contactLoadRatio = 99; rejects(c.EngineSnapshotSchema, badSensor, 'INVALID_SCHEMA', solverOptions);
  const badVersion = fixture('snapshot'); badVersion.topologyVersion = 1; rejects(c.EngineSnapshotSchema, badVersion, 'INVALID_SCHEMA', solverOptions);
});

test('worker IDs, frame metadata and storage revisions stay separate', () => {
  const command = fixture('worker-apply'); command.simulationId = 'another-simulation'; rejects(c.WorkerCommandSchema, command);
  check(c.WorkerCommandSchema, { schemaVersion: 1, simulationId: 'demo', commandId: 'speed-4x', type: 'speed', multiplier: 4 });
  const scene = fixture('compiled-scene');
  check(c.RenderInputSchema, { scene: { map: scene.map, entities: [], agents: scene.agents.map((a) => ({ id: a.id, radius: .5, appearance: a.appearance })) }, frame: { streamId: 's1', tick: 0, time: 0, topologyVersion: 0, sceneVersion: 1, historyRevision: 0, agents: scene.agents.map((a) => ({ id: a.id, x: a.x, y: a.y, profile: a.profile, controller: a.controller, state: 'moving' })) }, camera: { pan: { x: 0, y: 0 }, pixelsPerUnit: 20 }, selectedIds: [] });
  rejects(c.WorkerCommandSchema, { schemaVersion: 1, simulationId: 'demo', commandId: 'step', type: 'step', ticks: -1 });
  check(c.SaveRunReplySchema, { status: 'disabled' });
  rejects(c.SaveRunReplySchema, { status: 'saved', runId: 'r1', storageRevision: 1, savedAt: '12 seconds' });
});

test('planner JSON Schema contains writable replies and keeps runtime state out', () => {
  const schema = c.plannerJsonSchema();
  const json = JSON.stringify(schema);
  assert.ok(schema.$schema); assert.ok(json.includes('$ref')); assert.ok(json.includes('additionalProperties'));
  for (const field of ['sensors', 'randomState', 'commandId', 'topologyVersion', 'contactState']) assert.equal(json.includes(`"${field}"`), false, field);
});

test('typed grid adapters copy state and retain buffers through JSON at Float32 precision', () => {
  const grid = { width: 2, height: 1, cellSize: .5, units: 'model', blocked: [0, 1], traversalCost: [1.1, 0], zoneIndex: [1, 0], portalIndex: [0, 0], zoneIds: [null, 'hall'], portalIds: [null] };
  const packed = c.gridToBuffers(grid);
  assert.equal(packed.ok, true);
  assert.ok(packed.value.blocked instanceof Uint8Array); assert.ok(packed.value.traversalCost instanceof Float32Array); assert.ok(packed.value.zoneIndex instanceof Uint32Array);
  grid.blocked[0] = 1; assert.equal(packed.value.blocked[0], 0);
  const wire = c.gridFromBuffers(packed.value);
  assert.equal(wire.ok, true);
  assert.equal(wire.value.traversalCost[0], Math.fround(1.1));
  const again = c.gridToBuffers(JSON.parse(JSON.stringify(wire.value)));
  assert.deepEqual(again.value, packed.value);
  assert.equal(c.gridToBuffers({ ...grid, traversalCost: [1e100, 0] }).ok, false);
});

test('uncalibrated upload can be previewed but cannot claim metre units', () => {
  const map = { id: 'map', revision: 'r1', reviewed: true, entities: [], source: { mode: 'upload', assetId: 'plan', revision: 'r1', page: 1, calibration: null, sourceToWorld: [.04, 0, 0, .04, 0, 0] }, grid: { width: 1, height: 1, cellSize: 1, units: 'model', blocked: [0], traversalCost: [1], zoneIndex: [0], portalIndex: [0], zoneIds: [null], portalIds: [null] } };
  check(c.PreparedMapSchema, map);
  map.grid.units = 'm'; rejects(c.PreparedMapSchema, map, 'SCALE_CALIBRATION_REQUIRED');
  map.source.calibration = { pointsPx: [[0, 0], [250, 0]], distanceMetres: 10, metresPerPixel: .04 };
  check(c.PreparedMapSchema, map);
});

test('terrain speed is a separate optional copied Float32 grid buffer', () => {
  const grid = fixture('engine-grid-load').compiled.scene.map.grid;
  const speed = Array(grid.width * grid.height).fill(0.5);
  const input = { ...grid, terrainSpeedMultiplier: speed };
  check(c.GridDataSchema, input);
  const packed = c.gridToBuffers(input);
  assert.equal(packed.ok, true);
  assert.ok(packed.value.terrainSpeedMultiplier instanceof Float32Array);
  speed[0] = 1;
  assert.equal(packed.value.terrainSpeedMultiplier[0], 0.5);
  assert.deepEqual(c.gridFromBuffers(packed.value).value.terrainSpeedMultiplier, Array(speed.length).fill(0.5));
  for (const bad of [[], [0], [-1], [2], [Infinity], [1e-100]]) {
    const values = bad.length ? Array(speed.length).fill(bad[0]) : bad;
    assert.equal(c.gridToBuffers({ ...grid, terrainSpeedMultiplier: values }).ok, false);
  }
  assert.equal(c.gridFromBuffers(c.gridToBuffers(grid).value).value.terrainSpeedMultiplier, undefined);
});

test('explicit departures and leaf execution are typed separately from writable goals', () => {
  check(c.GoalSchema, { kind: 'reach', target: { ids: ['outside'] }, departOnArrival: true });
  check(c.CompiledGoalSchema, { kind: 'reach', targetZone: 'outside', departOnArrival: true });
  rejects(c.GoalSchema, { kind: 'wait', duration: 1, departOnArrival: true });
  const runtime = fixture('runtime-agent');
  runtime.currentGoal.execution = { phase: 'travel', elapsed: 0.2, targetPoint: null };
  check(c.AgentRuntimeSchema, runtime);
  rejects(c.AgentRuntimeSchema, { ...runtime, currentGoal: { ...runtime.currentGoal, execution: { phase: 'flying', elapsed: 0, targetPoint: null } } });
  rejects(c.GoalSchema, { kind: 'wait', duration: 1, execution: runtime.currentGoal.execution });
});

test('saved runs and storage updates validate their complete envelopes', () => {
  const plan = fixture('scenario-plan');
  const saved = { plan, compiled: fixture('compile-output'), history: { historyRevision: 1, records: [{ id: 'base', revision: 1, origin: 'base', label: 'Initial', at: 0, order: 0, operations: plan.initialOperations, deleted: false }], outcomes: [] }, snapshots: [fixture('snapshot')] };
  check(c.SavedSimulationSchema, saved, solverOptions);
  check(c.SaveRunRequestSchema, { saved }, solverOptions);
  check(c.SaveRunRequestSchema, { runId: 'run-1', expectedStorageRevision: 1, saved }, solverOptions);
  rejects(c.SaveRunRequestSchema, { runId: 'run-1', saved }, 'INVALID_SCHEMA', solverOptions);
  saved.snapshots[0].simulationId = 'other'; rejects(c.SavedSimulationSchema, saved, 'INVALID_SCHEMA', solverOptions);
});

test('dictionary IDs cannot bypass checks or change goal-depth interpretation', () => {
  const scene = fixture('compiled-scene');
  scene.controllers.data = { kind: 'queue', targetEntityId: 'hall_door' };
  rejects(c.CompiledSceneSchema, scene, 'UNSUPPORTED_CAPABILITY', { capabilities: { ...capabilities, goals: capabilities.goals.filter((kind) => kind !== 'queue') } });
  scene.controllers = { goals: { kind: 'wait', duration: 1 } };
  scene.agents.forEach((a) => { a.controller = 'goals'; }); scene.rules = []; scene.jobs = [];
  check(c.CompiledSceneSchema, scene, { limits: { ...limits, maxGoalDepth: 1 } });
  check(c.JsonValueSchema, { op: 'set', targets: { binding: 'subject' }, values: { arbitrary: true } });
});

test('compiled clearance is explicit, finite and unique, including declared future members', () => {
  const scene = fixture('compiled-scene');
  scene.clearance = { cohortIds: ['a1', 'a2', 'future-agent'], startedAt: 30 };
  check(c.CompiledSceneSchema, scene);
  rejects(c.ClearanceCohortSchema, { cohortIds: [], startedAt: 0 });
  rejects(c.ClearanceCohortSchema, { cohortIds: ['a1', 'a1'], startedAt: 0 });
  rejects(c.ClearanceCohortSchema, { cohortIds: ['a1'], startedAt: -1 });
});

test('registered disc contact validates parameters, state and captured subject jobs', () => {
  const input = fixture('engine-contact-load'); check(c.WorkerCommandSchema, input);
  const contact = input.compiled.resolvedModel.contact;
  rejects(c.ContactModelSchema, { ...contact, parameters: { ...contact.parameters, iterations: 0 } });
  rejects(c.ContactModelSchema, { ...contact, parameters: { ...contact.parameters, extra: 1 } });
  check(c.DiscImpulseStateSchema, { sampleTick: 1, dt: 0.05, impulses: { a1: [0.1, 0.2] } });
  rejects(c.DiscImpulseStateSchema, { sampleTick: 1, dt: 0, impulses: {} });
  const snapshot = fixture('snapshot');
  snapshot.model.contact = contact;
  snapshot.contactState = { solverVersion: 'disc-impulse-v1', data: { sampleTick: snapshot.tick, dt: snapshot.model.dt, impulses: {} } };
  for (const agent of snapshot.agents) agent.sensors = null;
  check(c.EngineSnapshotSchema, snapshot);
  snapshot.contactState.data = { warmStart: [] }; rejects(c.EngineSnapshotSchema, snapshot);
});
