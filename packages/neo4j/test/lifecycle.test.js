import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Neo4jClient, transportError } from '../Neo4jClient.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const methods = ['add', 'remove', 'find', 'has', 'count', 'clear'];
import { defaultGraph } from '@alt-javascript/jssgdbc-core';
import { encodeTerm } from '../RdfStorage.js';
const nn = value => ({ termType: 'NamedNode', value });
const triple = ['urn:s', 'urn:p', 'urn:o'].map(nn);
function fixture() {
  const events = [], data = new Map();
  const state = { events, data, gate: null, cleanupGate: null, fail: false, driverFail: false };
  const native = {
    session() {
      events.push('session');
      const execute = work => work({ run: async (query, params) => {
        events.push('run');
        if (state.gate) await state.gate.promise;
        if (state.fail) throw new Error('secret query password');
        if (query.includes('MERGE (o:')) data.set(params.graph, triple);
        const row = { subject: { ...encodeTerm(triple[0]), graph: params.graph }, predicate: 'urn:p', object: { ...encodeTerm(triple[2]), graph: params.graph } };
        return { records: data.has(params.graph) ? [{ keys: Object.keys(row), get: key => row[key] }] : [] };
      } });
      return { executeRead: execute, executeWrite: execute, async close() {
        events.push('session closing');
        if (state.cleanupGate) await state.cleanupGate.promise;
        events.push('session closed');
        if (state.fail) throw new Error('secret cleanup password');
      } };
    },
    async close() { events.push('driver closed'); if (state.driverFail) throw new Error('secret driver password'); }
  };
  state.client = new Neo4jClient(null, 'jssgdbc:neo4j:bolt://localhost', { timeoutMs: 1000 }, native);
  return state;
}
async function rejected(graph) {
  for (const method of methods) await assert.rejects(graph[method](...triple), /closed/);
}

test('lifecycle default/named reacquisition and detached cursors', async () => {
  const f = fixture(), client = f.client;
  try {
    for (const name of [defaultGraph(), nn('urn:named')]) {
      const old = client.getGraph(name);
      await old.add(...triple);
      const cursor = await old.find();
      const closing = old.close();
      assert.equal(closing, old.close());
      await closing;
      await rejected(old);
      const fresh = client.getGraph(name);
      assert.notEqual(fresh, old);
      assert.deepEqual((await fresh.find()).getTriples(), cursor.getTriples());
      assert.equal(cursor.getTriples().length, 1);
      await client.getGraph(name).close();
      assert.equal(await cursor.next(), true);
      cursor.close();
    }
    const owned = [client.getGraph(), client.getGraph(nn('urn:named'))];
    await client.close();
    for (const graph of owned) await rejected(graph);
    assert.throws(() => client.getGraph(), /closed/);
    assert.equal(f.events.filter(e => e === 'driver closed').length, 1);
  } finally { await client.close(); }
});

test('lifecycle drains transaction continuation and session cleanup before native release', async () => {
  const f = fixture(), graph = f.client.getGraph();
  f.gate = deferred(); f.cleanupGate = deferred();
  const operation = graph.add(...triple);
  const closing = f.client.close();
  assert.equal(closing, f.client.close());
  await rejected(graph);
  assert.equal(f.events.includes('driver closed'), false);
  f.gate.resolve();
  await new Promise(r => setImmediate(r));
  assert.equal(f.events.filter(e => e === 'run').length, 2);
  assert.equal(f.events.includes('driver closed'), false);
  f.cleanupGate.resolve();
  await operation; await closing;
  assert.deepEqual(f.events.slice(-2), ['session closed', 'driver closed']);
  assert.equal(f.events.filter(e => e === 'session closed').length, 1);
  assert.equal(graph._activeOperations.size, 0);
});

test('lifecycle drains admitted direct queries without graph ownership', async () => {
  const f = fixture(); f.gate = deferred(); f.cleanupGate = deferred();
  const operation = f.client._query('RETURN 1');
  const closing = f.client.close();
  await assert.rejects(f.client._query('RETURN 2'), /closed/);
  f.gate.resolve();
  await new Promise(r => setImmediate(r));
  assert.equal(f.events.includes('driver closed'), false);
  f.cleanupGate.resolve();
  await Promise.all([operation, closing]);
  assert.deepEqual(f.events.slice(-2), ['session closed', 'driver closed']);
  assert.equal(f.client._operations.size, 0);
});

test('lifecycle preserves sanitized operation and session failures while draining', async () => {
  const f = fixture(); f.fail = true; f.gate = deferred();
  const operation = f.client.getGraph().find();
  const failure = assert.rejects(operation, error => {
    assert.equal(error.errors.length, 2);
    for (const child of error.errors) {
      assert.doesNotMatch(child.stack, /secret|password/);
      assert.equal(child.cause, undefined);
    }
    return true;
  });
  const closing = f.client.close();
  f.gate.resolve();
  await failure; await closing;
  assert.deepEqual(f.events.slice(-2), ['session closed', 'driver closed']);
});

test('lifecycle attempts all owned cleanups and repeats original aggregate failure', async () => {
  const f = fixture(); f.driverFail = true;
  const gate = deferred();
  const first = f.client.getGraph(), second = f.client.getGraph(nn('urn:named'));
  first._close = async () => { await gate.promise; throw transportError('graph close', new Error('secret')); };
  second._close = () => { throw transportError('graph close', new Error('secret')); };
  const firstClose = first.close();
  const firstFailure = assert.rejects(firstClose);
  const closing = f.client.close();
  let original;
  const failure = assert.rejects(closing, error => { original = error; assert.equal(error.errors.length, 3); return true; });
  gate.resolve();
  await Promise.all([firstFailure, failure]);
  assert.equal(f.client.close(), closing);
  await assert.rejects(closing, error => error === original);
  assert.equal(f.events.filter(e => e === 'driver closed').length, 1);
  assert.equal(f.client._ownedGraphs.size, 0);
});
