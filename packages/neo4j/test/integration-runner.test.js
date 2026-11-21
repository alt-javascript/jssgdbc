import test from 'node:test';
import assert from 'node:assert/strict';
import { runIntegration } from './run-integration.js';

function exercise(failAt = -1, failure = { status: 1 }) {
  const calls = [];
  const messages = [];
  const status = runIntegration({
    spawn(command, args, options) {
      calls.push({ command, args, options });
      if (calls.length - 1 === failAt) {
        if (failure instanceof Error) throw failure;
        return failure;
      }
      return { status: 0 };
    },
    report: message => messages.push(message),
  });
  const first = calls[0];
  const last = calls.at(-2);
  assert.equal(calls.at(-1).command, process.execPath);
  assert.ok(calls.at(-1).args.at(-1).includes(`label=com.docker.compose.project=${first.args[2]}`));
  assert.equal(first.command, 'docker');
  assert.equal(last.command, 'docker');
  assert.deepEqual(last.args.slice(0, 5), first.args.slice(0, 5));
  assert.deepEqual(last.args.slice(5), ['down', '--volumes', '--remove-orphans']);
  assert.match(first.args[2], /^jssgdbc-test-[0-9a-f-]{36}$/);
  for (const call of calls) {
    assert.ok(call.options.timeout > 0 && call.options.timeout <= 300000);
    assert.equal(call.options.killSignal, 'SIGKILL');
  }
  assert.ok(!messages.join('').includes('secret-native-body'));
  return { calls, messages, status };
}

test('successful startup, separate node and workspace Mocha suites, then scoped cleanup', () => {
  const { calls, messages, status } = exercise();
  assert.equal(status, 0);
  assert.ok(messages.some(message => message.includes('owned container removal passed')));
  assert.equal(calls.length, 5);
  assert.deepEqual(calls[1].args, ['--test', 'test/neo4j-integration.test.js', 'test/readme-integration.test.js']);
  assert.match(calls[2].args[0], /mocha\/bin\/mocha.js$/);
  assert.ok(calls[2].args.includes('--forbid-pending'));
  assert.ok(calls[2].args.includes('--fail-zero'));
  assert.notEqual(calls[0].args[2], exercise().calls[0].args[2]);
});

test('startup failure skips suites but still tears down', () => {
  const result = exercise(0);
  assert.equal(result.status, 1);
  assert.equal(result.calls.length, 3);
  assert.ok(result.messages.some(message => /startup\/readiness failed/.test(message)));
});

for (const [index, phase] of [[1, 'node:test'], [2, 'Mocha compliance'], [3, 'fixture teardown'], [4, 'owned container removal']]) {
  test(`${phase} failure propagates nonzero and cleanup runs`, () => {
    const result = exercise(index);
    assert.equal(result.status, 1);
    assert.equal(result.calls.length, 5);
    assert.ok(result.messages.some(message => message.includes(phase) && message.includes('failed')));
  });
}

for (const failure of [
  { status: null, error: new Error('secret-native-body') },
  { status: null, signal: 'SIGKILL' },
  new Error('secret-native-body'),
  undefined,
]) {
  test(`subprocess error, timeout, throw or malformed result fails safely (${String(failure)})`, () => {
    // Explicit null exercises a missing result (undefined uses the helper default).
    const result = exercise(1, failure === undefined ? null : failure);
    assert.equal(result.status, 1);
    assert.equal(result.calls.length, 5);
  });
}
