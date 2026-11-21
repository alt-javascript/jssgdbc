import assert from 'node:assert/strict';
import { Client, Graph } from '../index.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
class TestClient extends Client {
  _getGraph(name) { return new Graph(this, name); }
}
const operations = ['add', 'remove', 'find', 'has', 'count', 'clear'];

describe('core lifecycle', () => {
  for (const method of operations) {
    it(`drains admitted ${method} before cleanup and rejects new work`, async () => {
      const client = new TestClient();
      const graph = client.getGraph();
      const gate = deferred();
      const events = [];
      graph[`_${method}`] = () => gate.promise;
      graph._close = () => { events.push('graph'); };
      client._close = () => { events.push('client'); };
      const operation = graph[method]('urn:s', 'urn:p', 'urn:o');
      const closing = client.close();
      assert.equal(client.isClosed(), true);
      assert.equal(closing, client.close());
      assert.throws(() => client.getGraph(), /closed/);
      for (const name of operations) await assert.rejects(graph[name]('urn:s', 'urn:p', 'urn:o'), /closed/);
      assert.deepEqual(events, []);
      gate.resolve(42);
      assert.equal(await operation, 42);
      await closing;
      assert.deepEqual(events, ['graph', 'client']);
      assert.equal(graph.isClosed(), true);
      assert.equal(graph._activeOperations.size, 0);
      assert.equal(client._ownedGraphs.size, 0);
      assert.equal(closing, client.close());
    });
  }

  it('retains evicted closing ownership and aggregates every cleanup failure', async () => {
    const client = new TestClient();
    const first = client.getGraph('first');
    const second = client.getGraph('second');
    const gate = deferred();
    const errors = [new Error('first'), new Error('second'), new Error('release')];
    const events = [];
    first._close = async () => { await gate.promise; events.push('first'); throw errors[0]; };
    second._close = () => { events.push('second'); throw errors[1]; };
    client._close = () => { events.push('release'); throw errors[2]; };
    const firstClose = first.close();
    const firstRejected = assert.rejects(firstClose, error => error === errors[0]);
    assert.equal(firstClose, first.close());
    const replacement = client.getGraph('first');
    assert.notEqual(replacement, first);
    const closing = client.close();
    const rejected = assert.rejects(closing, error => {
      assert(error instanceof AggregateError);
      assert.deepEqual(error.errors, errors);
      return true;
    });
    gate.resolve();
    await Promise.all([firstRejected, rejected]);
    assert(events.includes('second'));
    assert.equal(events.at(-1), 'release');
    assert.equal(client._ownedGraphs.size, 0);
    assert.equal(closing, client.close());
    await assert.rejects(client.close(), error => error.errors[0] === errors[0]);
    await assert.rejects(first.close(), error => error === errors[0]);
  });

  it('never evicts a replacement handle when old cleanup settles or repeats', async () => {
    const client = new TestClient();
    const old = client.getGraph('named');
    const gate = deferred();
    old._close = () => gate.promise;
    const closing = old.close();
    const fresh = client.getGraph('named');
    gate.resolve();
    await closing;
    await old.close();
    client._graphClosing(old); // A stale notification must not evict the fresh cache entry.
    assert.equal(client.getGraph('named'), fresh);
    assert.equal(client._ownedGraphs.size, 1);
    await client.close();
  });

  it('drains rejected work without converting operation failure to cleanup failure', async () => {
    const client = new TestClient();
    const graph = client.getGraph();
    const gate = deferred();
    graph._count = () => gate.promise;
    const operation = graph.count();
    const rejected = assert.rejects(operation, /operation failed/);
    const closing = graph.close();
    gate.reject(new Error('operation failed'));
    await rejected;
    await closing;
    assert.equal(graph._activeOperations.size, 0);
    await client.close();
  });

  it('does not create unhandled rejection branches during failed cleanup', async () => {
    const unhandled = [];
    const listener = error => unhandled.push(error);
    process.on('unhandledRejection', listener);
    try {
      const client = new TestClient();
      client.getGraph()._close = () => { throw new Error('cleanup'); };
      await assert.rejects(client.close(), AggregateError);
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(unhandled, []);
    } finally {
      process.removeListener('unhandledRejection', listener);
    }
  });

  it('drains all overlapping work and invokes each cleanup once', async () => {
    const client = new TestClient();
    const graph = client.getGraph();
    const first = deferred(), second = deferred();
    let calls = 0;
    graph._count = () => (++calls === 1 ? first.promise : second.promise);
    let releases = 0;
    graph._close = () => { releases++; };
    const operations = [graph.count(), graph.count()];
    const closing = graph.close();
    const clientClosing = client.close();
    first.resolve(1);
    await operations[0];
    assert.equal(releases, 0);
    second.resolve(2);
    assert.deepEqual(await Promise.all(operations), [1, 2]);
    await Promise.all([closing, graph.close(), clientClosing, client.close()]);
    assert.equal(releases, 1);
    assert.equal(graph._activeOperations.size, 0);
    assert.equal(client._ownedGraphs.size, 0);
  });

  it('releases tracking after synchronous implementation and validation errors', async () => {
    const graph = new Graph(null, 'standalone');
    await assert.rejects(graph.count(), /not implemented/);
    await assert.rejects(graph.add(null, 'urn:p', 'urn:o'));
    assert.equal(graph._activeOperations.size, 0);
    const closing = graph.close();
    assert.equal(closing, graph.close());
    await closing;
  });
});
