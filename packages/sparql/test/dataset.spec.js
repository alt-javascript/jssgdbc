import assert from 'node:assert/strict';
import external from '@rdfjs/dataset';
import rdf from '@rdfjs/data-model';
import { factory } from '../../dataset/index.js';
import { DatasetSaveError } from '../../core/index.js';
import { SparqlClient } from '../SparqlClient.js';
import { startMockSparqlEndpoint } from './helpers/mock-sparql-endpoint.js';

const d = rdf.defaultGraph(), g = rdf.namedNode('urn:g'), h = rdf.namedNode('urn:h');
const s = rdf.namedNode('urn:s'), p = rdf.namedNode('urn:p');
const quad = (graph = d, object = rdf.literal('01', rdf.namedNode('urn:integer'))) => rdf.quad(s, p, object, graph);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

describe('SPARQL selected Dataset persistence', () => {
  let endpoint, client;
  beforeEach(async () => {
    endpoint = await startMockSparqlEndpoint();
    client = new SparqlClient(null, `jssgdbc:sparql:${endpoint.endpoint}`);
  });
  afterEach(async () => { await client.close(); await endpoint.close(); });

  it('round-trips independent input in single requests, deduplicates selections and isolates local edits', async () => {
    const input = external.dataset([quad(), quad(g, rdf.literal('hello', 'en')), quad(g, rdf.literal('1', rdf.namedNode('urn:integer')))]);
    const outcomes = await client.saveDataset(input, { graphs: [d, g, g] });
    assert.deepEqual(outcomes.map(o => o.status), ['committed', 'committed']);
    assert.equal(endpoint.requests.length, 1);
    const loaded = await client.loadDataset({ graphs: [d, g, g], factory: external });
    assert.equal(loaded.size, 3);
    for (const q of input) assert(loaded.has(q));
    loaded.delete([...loaded][0]);
    assert.equal(endpoint.requests.length, 2);
    assert.equal((await client.loadDataset({ graphs: [d, g], factory })).size, 3);
    await client.saveDataset(input, { graphs: [d, g] });
    assert.equal((await client.loadDataset({ graphs: [d, g], factory })).size, 3);
  });

  it('replaces selected graphs only, with one request, and handles empty merge/replace', async () => {
    await client.saveDataset([quad(), quad(g), quad(h)], { graphs: [d, g, h] });
    const count = endpoint.requests.length;
    await client.saveDataset([], { graphs: [d, g] });
    assert.equal(endpoint.requests.length, count);
    await client.saveDataset([quad(g, rdf.literal('replacement'))], { graphs: [d, g], mode: 'replace' });
    assert.equal(endpoint.requests.length, count + 1);
    const selected = await client.loadDataset({ graphs: [d, g], factory });
    assert.equal(selected.size, 1);
    assert.equal([...selected][0].object.value, 'replacement');
    await client.saveDataset([], { graphs: [d, g], mode: 'replace' });
    assert.equal((await client.loadDataset({ graphs: [d, g], factory })).size, 0);
    assert.equal(await client.getGraph(h).count(), 1);
    await client.saveDataset([], { graphs: [h], mode: 'replace' });
    assert.equal(await client.getGraph(h).count(), 0);
  });

  it('shares blanks across graphs per update/response but allocates fresh import and response scopes', async () => {
    const b = rdf.blankNode('caller');
    const input = external.dataset([rdf.quad(b, p, b), rdf.quad(s, p, b, g)]);
    await client.saveDataset(input, { graphs: [d, g] });
    assert.equal(endpoint.requests.length, 1);
    const first = await client.loadDataset({ graphs: [d, g], factory });
    assert(first.equals(input));
    const label = [...first][0].subject.value;
    assert.equal([...first][1].object.value, label);
    const second = await client.loadDataset({ graphs: [d, g], factory });
    assert(second.equals(first));
    assert.notEqual([...second][0].subject.value, label);
    await client.saveDataset(input, { graphs: [d, g] });
    const merged = await client.loadDataset({ graphs: [d, g], factory });
    assert.equal(merged.size, 4);
    assert.equal(new Set([...merged].map(q => q.object.value)).size, 2);
    await client.saveDataset(input, { graphs: [d, g], mode: 'replace' });
    assert((await client.loadDataset({ graphs: [d, g], factory })).equals(input));
    assert.equal(b.value, 'caller');
  });

  it('rejects invalid final input and options with zero HTTP writes', async () => {
    const bad = { termType: 'Quad', value: '', subject: s, predicate: p, object: 'bad', graph: d };
    for (const [input, options] of [
      [[quad(), bad], { graphs: [d], mode: 'replace' }],
      [[quad(g)], { graphs: [d] }], [[], { graphs: [] }],
      [[], { graphs: [rdf.blankNode('graph')] }], [[], { graphs: [d], mode: 'invalid' }]
    ]) await assert.rejects(client.saveDataset(input, options));
    const broken = { *[Symbol.iterator]() { yield quad(); throw Error('iterator'); } };
    await assert.rejects(client.saveDataset(broken, { graphs: [d] }), /iterator/);
    assert.equal(endpoint.requests.length, 0);
  });

  it('leaves selections not-attempted on transport preparation failure', async () => {
    client._endpoint = 'invalid-url';
    await assert.rejects(client.saveDataset([quad()], { graphs: [d, g] }), error => {
      assert(error instanceof DatasetSaveError);
      assert.deepEqual(error.outcomes.map(o => o.status), ['not-attempted', 'not-attempted']);
      return true;
    });
    assert.equal(endpoint.requests.length, 0);
  });

  it('reports all selections unknown after commit then dropped acknowledgement without retry', async () => {
    endpoint.dropNextUpdateResponse();
    await assert.rejects(client.saveDataset([quad(), quad(g)], { graphs: [d, g] }), error => {
      assert(error instanceof DatasetSaveError);
      assert.deepEqual(error.outcomes.map(o => o.status), ['unknown', 'unknown']);
      assert.equal(error.cause.message, 'SPARQL update: network failure');
      assert.equal(error.cause.cause, undefined);
      assert(Object.isFrozen(error.outcomes[0]));
      return true;
    });
    assert.equal(endpoint.requests.length, 1);
    assert.equal((await client.loadDataset({ graphs: [d, g], factory })).size, 2);
    await client.saveDataset([quad(h)], { graphs: [h] });
    assert.equal(endpoint.requests.filter(r => r.method === 'POST').length, 2);
  });

  it('validates malformed rows, graph provenance and selected graphs before calling the factory', async () => {
    const original = globalThis.fetch;
    const row = { s: { type: 'uri', value: 'urn:s' }, p: { type: 'uri', value: 'urn:p' }, o: { type: 'literal', value: 'x' }, g: { type: 'uri', value: 'urn:g' } };
    const result = rows => ({ head: { vars: ['s', 'p', 'o', 'g'] }, results: { bindings: rows } });
    let called = false;
    try {
      for (const response of [
        result([{ ...row, g: { type: 'uri', value: 'urn:unexpected' } }]),
        result([{ ...row, g: { type: 'bnode', value: 'b' } }]),
        result([{ ...row, g: { type: 'literal', value: 'urn:g' } }]),
        result([{ ...row, g: null }]), result([{ ...row, s: undefined }]),
        result([{ ...row, extra: row.s }]), result([{ s: row.s, p: row.p, o: row.o }]),
        { ...result([]), head: { vars: ['s', 'p', 'o'] } },
        { ...result([]), boolean: true }
      ]) {
        globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify(response) });
        await assert.rejects(client.loadDataset({ graphs: [g], factory: { dataset() { called = true; } } }), /invalid/);
      }
      assert.equal(called, false);
    } finally { globalThis.fetch = original; }
  });

  it('drains admitted queued saves/loads and response bodies through close after a rejected predecessor', async () => {
    const original = globalThis.fetch, gate = deferred(), entered = deferred();
    let calls = 0, released = false;
    globalThis.fetch = async (...args) => {
      if (++calls === 1) return { ok: true, async text() { entered.resolve(); await gate.promise; throw Error('private transport data'); } };
      return original(...args);
    };
    client._close = () => { released = true; };
    try {
      const failed = assert.rejects(client.saveDataset([quad()], { graphs: [d] }), e => e.outcomes[0].status === 'unknown');
      const input = [{ termType: 'Quad', value: '', subject: s, predicate: p, graph: g,
        object: { termType: 'Literal', value: 'before', language: '', datatype: rdf.namedNode('http://www.w3.org/2001/XMLSchema#string') } }];
      const saving = client.saveDataset(input, { graphs: [g] });
      const loading = client.loadDataset({ graphs: [g], factory });
      input[0].object.value = 'after';
      await entered.promise;
      const closing = client.close();
      assert.equal(client.close(), closing);
      await assert.rejects(client.saveDataset([], { graphs: [d] }), /closed/);
      await assert.rejects(client.loadDataset({ graphs: [d], factory }), /closed/);
      assert.equal(calls, 1);
      assert.equal(released, false);
      gate.resolve();
      await failed; await saving;
      const loaded = await loading;
      assert.equal([...loaded][0].object.value, 'before');
      await closing;
      assert.equal(calls, 3);
      assert.equal(released, true);
    } finally { gate.resolve(); globalThis.fetch = original; }
  });

  it('does not poison the queue when a caller DatasetFactory throws', async () => {
    const cause = Error('factory failed');
    await assert.rejects(client.loadDataset({ graphs: [d], factory: { dataset() { throw cause; } } }), e => e === cause);
    await client.saveDataset([quad()], { graphs: [d] });
    assert.equal((await client.loadDataset({ graphs: [d], factory })).size, 1);
  });

  for (const size of [1000, 10000]) it(`buffers ${size} quads in one save and load request`, async () => {
    const input = Array.from({ length: size }, (_, i) => quad(i % 2 ? g : d, rdf.literal(String(i))));
    const started = performance.now();
    await client.saveDataset(input, { graphs: [d, g] });
    const loaded = await client.loadDataset({ graphs: [d, g], factory: external });
    assert.equal(loaded.size, size);
    assert.equal(endpoint.requests.length, 2);
    console.log(`SPARQL dataset ${size}: ${Math.round(performance.now() - started)}ms; heapUsed=${process.memoryUsage().heapUsed}`);
  });

  it('publishes immutable versioned capabilities with conservative remote limitations', () => {
    const caps = client.getCapabilities();
    assert.equal(caps.version, 1);
    for (const key of ['rdf11', 'namedGraphs', 'defaultGraph']) assert.equal(caps.features[key].status, 'supported');
    for (const key of ['blankNodeGraphs', 'rdfStar', 'variables', 'transactions', 'streaming']) assert.equal(caps.features[key].status, 'unavailable');
    for (const key of ['persistence', 'crossGraphAtomicity']) assert.equal(caps.features[key].status, 'unknown');
    assert.match(caps.features.streaming.detail, /GET URL/);
    assert(Object.isFrozen(caps) && Object.isFrozen(caps.features));
    assert(Object.values(caps.features).every(Object.isFrozen));
  });
});
