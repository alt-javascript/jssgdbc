import { namedNode as n, defaultGraph } from '../../core/test/terms.js';
import assert from 'node:assert/strict';
import { DriverManager, MemoryDriver } from '../index.js';

const operations = ['add', 'remove', 'find', 'has', 'count', 'clear'];
describe('memory lifecycle', () => {
  let client;
  beforeEach(async () => {
    DriverManager.clear();
    DriverManager.registerDriver(new MemoryDriver());
    client = await DriverManager.getClient('jssgdbc:memory:');
  });
  afterEach(async () => { await client?.close(); });

  for (const name of [defaultGraph(), n('urn:named')]) {
    it(`reacquires ${name || 'default'} data with a fresh handle and detached cursor`, async () => {
      const graph = client.getGraph(name);
      await graph.add(n('urn:s'), n('urn:p'), n('urn:o'));
      const cursor = await graph.find();
      const closing = graph.close();
      assert.equal(graph.isClosed(), true);
      assert.equal(closing, graph.close());
      await closing;
      const fresh = client.getGraph(name);
      assert.notEqual(fresh, graph);
      assert.equal(await fresh.count(), 1);
      assert.equal(await fresh.has(n('urn:s'), n('urn:p'), n('urn:o')), true);
      for (const method of operations) await assert.rejects(graph[method](n('urn:s'), n('urn:p'), n('urn:o')), /closed/);
      await fresh.clear();
      await client.close();
      assert.equal(await cursor.next(), true);
      assert.equal(cursor.getTriple().subject.value, 'urn:s');
      await cursor.close();
    });
  }

  it('invalidates all owned handles and six operations on client close', async () => {
    const graphs = [client.getGraph(), client.getGraph(n('urn:named'))];
    const closing = client.close();
    assert.equal(closing, client.close());
    for (const graph of graphs) {
      for (const method of operations) await assert.rejects(graph[method](n('urn:s'), n('urn:p'), n('urn:o')), /closed/);
    }
    await closing;
    assert.throws(() => client.getGraph(), /closed/);
    assert.throws(() => client.getGraph(n('urn:new')), /closed/);
  });

  it('keeps default and named stores independent across repeated reacquisition', async () => {
    await client.getGraph().add(n('urn:default'), n('urn:p'), n('urn:o'));
    await client.getGraph(n('urn:named')).add(n('urn:named'), n('urn:p'), n('urn:o'));
    for (let i = 0; i < 3; i++) {
      await Promise.all([client.getGraph().close(), client.getGraph(n('urn:named')).close()]);
      assert.equal(await client.getGraph().has(n('urn:default')), true);
      assert.equal(await client.getGraph().has(n('urn:named')), false);
      assert.equal(await client.getGraph(n('urn:named')).has(n('urn:named')), true);
      assert.equal(client._ownedGraphs.size, 2);
    }
  });
});
