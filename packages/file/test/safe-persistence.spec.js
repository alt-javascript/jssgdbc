import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DriverManager, FileDriver } from '@alt-javascript/jssgdbc-file';
import { NTriplesSerializer } from '../NTriplesSerializer.js';

// All fault injection is per-client; real filesystem and DriverManager composition remain in use.
describe('safe persistence', () => {
  let base, root, client, drivers;
  const open = async () => DriverManager.getClient(`jssgdbc:file:${root}`);
  beforeEach(async () => {
    base = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'jssgdbc-safe-'));
    root = path.join(base, 'storage');
    drivers = DriverManager.getDrivers();
    DriverManager.clear(); DriverManager.registerDriver(new FileDriver());
    client = await open();
  });
  afterEach(async () => {
    await client?.close();
    DriverManager.clear(); drivers.forEach(d => DriverManager.registerDriver(d));
    await fs.rm(base, { recursive: true, force: true });
  });
  it('isolates exact hostile and Unicode names in bounded keys and reopens them', async () => {
    const names = ['', 'default', '../outside', '/absolute', 'a/b', 'a\\b', 'CON', '.', '..', 'A', 'a', 'é', 'e\u0301', 'x'.repeat(10000), '😀', '\ud800', '\ud801'];
    for (const [i, name] of names.entries()) await client.getGraph(name).add('urn:s', 'urn:p', `"${i}"`);
    const keys = await fs.readdir(root);
    assert.equal(keys.length, names.length);
    keys.forEach(key => assert.match(key, /^v1-[0-9a-f]{64}$/));
    await client.close(); client = await open();
    for (const [i, name] of names.entries()) assert.equal(await client.getGraph(name).has('urn:s', 'urn:p', `"${i}"`), true);
    for (const name of [null, 1, {}, [], true]) assert.throws(() => client.getGraph(name), /string/);
  });
  it('does not read or migrate legacy files', async () => {
    await fs.mkdir(root); await fs.writeFile(path.join(root, 'default.nt'), 'legacy');
    assert.equal(await client.getGraph().count(), 0);
    assert.equal(await fs.readFile(path.join(root, 'default.nt'), 'utf8'), 'legacy');
  });
  for (const fault of ['missing', 'malformed', 'mismatch', 'collision']) {
    it(`fails closed for ${fault} identity`, async () => {
      const g = client.getGraph('original'); await g.add('urn:s', 'urn:p', '"old"');
      const storage = client._storage;
      const dir = path.join(root, storage.key('original'));
      const identity = path.join(dir, 'identity.json');
      const before = await fs.readFile(path.join(dir, 'graph.nt'), 'utf8');
      if (fault === 'missing') await fs.unlink(identity);
      if (fault === 'malformed') await fs.writeFile(identity, '{bad');
      if (fault === 'mismatch') await fs.writeFile(identity, JSON.stringify({ version: 1, name: 'other' }));
      if (fault === 'collision') {
        const key = storage.key('original'); storage.key = () => key;
        await assert.rejects(client.getGraph('collision').count(), /identity/);
      } else {
        await assert.rejects(g.add('urn:s', 'urn:p', '"new"'), /identity/);
        await g.close(); await assert.rejects(client.getGraph('original').count(), /identity/);
      }
      assert.equal(await fs.readFile(path.join(dir, 'graph.nt'), 'utf8'), before);
    });
  }
  for (const location of ['root', 'ancestor', 'key', 'identity', 'payload']) {
    it(`rejects ${location} symlinks without touching outside sentinel`, async () => {
      const outside = path.join(base, 'outside'); await fs.mkdir(outside);
      const sentinel = path.join(outside, 'sentinel'); await fs.writeFile(sentinel, 'untouched');
      const keyDir = path.join(root, client._storage.key(''));
      if (location === 'root') await fs.symlink(outside, root);
      else if (location === 'ancestor') {
        await fs.symlink(outside, root); root = path.join(root, 'nested');
        await client.close(); client = await open();
      } else {
        await client.getGraph().count();
        if (location === 'key') { await fs.rm(keyDir, { recursive: true }); await fs.symlink(outside, keyDir); }
        else {
          const leaf = path.join(keyDir, location === 'identity' ? 'identity.json' : 'graph.nt');
          await fs.rm(leaf, { force: true }); await fs.symlink(sentinel, leaf);
        }
      }
      await assert.rejects(client.getGraph().add('urn:s', 'urn:p', '"new"'), /storage/);
      await client.getGraph().close();
      await assert.rejects(client.getGraph().count(), /storage/);
      assert.equal(await fs.readFile(sentinel, 'utf8'), 'untouched');
      assert.deepEqual(await fs.readdir(outside), ['sentinel']);
    });
  }
  for (const location of ['root', 'key', 'identity', 'payload']) {
    it(`rejects invalid ${location} type`, async () => {
      if (location === 'root') await fs.writeFile(root, 'file');
      else {
        await client.getGraph().count();
        const dir = path.join(root, client._storage.key(''));
        const target = location === 'key' ? dir : path.join(dir, location === 'identity' ? 'identity.json' : 'graph.nt');
        await fs.rm(target, { recursive: true, force: true });
        if (location === 'key') await fs.writeFile(target, 'file'); else await fs.mkdir(target);
      }
      await assert.rejects(client.getGraph().add('urn:s', 'urn:p', '"x"'), /storage/);
    });
  }
  it('checks raw configured ancestors even when followed by dot-dot', async () => {
    const outside = path.join(base, 'outside'); await fs.mkdir(outside);
    const link = path.join(base, 'link'); await fs.symlink(outside, link);
    await client.close(); root = `${link}/../storage`; client = await open();
    await assert.rejects(client.getGraph().count(), /storage/);
    assert.deepEqual(await fs.readdir(outside), []);
  });
  it('does not delete unowned temporary files when exclusive creation fails', async () => {
    const g = client.getGraph(); await g.add('urn:s', 'urn:p', '"old"');
    const storage = client._storage; const original = storage._fs; let unowned;
    try {
      storage._fs = { ...fs, open: async (target, ...args) => {
        if (target.includes('.tmp-')) { unowned = target; await fs.writeFile(target, 'not ours'); }
        return fs.open(target, ...args);
      } };
      await assert.rejects(g.clear(), { code: 'EEXIST' });
      assert.equal(await fs.readFile(unowned, 'utf8'), 'not ours');
      assert.equal(await g.count(), 1);
    } finally { storage._fs = original; }
  });
  it('does not publish failed remove or clear and retains original rename cause', async () => {
    const g = client.getGraph(); await g.add('urn:s', 'urn:p', '"old"');
    const storage = client._storage; const original = storage._fs;
    const failure = new Error('injected rename');
    try {
      storage._fs = { ...fs, rename: async () => { throw failure; } };
      for (const call of [() => g.remove(), () => g.clear()]) {
        await assert.rejects(call(), error => error.cause === failure);
        assert.equal(await g.count(), 1);
      }
    } finally { storage._fs = original; }
    await g.close(); assert.equal(await client.getGraph().count(), 1);
  });
  for (const fault of ['serialize', 'write', 'rename', 'cleanup']) {
    it(`preserves disk and memory on ${fault} failure and exposes cleanup errors`, async () => {
      const g = client.getGraph(); await g.add('urn:s', 'urn:p', '"old"');
      const storage = client._storage;
      const file = path.join(root, storage.key(''), 'graph.nt');
      const before = await fs.readFile(file, 'utf8');
      const originalIO = storage._fs;
      const serialize = NTriplesSerializer.serialize;
      try {
        if (fault === 'serialize') NTriplesSerializer.serialize = () => { throw new Error('serialize injected'); };
        else storage._fs = { ...fs,
          ...(fault === 'write' ? { open: async (...args) => {
            const handle = await fs.open(...args);
            if (String(args[0]).includes('.tmp-')) handle.writeFile = async () => { throw new Error('write injected'); };
            return handle;
          } } : { rename: async () => { throw new Error('rename injected'); } }),
          ...(fault === 'cleanup' ? { unlink: async () => { throw new Error('cleanup injected'); } } : {})
        };
        await assert.rejects(g.add('urn:s', 'urn:p', '"new"'), error => {
          if (fault === 'cleanup') assert.equal(error.errors.length, 2);
          return /serialize|storage/.test(error.message);
        });
      } finally { storage._fs = originalIO; NTriplesSerializer.serialize = serialize; }
      assert.equal(await fs.readFile(file, 'utf8'), before);
      assert.equal(await g.count(), 1);
      assert.equal(await g.has(null, null, '"new"'), false);
      const temps = (await fs.readdir(path.dirname(file))).filter(n => n.startsWith('.tmp-'));
      assert.equal(temps.length, fault === 'cleanup' ? 1 : 0);
      await g.add('urn:s', 'urn:p', '"retry"'); assert.equal(await g.count(), 2);
    });
  }
});
