import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runConformance } from './run-conformance.js';

const phases = [
  ['memory', 'npm', ['test', '--workspace=packages/memory'], 120000],
  ['file', 'npm', ['test', '--workspace=packages/file'], 120000],
  ['memory Dataset', process.execPath, ['test/verify-dataset-memory.js'], 120000],
  ['file Dataset', process.execPath, ['test/verify-dataset-file.js'], 120000],
  ['Neo4j', process.execPath, ['packages/neo4j/test/run-integration.js'], 780000],
  ['Fuseki', process.execPath, ['packages/sparql/test/run-integration.js'], 900000],
];
function assertCoverage(calls) {
  assert.deepEqual(calls, phases.map(([, command, args, timeout]) => ({ command, args, options: {
    cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit', timeout, killSignal: 'SIGKILL'
  } })));
}
function assertReports(logs, failures = []) {
  assert.equal(logs.length, phases.length);
  phases.forEach(([name], index) => assert.match(logs[index], new RegExp(
    `^Conformance ${name}: ${failures.includes(index) ? 'failed' : 'passed'} \\(\\d+ms\\)$`)));
}
test('runs exact local and mandatory real phases sequentially with finite deadlines', () => {
  const calls = [], logs = [];
  assert.equal(runConformance({ report: line => logs.push(line), spawn(command, args, options) {
    calls.push({ command, args, options }); return { status: 0 };
  } }), 0);
  assertCoverage(calls);
  assertReports(logs);
});
const failures = {
  exit: () => ({ status: 1 }),
  timeout: () => ({ status: null, error: { code: 'ETIMEDOUT' } }),
  signal: () => ({ status: null, signal: 'SIGTERM' }),
  'signal with zero status': () => ({ status: 0, signal: 'SIGKILL' }),
  'spawn error': () => ({ status: 0, error: { code: 'ENOENT' } }),
  throw: () => { throw new Error('SECRET'); },
  'missing result': () => undefined
};
for (const [failure, result] of Object.entries(failures)) {
  for (let index = 0; index < phases.length; index++) {
    test(`aggregates ${failure} in ${phases[index][0]} without skipping later phases`, () => {
      const calls = [], logs = [];
      assert.equal(runConformance({ report: line => logs.push(line), spawn(command, args, options) {
        calls.push({ command, args, options });
        return calls.length - 1 === index ? result() : { status: 0 };
      } }), 1);
      assertCoverage(calls);
      assertReports(logs, [index]);
      assert.ok(!logs.join('\n').includes('SECRET'));
    });
  }
}
test('retains multiple failures including real-runner cleanup failure exits', () => {
  const calls = [], logs = [];
  assert.equal(runConformance({ report: line => logs.push(line), spawn(command, args, options) {
    calls.push({ command, args, options });
    return { status: [0, 4, 5].includes(calls.length - 1) ? 1 : 0 };
  } }), 1);
  assertCoverage(calls);
  assertReports(logs, [0, 4, 5]);
});
