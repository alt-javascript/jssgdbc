import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Neo4jClient } from '../Neo4jClient.js';
import { defaultGraph, createQuad } from '@alt-javascript/jssgdbc-core';
import { encodeTerm, graphKey } from '../RdfStorage.js';
const nn = value => ({ termType: 'NamedNode', value });
const dg = defaultGraph(), ng = nn('urn:named'), third = nn('urn:third');
const blank = { termType: 'BlankNode', value: 'shared' }, p = nn('urn:p');
const quad = (graph = dg) => createQuad(blank, p, nn('urn:o'), graph);
const factory = { dataset: quads => [...quads] };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  const state = { transactions: [], events: [], rows: [], retry: false, failAt: -1, closeFailAt: -1, gate: null };
  const native = {
    session() {
      let id;
      const execute = async work => {
        id = state.transactions.length;
        const runs = []; state.transactions.push(runs);
        const tx = { run: async (query, params) => {
          if (state.gate) await state.gate.promise;
          runs.push({ query, params });
          return { records: state.rows };
        } };
        if (state.retry) await work(tx);
        const result = await work(tx);
        state.events.push(`committed ${id}`);
        if (id === state.failAt) throw new Error('secret lost acknowledgement');
        return result;
      };
      return { executeWrite: execute, executeRead: execute, async close() {
        state.events.push(`closed ${id}`);
        if (state.cleanupGate) await state.cleanupGate.promise;
        if (id === state.closeFailAt) throw new Error('secret session close');
      } };
    },
    async close() { state.events.push('native closed'); }
  };
  state.client = new Neo4jClient(null, 'jssgdbc:neo4j:bolt://localhost', { timeoutMs: 1000 }, native);
  return state;
}

test('one blank scope across graph transactions, fixed retry parameters, fresh subsequent saves', async () => {
  const f = fixture(); f.retry = true;
  const outcomes = await f.client.saveDataset([quad(), quad(ng)], { graphs: [dg, ng], mode: 'replace' });
  assert.deepEqual(outcomes.map(o => o.status), ['committed', 'committed']);
  const [a, b] = f.transactions;
  assert.equal(a.length, 6);
  assert.match(a[0].query, /MERGE \(g:/);
  assert.match(a[1].query, /DELETE r/);
  assert.match(a[2].query, /MERGE \(s:/);
  assert.equal(a[2].params, a[5].params);
  assert.equal(a[2].params.subject.value, b[2].params.subject.value);
  assert.notEqual(a[2].params.graph, b[2].params.graph);
  assert.notEqual(a[2].params.subject.value, blank.value);
  await f.client.saveDataset([quad()], { graphs: [dg] });
  assert.notEqual(f.transactions[2][1].params.subject.value, a[2].params.subject.value);
  assert.equal(f.transactions[2].length, 4); // merge: lock + insert, twice
  await f.client.close();
});

test('empty replacement still locks and clears inside one transaction', async () => {
  const f = fixture();
  await f.client.saveDataset([], { graphs: [ng], mode: 'replace' });
  assert.equal(f.transactions.length, 1);
  assert.equal(f.transactions[0].length, 2);
  assert.match(f.transactions[0][0].query, /MERGE \(g:/);
  assert.match(f.transactions[0][1].query, /DELETE r/);
  await f.client.close();
});

for (const failure of ['failAt', 'closeFailAt']) test(`${failure} retains committed/unknown/not-attempted graph outcomes`, async () => {
  const f = fixture(); f[failure] = 1;
  await assert.rejects(f.client.saveDataset([quad(), quad(ng)], { graphs: [dg, ng, third] }), error => {
    assert.equal(error.name, 'DatasetSaveError');
    assert.deepEqual(error.outcomes.map(o => o.status), ['committed', 'unknown', 'not-attempted']);
    assert.doesNotMatch(error.cause.stack, /secret|acknowledgement/);
    return true;
  });
  assert.equal(f.transactions.length, 2);
  assert.ok(f.events.includes('committed 1')); // rejection is NOT evidence of rollback
  await f.client.close();
});

test('all input is preflighted before any session allocation', async () => {
  const f = fixture();
  for (const dataset of [[quad(), {}], [quad(), quad(ng)], [quad(), { ...quad(), predicate: blank }]]) {
    await assert.rejects(f.client.saveDataset(dataset, { graphs: [dg] }));
  }
  for (const graphs of [undefined, [], ['urn:named'], [blank], [null]]) {
    await assert.rejects(f.client.saveDataset([], { graphs }));
    await assert.rejects(f.client.loadDataset({ graphs, factory }));
  }
  await assert.rejects(f.client.saveDataset([], { graphs: [dg], mode: 'invalid' }));
  assert.equal(f.transactions.length, 0);
  await f.client.close();
});

test('buffered Dataset load strictly decodes structural records and persistent blank identity', async () => {
  const f = fixture();
  const values = { subject: { ...encodeTerm(blank), graph: graphKey(dg) }, predicate: p.value,
    object: { ...encodeTerm(nn('urn:o')), graph: graphKey(dg) } };
  f.rows = [{ keys: Object.keys(values), get: key => values[key] }];
  const loaded = await f.client.loadDataset({ graphs: [dg], factory });
  assert.deepEqual(loaded, [quad()]);
  values.subject.key = 'corrupt secret';
  await assert.rejects(f.client.loadDataset({ graphs: [dg], factory }), /Neo4j load Dataset failed/);
  f.rows = [{ keys: [], get: () => null }];
  await assert.rejects(f.client.loadDataset({ graphs: [dg], factory }));
  f.rows = null;
  await assert.rejects(f.client.loadDataset({ graphs: [dg], factory }));
  await f.client.close();
});

test('close drains queued save and load plus session cleanup while rejecting new admissions', async () => {
  const f = fixture(); f.gate = deferred(); f.cleanupGate = deferred();
  const first = f.client.saveDataset([quad()], { graphs: [dg] });
  const second = f.client.saveDataset([], { graphs: [ng], mode: 'replace' });
  const load = f.client.loadDataset({ graphs: [dg], factory });
  const closing = f.client.close();
  assert.equal(closing, f.client.close());
  await assert.rejects(f.client.saveDataset([], { graphs: [dg] }), /closed/);
  await assert.rejects(f.client.loadDataset({ graphs: [dg], factory }), /closed/);
  await assert.rejects(f.client._query('RETURN 1'), /closed/);
  f.gate.resolve();
  await new Promise(r => setImmediate(r));
  assert.equal(f.events.includes('native closed'), false);
  f.cleanupGate.resolve();
  await Promise.all([first, second, load, closing]);
  assert.equal(f.transactions.length, 3);
  assert.equal(f.events.at(-1), 'native closed');
  assert.equal(f.client._operations.size, 0);
});

test('capabilities are deeply immutable and do not promise streaming or whole-save atomicity', async () => {
  const f = fixture(), caps = f.client.getCapabilities();
  assert.equal(caps.version, 1);
  assert.ok(Object.isFrozen(caps) && Object.isFrozen(caps.features));
  for (const value of Object.values(caps.features)) assert.ok(Object.isFrozen(value));
  assert.equal(caps.features.persistence.status, 'supported');
  assert.equal(caps.features.transactions.status, 'supported');
  assert.equal(caps.features.crossGraphAtomicity.status, 'unavailable');
  assert.equal(caps.features.streaming.status, 'unavailable');
  await f.client.close();
});
