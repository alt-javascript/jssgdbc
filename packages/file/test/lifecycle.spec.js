import { DataFactory as F } from 'n3';
import { NTriplesSerializer } from '../NTriplesSerializer.js';
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
    for (const name of [F.defaultGraph(), F.namedNode('urn:named')]) {
      const graph = client.getGraph(name); await graph.add(F.namedNode('urn:s'), F.namedNode('urn:p'), F.literal('value'));
      const cursor = await graph.find(); const closing = graph.close(); assert.equal(graph.close(), closing); await closing;
      const fresh = client.getGraph(name); assert.notEqual(fresh, graph); assert.equal(await fresh.count(), 1);
      for (const call of [() => graph.add(F.namedNode('urn:s'), F.namedNode('urn:p'), F.literal('x')), () => graph.remove(), () => graph.find(), () => graph.has(), () => graph.count(), () => graph.clear()]) await assert.rejects(call(), /closed/);
      assert.equal(await cursor.next(), true);
    }
    const owned = client.getGraph(F.namedNode('urn:named')); const closing = client.close(); assert.equal(client.close(), closing); await closing;
    assert.throws(() => client.getGraph(), /closed/);
    for (const call of [() => owned.add(F.namedNode('urn:s'), F.namedNode('urn:p'), F.literal('x')), () => owned.remove(), () => owned.find(), () => owned.has(), () => owned.count(), () => owned.clear()]) await assert.rejects(call(), /closed/);
  });
  for (const afterCommit of [false, true]) {
    it(`reloads after ${afterCommit ? 'ambiguous committed' : 'pre-commit'} write rejection and recovers its queue`, async () => {
      const graph = client.getGraph();
      const s = F.namedNode('urn:s'), p = F.namedNode('urn:p');
      await graph.add(s, p, F.literal('old'));
      const storage = client._storage, write = storage.write.bind(storage);
      const fault = new Error('injected write rejection');
      storage.write = async (...args) => { if (afterCommit) await write(...args); throw fault; };
      await assert.rejects(graph.add(s, p, F.literal('candidate')), error => error === fault);
      storage.write = write;
      assert.equal(await graph.has(s, p, F.literal('candidate')), afterCommit);
      assert.equal(await graph.has(s, p, F.literal('old')), true);
      await graph.add(s, p, F.literal('recovery'));
      await graph.close();
      const fresh = client.getGraph();
      assert.equal(fresh._store, graph._store);
      assert.equal(await fresh.count(), afterCommit ? 3 : 2);
    });
  }
  it('preserves payload and cached state after serialization failure and recovers', async () => {
    const graph = client.getGraph(), s = F.namedNode('urn:s'), p = F.namedNode('urn:p');
    await graph.add(s, p, F.literal('old'));
    const payload = path.join(root, client._storage.key(F.defaultGraph()), 'graph.nt');
    const before = await fs.readFile(payload);
    const serialize = NTriplesSerializer.serialize, failure = Error('serialization injected');
    NTriplesSerializer.serialize = () => { throw failure; };
    try {
      await assert.rejects(graph.add(s, p, F.literal('candidate')), error => error === failure);
      assert.equal(await graph.count(), 1);
      assert.equal(await graph.has(s, p, F.literal('candidate')), false);
      assert.deepEqual(await fs.readFile(payload), before);
    } finally { NTriplesSerializer.serialize = serialize; }
    await graph.add(s, p, F.literal('recovery'));
    await client.close();
    client = await DriverManager.getClient(`jssgdbc:file:${root}`);
    assert.equal(await client.getGraph().count(), 2);
  });
  it('does not cache failed loads and performs no I/O for malformed terms', async () => {
    const graph = client.getGraph(), storage = client._storage;
    const read = storage.read.bind(storage); let reads = 0;
    storage.read = async () => { reads++; throw new Error('injected read'); };
    await assert.rejects(graph.add('urn:s', F.namedNode('urn:p'), F.literal('x')), TypeError);
    assert.equal(reads, 0);
    await assert.rejects(graph.count(), /injected read/);
    storage.read = read;
    assert.equal(await graph.count(), 0);
    await graph.add(F.namedNode('urn:s'), F.namedNode('urn:p'), F.literal('ok'));
    assert.equal(await graph.count(), 1);
  });
  for (const closeClient of [false, true]) {
    it(`serializes overlapping operations and drains delayed persistence before ${closeClient ? 'client' : 'graph'} close`, async () => {
      const graph = client.getGraph(); const entered = deferred(), release = deferred();
      const storage = client._storage; const write = storage.write.bind(storage); let calls = 0;
      storage.write = async (...args) => { if (++calls === 1) { entered.resolve(); await release.promise; } return write(...args); };
      const first = graph.add(F.namedNode('urn:s'), F.namedNode('urn:p'), F.literal('one'));
      const second = graph.add(F.namedNode('urn:s'), F.namedNode('urn:p'), F.literal('two'));
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
