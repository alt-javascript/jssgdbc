import { n, d, q } from './helpers/terms.js';
import assert from 'node:assert/strict';
import { SparqlClient } from '../SparqlClient.js';
import { startMockSparqlEndpoint } from './helpers/mock-sparql-endpoint.js';

const triple = [n('urn:s'), n('urn:p'), n('urn:o')];
const methods = ['add', 'remove', 'find', 'has', 'count', 'clear'];
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function rejected(graph) {
  for (const method of methods) await assert.rejects(graph[method](...triple), /closed/);
}

describe('SPARQL lifecycle', () => {
  it('reacquires default/named graphs without deleting data and keeps cursors detached', async () => {
    const endpoint = await startMockSparqlEndpoint();
    const client = new SparqlClient(null, `jssgdbc:sparql:${endpoint.endpoint}`);
    try {
      for (const name of [d(), n('urn:named')]) {
        const old = client.getGraph(name);
        await old.add(...triple);
        const cursor = await old.find();
        const closing = old.close();
        assert.equal(closing, old.close());
        await closing;
        await rejected(old);
        const fresh = client.getGraph(name);
        assert.notEqual(fresh, old);
        assert.equal(await fresh.has(...triple), true);
        await fresh.close();
        assert.equal(await cursor.next(), true);
        assert.deepEqual(cursor.getTriple(), q(...triple, name));
        cursor.close();
      }
      const owned = [client.getGraph(), client.getGraph(n('urn:named'))];
      const closing = client.close();
      assert.equal(closing, client.close());
      await closing;
      for (const graph of owned) await rejected(graph);
      assert.throws(() => client.getGraph(), /closed/);
      assert.equal(endpoint.requests.some(r => r.operation === 'CLEAR'), false);
    } finally { await client.close(); await endpoint.close(); }
  });

  it('drains delayed response bodies without aborting admitted requests', async () => {
    const original = globalThis.fetch, gate = deferred();
    let signal, released = false;
    globalThis.fetch = async (_url, options) => {
      signal = options.signal;
      return { ok: true, async text() { await gate.promise; return JSON.stringify({ boolean: true }); } };
    };
    const client = new SparqlClient(null, 'jssgdbc:sparql:http://localhost/sparql');
    client._close = () => { released = true; };
    try {
      const graph = client.getGraph();
      const operation = graph.has(...triple);
      const closing = client.close();
      await rejected(graph);
      assert.equal(signal.aborted, false);
      assert.equal(released, false);
      gate.resolve();
      assert.equal(await operation, true);
      await closing;
      assert.equal(released, true);
      assert.equal(graph._activeOperations.size, 0);
    } finally { gate.resolve(); await client.close(); globalThis.fetch = original; }
  });

  it('drains failed requests with sanitized diagnostics', async () => {
    const original = globalThis.fetch, gate = deferred();
    globalThis.fetch = async () => { await gate.promise; throw new Error('password secret query'); };
    const client = new SparqlClient(null, 'jssgdbc:sparql:http://localhost/sparql');
    try {
      const operation = client.getGraph().find();
      const failure = assert.rejects(operation, error => {
        assert.equal(error.message, 'SPARQL query: network failure');
        assert.equal(error.cause, undefined);
        return true;
      });
      const closing = client.close();
      gate.resolve();
      await failure; await closing;
    } finally { gate.resolve(); await client.close(); globalThis.fetch = original; }
  });

  it('attempts all owned graph cleanups and repeats the original failure', async () => {
    const client = new SparqlClient(null, 'jssgdbc:sparql:http://localhost/sparql');
    let attempts = 0;
    for (const name of [d(), n('urn:named')]) client.getGraph(name)._close = () => { attempts++; throw new Error('cleanup'); };
    const closing = client.close();
    let original;
    await assert.rejects(closing, error => { original = error; assert.equal(error.errors.length, 2); return true; });
    assert.equal(attempts, 2);
    assert.equal(client.close(), closing);
    await assert.rejects(client.close(), error => error === original);
    assert.equal(client._ownedGraphs.size, 0);
  });
});
