import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import rdf from '@rdfjs/data-model';
import external from '@rdfjs/dataset';
import { factory } from '../../dataset/index.js';
import { datasetCompliance } from '../../core/test/datasetCompliance.js';
import { DatasetSaveError } from '../../core/index.js';
import { FileClient } from '../FileClient.js';
import { FileStorage } from '../FileStorage.js';

const d = rdf.defaultGraph(), g = rdf.namedNode('urn:g'), h = rdf.namedNode('urn:h');
const unrelated = rdf.namedNode('urn:unrelated'), s = rdf.namedNode('urn:s'), p = rdf.namedNode('urn:p');
const q = (graph = d, object = rdf.literal('value')) => rdf.quad(s, p, object, graph);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

describe('file explicit Dataset persistence', () => {
  let root, client;
  const open = () => new FileClient(null, `jssgdbc:file:${root}`, {}, new FileStorage(root));
  beforeEach(async () => { root = await fs.mkdtemp(path.resolve('.file-dataset-test-')); client = open(); });
  afterEach(async () => { await client.close(); await fs.rm(root, { recursive: true, force: true }); });

  it('passes independent-factory Dataset compliance', async () => {
    await datasetCompliance(client, rdf, external, factory);
  });

  it('persists shared blanks and lexical forms across immediate close/reopen and freshens later imports', async () => {
    const b = rdf.blankNode('shared'), integer = rdf.namedNode('http://www.w3.org/2001/XMLSchema#integer');
    const input = external.dataset([rdf.quad(b, p, b, d), rdf.quad(b, p, rdf.literal('hello', 'en'), g),
      rdf.quad(s, p, b, h), q(d, rdf.literal('01', integer)), q(d, rdf.literal('1', integer))]);
    await client.getGraph(unrelated).add(b, p, s);
    const saving = client.saveDataset(input, { graphs: [d, g, h] });
    await Promise.all([saving, client.close()]);
    client = open();
    const loaded = await client.loadDataset({ graphs: [d, g, h], factory });
    assert(loaded.equals(input));
    const labels = [...loaded].flatMap(row => [row.subject, row.object]).filter(t => t.termType === 'BlankNode').map(t => t.value);
    assert.equal(new Set(labels).size, 1);
    assert.notEqual(labels[0], b.value);
    assert(await client.getGraph(unrelated).has(b, p, s));
    loaded.deleteMatches();
    assert.equal((await client.loadDataset({ graphs: [d, g, h], factory })).size, 5);
    await client.saveDataset(input, { graphs: [d, g, h] });
    const merged = await client.loadDataset({ graphs: [d, g, h], factory });
    assert.equal(merged.size, 8);
    assert.equal(new Set([...merged].filter(row => row.subject.termType === 'BlankNode').map(row => row.subject.value)).size, 2);
    // Direct Graph access deliberately retains the persisted label, unlike imports.
    await client.getGraph(d).add(rdf.blankNode(labels[0]), p, rdf.blankNode(labels[0]));
    assert.equal(await client.getGraph(d).count(), 4);
    assert.equal([...input][0].subject.value, 'shared');
  });

  it('rejects late malformed and unselected input before any filesystem or metadata operation', async () => {
    let reads = 0, writes = 0;
    client._storage.read = async () => { reads++; throw Error('unexpected read'); };
    client._storage.write = async () => { writes++; throw Error('unexpected write'); };
    for (const input of [[q(), { ...q(), object: 'bad' }], [q(), q(g)]]) {
      await assert.rejects(client.saveDataset(input, { graphs: [d], mode: 'replace' }), TypeError);
    }
    const cause = Error('iterator failure');
    await assert.rejects(client.saveDataset({ *[Symbol.iterator]() { yield q(); throw cause; } }, { graphs: [d] }), e => e === cause);
    assert.equal(reads, 0); assert.equal(writes, 0);
    assert.deepEqual(await fs.readdir(root), []);
  });

  for (const afterCommit of [false, true]) it(`reports middle-graph ${afterCommit ? 'post' : 'pre'}-commit failure without retry and reconciles`, async () => {
    await client.saveDataset([q(d), q(g), q(h), q(unrelated)], { graphs: [d, g, h, unrelated] });
    const storage = client._storage, write = storage.write.bind(storage), cause = Error('injected middle failure');
    const calls = [];
    storage.write = async (graph, text) => {
      calls.push(graph.value);
      if (graph.equals(g)) { if (afterCommit) await write(graph, text); throw cause; }
      return write(graph, text);
    };
    await assert.rejects(client.saveDataset([q(d, rdf.literal('new')), q(g, rdf.literal('new')), q(h, rdf.literal('new'))],
      { graphs: [d, g, h], mode: 'replace' }), error => {
      assert(error instanceof DatasetSaveError); assert.equal(error.cause, cause);
      assert.deepEqual(error.outcomes.map(o => o.status), ['committed', 'unknown', 'not-attempted']);
      return true;
    });
    assert.deepEqual(calls, ['', 'urn:g']);
    storage.write = write;
    assert(await client.getGraph(d).has(s, p, rdf.literal('new')));
    assert.equal(await client.getGraph(g).has(s, p, rdf.literal('new')), afterCommit);
    assert(await client.getGraph(h).has(s, p, rdf.literal('value')));
    assert(await client.getGraph(unrelated).has(s, p, rdf.literal('value')));
    await client.saveDataset([], { graphs: [d], mode: 'replace' });
    assert.equal(await client.getGraph(d).count(), 0);
  });

  it('serializes Graph/Dataset overlap without resurrecting replacement and drains queued I/O on close', async () => {
    const graph = client.getGraph(d), entered = deferred(), release = deferred();
    const storage = client._storage, write = storage.write.bind(storage); let calls = 0;
    storage.write = async (...args) => { if (++calls === 1) { entered.resolve(); await release.promise; } return write(...args); };
    const first = graph.add(s, p, rdf.literal('old'));
    await entered.promise;
    const saving = client.saveDataset([q(d, rdf.literal('replacement')), q(g)], { graphs: [d, g], mode: 'replace' });
    const loading = client.loadDataset({ graphs: [d, g], factory });
    let closed = false;
    const closing = client.close().then(() => { closed = true; });
    try {
      await assert.rejects(client.saveDataset([], { graphs: [d] }), /closed/);
      assert.equal(closed, false);
    } finally { release.resolve(); }
    await Promise.all([first, saving, closing]);
    assert.equal((await loading).size, 2);
    client = open();
    assert.equal(await client.getGraph(d).count(), 1);
    assert.equal(await client.getGraph(d).has(s, p, rdf.literal('old')), false);
    await client.getGraph(d).add(s, p, rdf.literal('later'));
    assert.equal((await client.loadDataset({ graphs: [d], factory })).size, 2);
  });

  it('exposes deeply immutable truthful capabilities', () => {
    const caps = client.getCapabilities();
    assert.equal(caps.version, 1); assert(Object.isFrozen(caps)); assert(Object.isFrozen(caps.features));
    for (const value of Object.values(caps.features)) assert(Object.isFrozen(value));
    for (const key of ['rdf11', 'namedGraphs', 'defaultGraph', 'persistence']) assert.equal(caps.features[key].status, 'supported');
    for (const key of ['transactions', 'crossGraphAtomicity', 'streaming']) assert.equal(caps.features[key].status, 'unavailable');
    assert.match(caps.features.rdf11.detail, /each save freshens blank nodes/);
    assert.match(caps.features.persistence.detail, /no fsync or multiwriter isolation/);
  });
});
