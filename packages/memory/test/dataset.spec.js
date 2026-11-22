import assert from 'node:assert/strict';
import external from '@rdfjs/dataset';
import rdf from '@rdfjs/data-model';
import { factory } from '../../dataset/index.js';
import { MemoryClient } from '../MemoryClient.js';
import { DatasetSaveError, UnsupportedRdfFeatureError } from '../../core/index.js';

const d = rdf.defaultGraph(), g = rdf.namedNode('urn:g'), h = rdf.namedNode('urn:h');
const s = rdf.namedNode('urn:s'), p = rdf.namedNode('urn:p');
const quad = (graph = d, object = rdf.literal('01', rdf.namedNode('urn:integer'))) => rdf.quad(s, p, object, graph);
const malformed = changes => ({ termType: 'Quad', value: '', subject: s, predicate: p, object: rdf.literal('x'), graph: d, ...changes });
const client = () => new MemoryClient(null, 'jsgdbc:memory:', {});
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

describe('Explicit memory Dataset persistence', () => {
  it('round-trips independent Dataset input, preserves lexical terms and has no implicit writes', async () => {
    const c = client();
    const input = external.dataset([quad(), quad(g, rdf.literal('hello', 'en')), quad(g, rdf.literal('1', rdf.namedNode('urn:integer')))]);
    const outcomes = await c.saveDataset(input, { graphs: [d, g, rdf.namedNode('urn:g')] });
    assert.deepEqual(outcomes.map(o => o.status), ['committed', 'committed']);
    assert(Object.isFrozen(outcomes) && Object.isFrozen(outcomes[0]));
    const loaded = await c.loadDataset({ graphs: [d, g], factory });
    assert(loaded.equals(input));
    loaded.deleteMatches();
    assert.equal((await c.loadDataset({ graphs: [d, g], factory })).size, 3);
    await c.saveDataset(input, { graphs: [d, g] });
    assert.equal((await c.loadDataset({ graphs: [d, g], factory })).size, 3);
    assert.equal(input.size, 3);
    await c.close();
  });

  it('replaces empty selected graphs, preserves unrelated graphs and live handles', async () => {
    const c = client();
    const handle = c.getGraph(g);
    await c.saveDataset([quad(), quad(g), quad(h)], { graphs: [d, g, h] });
    await c.saveDataset([], { graphs: [d, g], mode: 'replace' });
    assert.equal(await handle.count(), 0);
    assert.equal(await c.getGraph(h).count(), 1);
    await c.saveDataset([quad(g)], { graphs: [g], mode: 'replace' });
    assert.equal(await handle.count(), 1);
    await handle.close();
    assert.equal(await c.getGraph(g).count(), 1);
    await c.close();
  });

  it('allocates fresh blanks across saves, shares within graphs, and avoids existing labels', async () => {
    const c = client();
    await c.getGraph(h).add(rdf.blankNode('jsgdbc-save-1'), p, s);
    const b = rdf.blankNode('input');
    const input = external.dataset([rdf.quad(b, p, b), rdf.quad(s, p, b, g)]);
    await c.saveDataset(input, { graphs: [d, g] });
    const first = await c.loadDataset({ graphs: [d, g], factory });
    assert(first.equals(input));
    const label = [...first][0].subject.value;
    assert.notEqual(label, 'jsgdbc-save-1');
    assert.notEqual(label, 'input');
    assert.equal([...first][1].object.value, label);
    await c.saveDataset(input, { graphs: [d, g] });
    const merged = await c.loadDataset({ graphs: [d, g], factory });
    assert.equal(merged.size, 4);
    assert.equal(new Set([...merged].map(q => q.object.value)).size, 2);
    await c.saveDataset(input, { graphs: [d, g], mode: 'replace' });
    assert((await c.loadDataset({ graphs: [d, g], factory })).equals(input));
    assert.equal([...input][0].subject.value, 'input');
    await c.close();
  });

  it('snapshots pending input, selections, mode and factory method before close drains', async () => {
    const gate = deferred(), entered = deferred();
    class Delayed extends MemoryClient {
      async _saveDatasetGraph(...args) { entered.resolve(); await gate.promise; return super._saveDatasetGraph(...args); }
      _close() { this.released = true; }
    }
    const c = new Delayed();
    const graph = { termType: 'NamedNode', value: 'urn:g' };
    const object = { termType: 'Literal', value: 'before', language: '', datatype: { termType: 'NamedNode', value: 'urn:type' } };
    const input = [{ termType: 'Quad', value: '', subject: s, predicate: p, object, graph }];
    const options = { graphs: [graph], mode: 'replace' };
    const save = c.saveDataset(input, options);
    const localFactory = { dataset: factory.dataset };
    const load = c.loadDataset({ graphs: [graph], factory: localFactory });
    object.value = 'after'; object.datatype.value = 'urn:changed'; graph.value = 'urn:changed';
    input.length = 0; options.graphs.length = 0; options.mode = 'invalid'; localFactory.dataset = () => { throw Error('mutated'); };
    await entered.promise;
    const closing = c.close();
    assert.equal(c.close(), closing);
    assert.equal(c.released, undefined);
    await assert.rejects(c.saveDataset([], { graphs: [d] }), /closed/);
    await assert.rejects(c.loadDataset({ graphs: [d], factory }), /closed/);
    gate.resolve();
    await save;
    const loaded = await load;
    assert.equal([...loaded][0].object.value, 'before');
    assert.equal([...loaded][0].object.datatype.value, 'urn:type');
    assert.equal([...loaded][0].graph.value, 'urn:g');
    await closing;
    assert.equal(c.released, true);
  });

  it('preflights entire input and selections without writes', async () => {
    const c = client();
    await c.saveDataset([quad()], { graphs: [d] });
    const invalid = [
      [[], {}], [[], { graphs: [] }], [[], { graphs: ['urn:g'] }],
      [[], { graphs: [d], mode: 'append' }], [null, { graphs: [d] }],
      [[quad(), malformed({ object: 'bad' })], { graphs: [d], mode: 'replace' }],
      [[quad(g)], { graphs: [d] }], [[malformed({ graph: undefined })], { graphs: [d] }],
      [[malformed({ value: 'bad' })], { graphs: [d] }]
    ];
    for (const [input, options] of invalid) await assert.rejects(c.saveDataset(input, options), TypeError);
    await assert.rejects(c.saveDataset([], { graphs: [d, rdf.blankNode('g')] }), UnsupportedRdfFeatureError);
    await assert.rejects(c.saveDataset([malformed({ object: rdf.variable('x') })], { graphs: [d] }), UnsupportedRdfFeatureError);
    const cause = Error('iterator failed');
    const broken = { *[Symbol.iterator]() { yield quad(); throw cause; } };
    await assert.rejects(c.saveDataset(broken, { graphs: [d], mode: 'replace' }), e => e === cause);
    await assert.rejects(c.loadDataset({ graphs: [d] }), TypeError);
    await assert.rejects(c.loadDataset({ graphs: [], factory }), TypeError);
    assert.equal(await c.getGraph().count(), 1);
    await c.close();
  });

  it('reports committed/unknown/not-attempted, retains cause, and drains failures', async () => {
    const cause = Error('lost acknowledgement');
    class Failing extends MemoryClient {
      _saveDatasetGraph(graph, quads, mode) {
        super._saveDatasetGraph(graph, quads, mode);
        if (graph.equals(g)) throw cause;
      }
      _close() { this.released = true; }
    }
    const c = new Failing();
    await assert.rejects(c.saveDataset([quad(), quad(g), quad(h)], { graphs: [d, g, h] }), error => {
      assert(error instanceof DatasetSaveError);
      assert.equal(error.cause, cause);
      assert.deepEqual(error.outcomes.map(o => o.status), ['committed', 'unknown', 'not-attempted']);
      assert(Object.isFrozen(error.outcomes[1]));
      return true;
    });
    assert.equal(await c.getGraph(g).count(), 1);
    assert.equal(await c.getGraph(h).count(), 0);
    await c.saveDataset([], { graphs: [d] }); // rejected queue entry does not poison next entry
    await c.close();
    assert.equal(c.released, true);
  });

  it('bubbles load/factory failures without poisoning the queue', async () => {
    const c = client(), cause = Error('factory failed');
    await assert.rejects(c.loadDataset({ graphs: [d], factory: { dataset() { throw cause; } } }), e => e === cause);
    c._loadDatasetGraph = () => [quad(g)];
    await assert.rejects(c.loadDataset({ graphs: [d], factory }), /unselected/);
    c._loadDatasetGraph = () => { throw cause; };
    await assert.rejects(c.loadDataset({ graphs: [d], factory }), e => e === cause);
    await c.close();
  });

  for (const size of [1000, 10000]) it(`buffers and deduplicates ${size} quads`, async () => {
    const c = client();
    const input = Array.from({ length: size }, (_, i) => quad(i % 2 ? g : d, rdf.literal(String(i))));
    const started = performance.now();
    await c.saveDataset(input, { graphs: [d, g] });
    await c.saveDataset(input, { graphs: [d, g] });
    assert.equal((await c.loadDataset({ graphs: [d, g], factory })).size, size);
    console.log(`dataset persistence ${size}: ${Math.round(performance.now() - started)}ms; heapUsed=${process.memoryUsage().heapUsed}`);
    await c.close();
  });
});
