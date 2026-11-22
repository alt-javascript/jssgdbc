import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Neo4jDriver } from '../Neo4jDriver.js';
import { CONSTRAINTS, INSPECT_SCHEMA, ENSURE_SCHEMA, SCHEMA_PARAMS } from '../RdfStorage.js';

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
          if (fail.queryAt === query) throw secretError();
          if (query === INSPECT_SCHEMA) return { records: [{ get: key => ({ legacy: false, owned: false, markers: [SCHEMA_PARAMS] })[key] }] };
          if (query === ENSURE_SCHEMA) return { records: [{ get: () => SCHEMA_PARAMS }] };
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
  assert.deepEqual(f.calls.runs.map(run => run.query), [INSPECT_SCHEMA, ...CONSTRAINTS, INSPECT_SCHEMA, ENSURE_SCHEMA, INSPECT_SCHEMA]);
  assert.deepEqual(f.calls.runs[0].params, {});
  assert.equal(f.calls.sessions[0].options.database, 'test');
  assert.deepEqual(f.calls.transactions[0], { mode: 'read', config: { timeout: 123 } });
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
  assert.deepEqual(f.calls.transactions.map(t => t.mode), ['read', 'write', 'write', 'read', 'write']);
  assert.equal(f.calls.runs[CONSTRAINTS.length + 4].params, params);
  assert.equal(f.calls.runs[CONSTRAINTS.length + 4].query, 'RETURN $value');
  assert.ok(f.calls.sessions.every(s => s.closes === 1));
  await client.close();
});

for (const stage of ['factory', 'verify', 'session', 'transaction', 'query', 'cleanup']) {
  test(`initialization ${stage} failure is redacted and owned resources close exactly once`, async () => {
    const f = fixture({ [stage]: secretError(), close: secretError('secret') });
    await assert.rejects(f.driver.connect(url), error => {
      assert.match(error.message, /Neo4j (connect|initialize)/);
      const inspect = value => {
        assert.doesNotMatch(value.stack, /secret|password/);
        assert.equal(value.cause, undefined);
        for (const child of value.errors ?? []) inspect(child);
      };
      inspect(error);
      if (stage !== 'factory') {
        assert.equal(error.errors.length, 2);
        assert.match(error.errors[1].errors[0].message, /Neo4j close failed/);
      }
      return true;
    });
    assert.equal(f.calls.closes, stage === 'factory' ? 0 : 1);
    assert.ok(f.calls.sessions.every(s => s.closes === 1));
  });
}

for (const queryAt of [...CONSTRAINTS, ENSURE_SCHEMA]) {
  test(`later initialization failure releases sessions and driver: ${queryAt.split(' ')[0]}`, async () => {
    const f = fixture({ queryAt });
    await assert.rejects(f.driver.connect(url), error => {
      assert.match(error.message, /Neo4j initialize failed/);
      assert.doesNotMatch(error.stack, /secret|password/);
      return true;
    });
    assert.equal(f.calls.closes, 1);
    assert.ok(f.calls.sessions.every(s => s.closes === 1));
  });
}

test('query and cleanup failures remain visible; safe code retained, arbitrary code dropped', async () => {
  const f = fixture();
  const client = await f.driver.connect(url);
  f.fail.query = secretError('Neo.TransientError.Transaction.DeadlockDetected');
  f.fail.cleanup = secretError('secret');
  await assert.rejects(client._query('secret', { password: 'secret' }), error => {
    assert.deepEqual(error.errors.map(e => e.message), ['Neo4j query failed (Neo.TransientError.Transaction.DeadlockDetected)', 'Neo4j session close failed']);
    return true;
  });
  f.fail.query = secretError('password');
  await assert.rejects(client._query('secret'), error => {
    assert.deepEqual(error.errors.map(e => e.message), ['Neo4j query failed', 'Neo4j session close failed']);
    return true;
  });
  assert.ok(f.calls.sessions.every(s => s.closes === 1));
  await client.close();
});

test('malformed result and session/transaction/cleanup failures remain safe', async () => {
  for (const stage of ['session', 'transaction', 'cleanup', 'result']) {
    const f = fixture();
    const client = await f.driver.connect(url);
    f.fail[stage] = stage === 'result' ? { records: null } : secretError();
    await assert.rejects(client._query('secret'), /Neo4j (query|session close) failed/);
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
  await assert.rejects(closing, error => {
    assert.match(error.errors[0].message, /Neo4j close failed/);
    return true;
  });
  await assert.rejects(client._query('RETURN 1'), /client is closed/);
  assert.throws(() => client.getGraph(), /closed/);
  assert.equal(f.calls.closes, 1);
});
