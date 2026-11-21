import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runConformance } from './run-conformance.js';
test('runs all four adapters sequentially with finite deadlines', () => {
  const calls = [];
  assert.equal(runConformance({ report() {}, spawn(command, args, options) {
    calls.push({ command, args, options }); return { status: 0 };
  } }), 0);
  assert.equal(calls.length, 4);
  assert.ok(calls[0].args.includes('--workspace=packages/memory'));
  assert.ok(calls[1].args.includes('--workspace=packages/file'));
  assert.equal(calls[2].args[0], 'packages/neo4j/test/run-integration.js');
  assert.equal(calls[3].args[0], 'packages/sparql/test/run-integration.js');
  for (const call of calls) assert.ok(call.options.timeout > 0 && call.options.timeout <= 900000);
});
for (const failure of ['exit', 'timeout', 'throw']) test(`aggregates ${failure} without silently skipping backends`, () => {
  let calls = 0;
  const logs = [];
  assert.equal(runConformance({ report: line => logs.push(line), spawn() {
    calls++;
    if (calls !== 1) return { status: 0 };
    if (failure === 'throw') throw new Error('SECRET');
    return failure === 'exit' ? { status: 1 } : { status: null, error: { code: 'ETIMEDOUT' } };
  } }), 1);
  assert.equal(calls, 4);
  assert.ok(logs[0].includes('failed'));
  assert.ok(!logs.join('\n').includes('SECRET'));
});
