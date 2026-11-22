import assert from 'node:assert/strict';
import { Client, DatasetSaveError, UnsupportedOperationError, defaultGraph, createQuad } from '../index.js';

const graph = defaultGraph();
const factory = { dataset: quads => quads };
const named = value => ({ termType: 'NamedNode', value });
const g = named('urn:g'), h = named('urn:h');
const quad = (target = graph) => createQuad(named('urn:s'), named('urn:p'), named('urn:o'), target);
class BatchAdapter extends Client {
  _scopeDataset(quads) { this.scopes = (this.scopes ?? 0) + 1; return quads; }
  _saveDatasetGraph() { assert.fail('must use batch save'); }
  _loadDatasetGraph() { assert.fail('must use batch load'); }
}
describe('Core Dataset adapter hooks', () => {
  it('passes one immutable selected snapshot to batch hooks and drains admitted work', async () => {
    const events = [];
    let received, selected;
    class Adapter extends BatchAdapter {
      _saveSelectedDataset(graphs, quads, mode, progress) {
        assert(this.isClosed());
        assert.equal(mode, 'replace');
        assert(Object.isFrozen(graphs) && Object.isFrozen(quads) && Object.isFrozen(progress));
        selected = graphs; received = quads;
        progress.dispatched(); events.push('save');
      }
      _loadSelectedDataset(graphs) {
        assert(this.isClosed());
        assert.deepEqual(graphs, selected);
        events.push('load'); return received;
      }
      _close() { events.push('release'); }
    }
    const c = new Adapter();
    const target = named('urn:g');
    const input = [{ ...quad(target), object: named('urn:before') }];
    const graphs = [graph, target, named('urn:g')];
    const save = c.saveDataset(input, { graphs, mode: 'replace' });
    const load = c.loadDataset({ graphs, factory });
    input[0].object.value = 'urn:after'; input.length = 0; graphs.length = 0; target.value = 'urn:changed';
    const closing = c.close();
    await assert.rejects(c.saveDataset([], { graphs: [graph] }), /closed/);
    await assert.rejects(c.loadDataset({ graphs: [graph], factory }), /closed/);
    assert.deepEqual((await save).map(o => o.status), ['committed', 'committed']);
    assert.equal((await load)[0].object.value, 'urn:before');
    assert.equal(received[0].graph.value, 'urn:g');
    assert.equal(c.scopes, 1);
    await closing;
    assert.deepEqual(events, ['save', 'load', 'release']);
  });

  it('tracks batch pre-dispatch, uncertain dispatch and partial acknowledgement without retry', async () => {
    const cause = Error('sanitized transport failure');
    for (const stage of ['prepare', 'dispatch', 'partial']) {
      let calls = 0, retained;
      class Adapter extends BatchAdapter {
        _saveSelectedDataset(graphs, quads, mode, progress) {
          calls++; retained = progress;
          if (calls > 1) return;
          if (stage !== 'prepare') progress.dispatched();
          if (stage === 'partial') progress.committed([graphs[0]]);
          throw cause;
        }
      }
      const c = new Adapter();
      await assert.rejects(c.saveDataset([quad()], { graphs: [graph, g] }), error => {
        assert(error instanceof DatasetSaveError);
        assert.equal(error.cause, cause);
        const expected = stage === 'prepare' ? ['not-attempted', 'not-attempted']
          : stage === 'dispatch' ? ['unknown', 'unknown'] : ['committed', 'unknown'];
        assert.deepEqual(error.outcomes.map(o => o.status), expected);
        assert(Object.isFrozen(error.outcomes) && Object.isFrozen(error.outcomes[0]));
        return true;
      });
      assert.equal(calls, 1);
      assert.throws(() => retained.dispatched(), /no longer active/);
      await c.saveDataset([], { graphs: [graph] });
      assert.equal(calls, 2);
      await c.close();
    }
  });

  it('validates final input before batch admission and all returned quads before factory invocation', async () => {
    let calls = 0, factoryCalls = 0;
    class Adapter extends BatchAdapter {
      _saveSelectedDataset() { calls++; }
      _loadSelectedDataset() { return this.result; }
    }
    const c = new Adapter();
    await assert.rejects(c.saveDataset([quad(), { ...quad(), object: 'bad' }], { graphs: [graph] }), TypeError);
    await assert.rejects(c.saveDataset([], { graphs: [] }), TypeError);
    await assert.rejects(c.loadDataset({ graphs: [], factory }), TypeError);
    assert.equal(calls, 0);
    assert.equal(c.scopes, undefined);
    const checkedFactory = { dataset(quads) { factoryCalls++; return quads; } };
    for (const bad of [{ ...quad(), object: 'bad' }, { ...quad(), value: 'bad' }, quad(h)]) {
      c.result = [quad(), bad];
      await assert.rejects(c.loadDataset({ graphs: [graph, g], factory: checkedFactory }), TypeError);
    }
    assert.equal(factoryCalls, 0);
    c.result = [quad(), quad(g)];
    assert.equal((await c.loadDataset({ graphs: [graph, g], factory: checkedFactory })).length, 2);
    await c.close();
  });

  it('passes empty merge and replacement selections to batch and fallback hooks', async () => {
    for (const batch of [false, true]) {
      const seen = [];
      class Adapter extends Client {
        _scopeDataset(quads) { return quads; }
        _saveDatasetGraph(graph, quads, mode) { seen.push({ graphs: [graph], quads, mode }); }
      }
      const c = new Adapter();
      if (batch) c._saveSelectedDataset = (graphs, quads, mode) => { seen.push({ graphs, quads, mode }); };
      for (const mode of ['merge', 'replace']) {
        const outcomes = await c.saveDataset([], { graphs: [graph, g, g], mode });
        assert.deepEqual(outcomes.map(o => o.status), ['committed', 'committed']);
      }
      assert.equal(seen.length, batch ? 2 : 4);
      assert(seen.every(call => call.quads.length === 0));
      assert.deepEqual(seen.map(call => call.mode), batch ? ['merge', 'replace'] : ['merge', 'merge', 'replace', 'replace']);
      await c.close();
    }
  });

  it('preserves fallback partial outcomes even when the adapter throws DatasetSaveError', async () => {
    const cause = new DatasetSaveError('adapter detail', Error('lost response'), []);
    class Adapter extends Client {
      _scopeDataset(quads) { return quads; }
      _saveDatasetGraph(target) { if (target.value === g.value) throw cause; }
      _loadDatasetGraph() { return [quad(g)]; }
    }
    const c = new Adapter();
    await assert.rejects(c.saveDataset([], { graphs: [graph, g, h] }), error => {
      assert.equal(error.cause, cause);
      assert.deepEqual(error.outcomes.map(o => o.status), ['committed', 'unknown', 'not-attempted']);
      return true;
    });
    // Fallback must check the specific graph, not merely membership in all selections.
    await assert.rejects(c.loadDataset({ graphs: [graph, g], factory }), /unselected/);
    await c.close();
  });

  it('rejects invalid scoped output and unselected progress before changing outcomes', async () => {
    let calls = 0;
    class Adapter extends BatchAdapter {
      _saveSelectedDataset(graphs, quads, mode, progress) {
        calls++;
        progress.dispatched([graphs[0], h]);
      }
    }
    const c = new Adapter();
    for (const scoped of [[quad(), quad(h)], [quad(), { ...quad(), object: 'bad' }]]) {
      c._scopeDataset = () => scoped;
      await assert.rejects(c.saveDataset([quad()], { graphs: [graph, g] }), error => {
        assert(error.cause instanceof TypeError);
        assert.deepEqual(error.outcomes.map(o => o.status), ['not-attempted', 'not-attempted']);
        return true;
      });
    }
    assert.equal(calls, 0);
    c._scopeDataset = quads => quads;
    await assert.rejects(c.saveDataset([], { graphs: [graph, g] }), error => {
      assert.match(error.cause.message, /unselected/);
      assert.deepEqual(error.outcomes.map(o => o.status), ['not-attempted', 'not-attempted']);
      return true;
    });
    assert.equal(calls, 1);
    await c.close();
  });

  it('requires opt-in adapters and exposes unattempted scope failure', async () => {
    const client = new Client();
    await assert.rejects(client.loadDataset({ graphs: [graph], factory }), UnsupportedOperationError);
    await assert.rejects(client.saveDataset([], { graphs: [graph] }), error => {
      assert(error instanceof DatasetSaveError);
      assert(error.cause instanceof UnsupportedOperationError);
      assert.deepEqual(error.outcomes.map(o => o.status), ['not-attempted']);
      return true;
    });
    await client.close();
  });

  it('drains rejected async save before adapter release, without unhandled branches', async () => {
    let reject, started;
    const entered = new Promise(resolve => { started = resolve; });
    const work = new Promise((resolve, no) => { reject = no; });
    const cause = Error('adapter timeout');
    const events = [];
    const unhandled = [];
    const listener = error => unhandled.push(error);
    process.on('unhandledRejection', listener);
    class Adapter extends Client {
      _scopeDataset(quads) { return quads; }
      async _saveDatasetGraph() {
        started();
        try { await work; } finally { events.push('settled'); }
      }
      _close() { events.push('release'); }
    }
    try {
      const client = new Adapter();
      const operation = client.saveDataset([], { graphs: [graph] });
      const checked = assert.rejects(operation, error => {
        assert.equal(error.cause, cause);
        assert.equal(error.outcomes[0].status, 'unknown');
        return true;
      });
      await entered;
      const closing = client.close();
      await Promise.resolve();
      assert.deepEqual(events, []);
      reject(cause);
      await checked;
      await closing;
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(events, ['settled', 'release']);
      assert.deepEqual(unhandled, []);
    } finally { process.off('unhandledRejection', listener); }
  });
});
