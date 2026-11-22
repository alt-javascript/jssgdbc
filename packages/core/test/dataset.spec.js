import assert from 'node:assert/strict';
import { Client, DatasetSaveError, UnsupportedOperationError, defaultGraph } from '../index.js';

const graph = defaultGraph();
const factory = { dataset: quads => quads };
describe('Core Dataset adapter hooks', () => {
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
