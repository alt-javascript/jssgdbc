import test from 'node:test';
import assert from 'node:assert/strict';
import neo4j from 'neo4j-driver';
import { Neo4jClient, Neo4jDriver, Neo4jGraph, CypherBuilder, Cursor, DriverManager } from '../index.js';

const row = values => new neo4j.Record(Object.keys(values), Object.values(values));
function fixture() {
  const state = { records: [], calls: [], sessions: 0, closed: 0, transactions: 0 };
  const native = {
    async close() {},
    session() {
      state.sessions++;
      const tx = { async run(query, params) {
        state.calls.push({ query, params });
        if (state.failure && (!state.failAt || state.calls.length === state.failAt)) throw state.failure;
        return { records: state.records };
      } };
      return {
        async executeRead(work) { state.transactions++; return work(tx); },
        async executeWrite(work) {
          state.transactions++;
          try { return await work(tx); }
          catch (error) { if (state.retry) return work(tx); throw error; }
        },
        async close() { state.closed++; if (state.cleanupFailure) throw state.cleanupFailure; }
      };
    }
  };
  return { state, client: new Neo4jClient(null, 'jssgdbc:neo4j:bolt://localhost', { timeoutMs: 100 }, native) };
}

test('public exports and singleton registration', () => {
  assert.equal(typeof Neo4jDriver, 'function');
  assert.equal(typeof CypherBuilder.buildAdd, 'function');
  assert.ok(DriverManager.getDrivers().some(driver => driver instanceof Neo4jDriver));
});

test('graph names normalize before caching and reject nonstrings without echoing', () => {
  const { client } = fixture();
  const graph = client.getGraph();
  assert.ok(graph instanceof Neo4jGraph);
  assert.equal(graph, client.getGraph(null));
  assert.equal(graph, client.getGraph(undefined));
  assert.equal(graph, client.getGraph(''));
  assert.notEqual(graph, client.getGraph('named'));
  for (const name of [1, {}, [], new String('secret')]) assert.throws(() => client.getGraph(name), /graph name must be a string/);
});

test('all pattern hooks forward all eight wildcard masks and graph scope', async () => {
  const { client, state } = fixture();
  for (const name of ['', 'named\" MATCH (n) DELETE n']) {
    const graph = client.getGraph(name);
    for (let mask = 0; mask < 8; mask++) {
      const terms = ['_:s', 'urn:p', String.raw`"exact\\\""@en`].map((v, i) => mask & (1 << i) ? v : null);
      for (const [method, builder, records] of [
        ['find', 'buildFind', []], ['has', 'buildHas', [row({ exists: false })]],
        ['count', 'buildCount', [row({ count: neo4j.int(0) })]], ['remove', 'buildRemove', []]
      ]) {
        state.records = records;
        const result = await graph[method](...terms);
        assert.deepEqual(state.calls.at(-1), CypherBuilder[builder](name, ...terms));
        if (method === 'find') assert.deepEqual(result.getTriples(), []);
        if (method === 'remove') assert.equal(result, undefined);
      }
    }
    assert.equal(await graph.clear(), undefined);
    assert.deepEqual(state.calls.at(-1), CypherBuilder.buildClear(name));
  }
  assert.equal(state.closed, state.sessions);
});

test('find buffers exact strings in a core Cursor after session cleanup', async () => {
  const { client, state } = fixture();
  const triples = [String.raw`"quotes \\ and ' injection"@en`, '_:blank', 'urn:iri'].map(object => ({ subject: '_:s', predicate: 'urn:p', object }));
  state.records = triples.map(row);
  const cursor = await client.getGraph().find();
  assert.ok(cursor instanceof Cursor);
  assert.equal(state.closed, 1);
  await client.close();
  assert.deepEqual(cursor.getTriples(), triples);
  const iterated = [];
  for await (const triple of cursor) iterated.push(triple);
  assert.deepEqual(iterated, triples);
});

test('add locks subject before builder MERGE in one managed transaction, including self loops and reverse endpoints', async () => {
  const { client, state } = fixture();
  for (const terms of [['_:s', 'urn:p', '_:s'], ['urn:a', 'urn:p', 'urn:b'], ['urn:b', 'urn:p', 'urn:a']]) {
    const start = state.calls.length;
    assert.equal(await client.getGraph('named').add(...terms), undefined);
    const [lock, add] = state.calls.slice(start);
    assert.match(lock.query, /MERGE \(s:JssgdbcTerm/);
    assert.match(lock.query, /SET s\._jssgdbcLock = true/);
    assert.match(lock.query, /REMOVE s\._jssgdbcLock/);
    assert.deepEqual(lock.params, { graph: 'named', subjectKind: terms[0].startsWith('_:') ? 'blank' : 'iri', subject: terms[0] });
    assert.deepEqual(add, CypherBuilder.buildAdd('named', ...terms));
  }
  assert.equal(state.transactions, 3);
  assert.equal(state.closed, 3);
});

test('managed retries replay lock plus add and second-statement failures close the session', async () => {
  const { client, state } = fixture();
  state.failure = Object.assign(new Error('secret'), { code: 'Neo.TransientError.Transaction.DeadlockDetected' });
  state.failAt = 2;
  await assert.rejects(client.getGraph().add('urn:a', 'urn:p', 'urn:b'), { message: 'Neo4j add failed (Neo.TransientError.Transaction.DeadlockDetected)' });
  assert.equal(state.closed, 1);
  state.calls = [];
  state.retry = true;
  await client.getGraph().add('urn:a', 'urn:p', 'urn:b');
  assert.equal(state.calls.length, 4);
  assert.deepEqual(state.calls.slice(0, 2), state.calls.slice(2));
  assert.equal(state.transactions, 2);
  assert.equal(state.closed, 2);
});

test('invalid builder inputs fail before allocating a session', async () => {
  const { client, state } = fixture();
  const graph = client.getGraph();
  for (const method of ['add', 'remove', 'find', 'has', 'count']) {
    await assert.rejects(graph[method]('"secret"', 'urn:p', 'urn:o'), /subject/);
    await assert.rejects(graph[method]('urn:s', '_:secret', 'urn:o'), /predicate/);
    await assert.rejects(graph[method]('urn:s', 'urn:p', {}), /object/);
  }
  await assert.rejects(graph.add(), /subject/);
  assert.equal(state.sessions, 0);
});

test('find rejects malformed aliases/types with safe errors after closing session', async () => {
  const { client, state } = fixture();
  for (const bad of [null, {}, row({ subject: 'urn:s', predicate: 'urn:p' }), row({ subject: 1, predicate: 'urn:p', object: 'secret' }),
    { keys: ['subject', 'predicate', 'object'], get() { throw new Error('secret'); } }]) {
    state.records = [bad];
    await assert.rejects(client.getGraph().find(), { message: 'Neo4j find: invalid result' });
    assert.equal(state.closed, state.sessions);
  }
});

test('has accepts only one boolean aggregate', async () => {
  const { client, state } = fixture();
  for (const value of [true, false]) {
    state.records = [row({ exists: value })];
    assert.equal(await client.getGraph().has(), value);
  }
  for (const records of [[], [row({ exists: true }), row({ exists: false })], [row({ exists: 1 })], [row({ exists: 'true' })], [row({ wrong: false })]]) {
    state.records = records;
    await assert.rejects(client.getGraph().has(), /Neo4j has: invalid result/);
  }
});

test('count accepts safe native integers and rejects malformed/negative/unsafe values', async () => {
  const { client, state } = fixture();
  for (const value of [0, 42, Number.MAX_SAFE_INTEGER]) {
    state.records = [row({ count: neo4j.int(value) })];
    assert.equal(await client.getGraph().count(), value);
  }
  for (const value of [-1, 1.5, '1', null, {}, neo4j.int(-1), neo4j.int('9007199254740992'), neo4j.int('9223372036854775807')]) {
    state.records = [row({ count: value })];
    await assert.rejects(client.getGraph().count(), /Neo4j count: invalid result/);
  }
  for (const records of [[], [row({ wrong: 0 })], [row({ count: neo4j.int(0) }), row({ count: neo4j.int(1) })]]) {
    state.records = records;
    await assert.rejects(client.getGraph().count(), /invalid result/);
  }
  assert.equal(state.closed, state.sessions);
});

test('query failure takes precedence over cleanup failure; both remain redacted', async () => {
  const { client, state } = fixture();
  state.failure = Object.assign(new Error('secret query'), { code: 'Neo.ClientError.Statement.SyntaxError' });
  state.cleanupFailure = new Error('secret cleanup');
  await assert.rejects(client.getGraph().find(), { message: 'Neo4j query failed (Neo.ClientError.Statement.SyntaxError)' });
  await assert.rejects(client.getGraph().add('urn:s', 'urn:p', 'urn:o'), { message: 'Neo4j add failed (Neo.ClientError.Statement.SyntaxError)' });
  state.failure = null;
  await assert.rejects(client.getGraph().find(), { message: 'Neo4j query failed' });
  assert.equal(state.closed, state.sessions);
});

test('graph close and retained handles after client close fail before I/O', async () => {
  const { client, state } = fixture();
  const graph = client.getGraph();
  graph.close();
  await assert.rejects(graph.find(), /Graph is closed/);
  const retained = client.getGraph('retained');
  const closing = client.close();
  assert.throws(() => client.getGraph(), /Client is closed/);
  for (const method of ['add', 'remove', 'find', 'has', 'count', 'clear']) await assert.rejects(retained[method]('urn:s', 'urn:p', 'urn:o'), /Client is closed/);
  await closing;
  assert.equal(state.sessions, 0);
});
