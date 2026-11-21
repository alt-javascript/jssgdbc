import assert from 'node:assert/strict';
import { runIntegration } from './run-integration.js';
describe('Disposable Fuseki orchestration', () => {
  function exercise(failIndex, failure) {
    const calls = [], logs = [];
    const code = runIntegration({ report: line => logs.push(line), spawn(command, args, options) {
      calls.push({ command, args, options });
      if (calls.length - 1 === failIndex) {
        if (failure === 'throw') throw new Error('SECRET');
        return failure;
      }
      return { status: 0 };
    } });
    return { code, calls, logs };
  }
  it('runs bounded live assertions then exact-project teardown and removal check', () => {
    const { code, calls } = exercise(-1);
    assert.equal(code, 0);
    assert.equal(calls.length, 4);
    assert.ok(calls[1].args.includes('test/live-compliance.js'));
    const project = calls[0].args[2];
    assert.match(project, /^jssgdbc-fuseki-/);
    assert.equal(calls[2].args[2], project);
    assert.ok(calls[2].args.includes('down'));
    assert.ok(calls[3].args.at(-1).includes(project));
    for (const call of calls) {
      assert.ok(call.options.timeout > 0 && call.options.timeout <= 600000);
      assert.equal(call.options.killSignal, 'SIGKILL');
      assert.equal(call.options.env.JSSGDBC_DISPOSABLE_FUSEKI, project);
    }
  });
  for (const [label, index, failure] of [
    ['unavailable Docker', 0, 'throw'], ['startup error', 0, { status: 1 }],
    ['startup timeout', 0, { status: null, error: { code: 'ETIMEDOUT' } }],
    ['suite failure', 1, { status: 1 }], ['suite timeout', 1, { status: null, error: { code: 'ETIMEDOUT' } }],
    ['cleanup failure', 2, { status: 1 }], ['remaining container', 3, { status: 1 }],
  ]) it(`fails visibly for ${label} and always attempts cleanup`, () => {
    const { code, calls, logs } = exercise(index, failure);
    assert.equal(code, 1);
    assert.ok(calls.some(call => call.args.includes('down')));
    assert.ok(logs.some(line => line.includes('failed')));
    assert.ok(!logs.join('\n').includes('SECRET'));
  });
});
