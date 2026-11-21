import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DriverManager, FileDriver } from '@alt-javascript/jssgdbc-file';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
describe('file lifecycle', () => {
  let root, client, drivers;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'jssgdbc-life-'));
    drivers = DriverManager.getDrivers(); DriverManager.clear(); DriverManager.registerDriver(new FileDriver());
    client = await DriverManager.getClient(`jssgdbc:file:${root}`);
  });
  afterEach(async () => {
    await client.close(); DriverManager.clear(); drivers.forEach(d => DriverManager.registerDriver(d));
    await fs.rm(root, { recursive: true, force: true });
  });
  it('reacquires default/named handles, preserves other graphs and detached cursors', async () => {
    for (const name of ['', 'named']) {
      const graph = client.getGraph(name); await graph.add('urn:s', 'urn:p', '"value"');
      const cursor = await graph.find(); const closing = graph.close(); assert.equal(graph.close(), closing); await closing;
      const fresh = client.getGraph(name); assert.notEqual(fresh, graph); assert.equal(await fresh.count(), 1);
      for (const call of [() => graph.add('urn:s', 'urn:p', '"x"'), () => graph.remove(), () => graph.find(), () => graph.has(), () => graph.count(), () => graph.clear()]) await assert.rejects(call(), /closed/);
      assert.equal(await cursor.next(), true);
    }
    const owned = client.getGraph('named'); const closing = client.close(); assert.equal(client.close(), closing); await closing;
    assert.throws(() => client.getGraph(), /closed/);
    for (const call of [() => owned.add('urn:s', 'urn:p', '"x"'), () => owned.remove(), () => owned.find(), () => owned.has(), () => owned.count(), () => owned.clear()]) await assert.rejects(call(), /closed/);
  });
  for (const closeClient of [false, true]) {
    it(`serializes overlapping operations and drains delayed persistence before ${closeClient ? 'client' : 'graph'} close`, async () => {
      const graph = client.getGraph(); const entered = deferred(), release = deferred();
      const storage = client._storage; const write = storage.write.bind(storage); let calls = 0;
      storage.write = async (...args) => { if (++calls === 1) { entered.resolve(); await release.promise; } return write(...args); };
      const first = graph.add('urn:s', 'urn:p', '"one"');
      const second = graph.add('urn:s', 'urn:p', '"two"');
      const count = graph.count();
      await entered.promise;
      let closed = false;
      const closing = (closeClient ? client : graph).close(); closing.then(() => { closed = true; });
      await assert.rejects(graph.clear(), /closed/); assert.equal(closed, false);
      release.resolve(); await Promise.all([first, second]); assert.equal(await count, 2); await closing;
      if (closeClient) client = await DriverManager.getClient(`jssgdbc:file:${root}`);
      assert.equal(await client.getGraph().count(), 2);
    });
  }
});
