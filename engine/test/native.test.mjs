import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseWorkerMessage } from '../../contract/dist/index.js';

test('native Rust output conforms to shared Zod worker schemas', () => {
  const command = JSON.parse(readFileSync(new URL('../../contract/fixtures/engine-static-load.json', import.meta.url), 'utf8'));
  const executable = fileURLToPath(new URL(`../../target/debug/examples/protocol${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
  const input = [command, { schemaVersion: 1, simulationId: 'engine-demo', commandId: 'reset', type: 'reset' }, { schemaVersion: 1, simulationId: 'engine-demo', commandId: 'step', type: 'step', ticks: 1 }, { schemaVersion: 1, simulationId: 'engine-demo', commandId: 'snapshot', type: 'snapshot', snapshotId: 'native-state' }].map((value) => JSON.stringify(value)).join('\n') + '\n';
  const output = execFileSync(executable, { input, encoding: 'utf8' }).trim().split('\n').map(JSON.parse);
  for (const messages of output) for (const message of messages) {
    const result = parseWorkerMessage(message); assert.equal(result.ok, true, JSON.stringify(result));
  }
  assert.deepEqual(output[0].map((m) => m.type), ['ack', 'scene', 'frame', 'metrics']);
  assert.equal(output[0][1].scene.agents.length, 2);
  assert.equal(output[0][1].scene.agents[0].appearance.fill, '#2563EB');
  assert.notEqual(output[0][2].frame.streamId, output[1][2].frame.streamId);
  assert.equal(output[2][0].stamp.tick, 1);
  assert.equal(output[3][0].snapshot.agents[0].sensors, null);
  assert.equal(output[3][0].snapshot.agents[0].zoneId, 'hall');
});
