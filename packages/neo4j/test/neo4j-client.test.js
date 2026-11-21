import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Neo4jDriver } from '../Neo4jDriver.js';

const url = 'jssgdbc:neo4j:bolt://localhost:7687';
const secretError = (code = 'Neo.ClientError.Security.Unauthorized') => Object.assign(new Error('secret password query params'), { code });
function fixture(fail = {}) {
  const calls = { sessions: [], runs: [], closes: 0, verify: 0, transactions: [] };
  const native = {
    async verifyConnectivity() { calls.verify++; if (fail.verify) throw fail.verify; },
    session(options) {
      if (fail.session) throw fail.session;
      const state = { options, closes: 0 }; calls.sessions.push(state);
      const execute = async (mode, work, config) => {
        calls.transactions.push({ mode, config });
        if (fail.transaction) throw fail.transaction;
        return work({ run: async (query, params) => {
          calls.runs.push({ query, params });
          if (fail.query) throw fail.query;
          return fail.result ?? { records: [{ value: 'exact' }] };
        } });
      };
      return {
        executeRead: (work, config) => execute('read', work, config),
        executeWrite: (work, config) => execute('write', work, config),
        async close() { state.closes++; if (fail.cleanup) throw fail.cleanup; }
      };
    },
    async close() { calls.closes++; if (fail.close) throw fail.close; }
  };
  const driver = new Neo4jDriver((...args) => { calls.factory = args; if (fail.factory) throw fail.factory; return native; });
  return { driver, calls, fail };
}

test('canonical dispatch and all supported URI schemes', async () => {
  const f = fixture();
  assert.equal(f.driver.acceptsURL(url), true);
  for (const value of [null, 1, 'jsgdbc:neo4j:bolt://localhost', 'jssgdbc:memory:']) assert.equal(f.driver.acceptsURL(value), false);
  for (const scheme of ['bolt', 'bolt+s', 'bolt+ssc', 'neo4j', 'neo4j+s', 'neo4j+ssc']) {
    const client = await f.driver.connect(`jssgdbc:neo4j:${scheme}://localhost:7687`);
    await client.close();
  }
});

test('URL and property rejection happens before native allocation without echo', async () => {
  const f = fixture();
  for (const value of [null, 'jsgdbc:neo4j:bolt://localhost', 'jssgdbc:neo4j:http://localhost', 'jssgdbc:neo4j:bolt://secret:password@localhost', 'jssgdbc:neo4j:bolt://', 'jssgdbc:neo4j:bolt://localhost:99999', 'jssgdbc:neo4j:bolt://localhost/path', 'jssgdbc:neo4j:bolt://localhost#secret']) {
    await assert.rejects(f.driver.connect(value), /Invalid Neo4j URL/);
  }
  for (const props of [null, [], 'secret', { username: 'secret' }, { password: 'secret' }, { username: 1, password: 'secret' }, { database: '' }, { database: 1 }, { timeoutMs: 0 }, { timeoutMs: Infinity }, { timeoutMs: 1.5 }, { connectionTimeoutMs: -1 }, { secret: 'password' }]) {
    await assert.rejects(f.driver.connect(url, props), /Invalid Neo4j properties/);
  }
  assert.equal(f.calls.factory, undefined);
});

test('connect verifies connectivity and installs composite constraint before returning', async () => {
  const f = fixture();
  const client = await f.driver.connect(url, { username: 'user', password: 'password', database: 'test', timeoutMs: 123, connectionTimeoutMs: 456 });
  assert.equal(f.calls.verify, 1);
  assert.equal(f.calls.factory[0], 'bolt://localhost:7687');
  assert.deepEqual(f.calls.factory[1], { scheme: 'basic', principal: 'user', credentials: 'password' });
  assert.equal(f.calls.factory[2].connectionTimeout, 456);
  assert.equal(f.calls.factory[2].connectionAcquisitionTimeout, 456);
  assert.match(f.calls.runs[0].query, /CREATE CONSTRAINT .* IF NOT EXISTS FOR \(t:JssgdbcTerm\) REQUIRE \(t.graph, t.kind, t.value\) IS UNIQUE/);
  assert.deepEqual(f.calls.runs[0].params, {});
  assert.equal(f.calls.sessions[0].options.database, 'test');
  assert.deepEqual(f.calls.transactions[0], { mode: 'write', config: { timeout: 123 } });
  assert.equal(f.calls.sessions[0].closes, 1);
  assert.equal(client.isClosed(), false);
  await client.close();
});

test('read/write operations buffer records and keep params separate with one closed session each', async () => {
  const f = fixture();
  const client = await f.driver.connect(url);
  const params = { value: 'secret' };
  assert.deepEqual(await client._query('RETURN $value', params), [{ value: 'exact' }]);
  await client._update('RETURN $value', params);
  assert.deepEqual(f.calls.transactions.map(t => t.mode), ['write', 'read', 'write']);
  assert.equal(f.calls.runs[1].params, params);
  assert.equal(f.calls.runs[1].query, 'RETURN $value');
  assert.ok(f.calls.sessions.every(s => s.closes === 1));
  await client.close();
});

for (const stage of ['factory', 'verify', 'session', 'transaction', 'query', 'cleanup']) {
  test(`initialization ${stage} failure is redacted and owned resources close exactly once`, async () => {
    const f = fixture({ [stage]: secretError(), close: secretError('secret') });
    await assert.rejects(f.driver.connect(url), error => {
      assert.match(error.message, /Neo4j (connect|initialize)/);
      assert.ok(!error.stack.includes('password'));
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(f.calls.closes, stage === 'factory' ? 0 : 1);
    assert.ok(f.calls.sessions.every(s => s.closes === 1));
  });
}

test('query failure wins over cleanup failure; safe code retained, arbitrary code dropped', async () => {
  const f = fixture();
  const client = await f.driver.connect(url);
  f.fail.query = secretError('Neo.TransientError.Transaction.DeadlockDetected');
  f.fail.cleanup = secretError('secret');
  await assert.rejects(client._query('secret', { password: 'secret' }), { message: 'Neo4j query failed (Neo.TransientError.Transaction.DeadlockDetected)' });
  f.fail.query = secretError('password');
  await assert.rejects(client._query('secret'), { message: 'Neo4j query failed' });
  assert.ok(f.calls.sessions.every(s => s.closes === 1));
  await client.close();
});

test('malformed result and session/transaction/cleanup failures remain safe', async () => {
  for (const stage of ['session', 'transaction', 'cleanup', 'result']) {
    const f = fixture();
    const client = await f.driver.connect(url);
    f.fail[stage] = stage === 'result' ? { records: null } : secretError();
    await assert.rejects(client._query('secret'), /Neo4j query failed/);
    assert.ok(f.calls.sessions.every(s => s.closes === 1));
    await client.close();
  }
});

test('close is synchronous in state, awaitable, idempotent, and redacts native rejection', async () => {
  const f = fixture();
  const client = await f.driver.connect(url);
  f.fail.close = secretError();
  const closing = client.close();
  assert.equal(client.isClosed(), true);
  assert.equal(client.close(), closing);
  await assert.rejects(closing, /Neo4j close failed/);
  await assert.rejects(client._query('RETURN 1'), /client is closed/);
  assert.throws(() => client.getGraph(), /closed/);
  assert.equal(f.calls.closes, 1);
});
