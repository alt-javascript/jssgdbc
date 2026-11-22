import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DataFactory as f } from 'n3';
import { defaultGraph, createQuad } from '../../core/RdfTerm.js';
import { FileStorage } from '../FileStorage.js';
import { NTriplesParser } from '../NTriplesParser.js';
import { NTriplesSerializer } from '../NTriplesSerializer.js';
const graph = defaultGraph();
const text = value => NTriplesSerializer.serialize([createQuad(f.namedNode('urn:s'), f.namedNode('urn:p'), f.literal(value))]);
const old = text('old'), next = text('next');

describe('safe typed persistence', () => {
  let base, root, storage;
  const directory = () => path.join(root, storage.key(graph));
  const payload = () => path.join(directory(), 'graph.nt');
  beforeEach(async () => {
    base = await fs.mkdtemp(path.resolve('.file-safe-'));
    root = path.join(base, 'storage'); storage = new FileStorage(root);
  });
  afterEach(async () => { await fs.rm(base, { recursive: true, force: true }); });
  it('isolates default and exact named RDF identities in bounded keys and reopens', async () => {
    const names = [graph, ...['urn:default', 'urn:../outside', 'file:/absolute', 'urn:a/b', 'urn:CON', 'urn:A', 'urn:a', 'urn:é', 'urn:e\u0301', `urn:${'x'.repeat(10000)}`, 'urn:😀'].map(f.namedNode)];
    for (const [i, name] of names.entries()) await storage.write(name, text(String(i)));
    const keys = await fs.readdir(root);
    assert.equal(keys.length, names.length);
    keys.forEach(key => assert.match(key, /^v2-[0-9a-f]{64}$/));
    storage = new FileStorage(root);
    for (const [i, name] of names.entries()) {
      assert.equal(await storage.read(name), text(String(i)));
      const metadata = JSON.parse(await fs.readFile(path.join(root, storage.key(name), 'identity.json')));
      assert.deepEqual(metadata, { version: 2, graph: { termType: name.termType, value: name.value } });
    }
    for (const bad of ['', null, 1, {}, f.blankNode('g'), f.namedNode('relative'), f.namedNode('urn:\ud800')]) assert.throws(() => storage.key(bad));
  });
  for (const legacy of ['default.nt', 'legacy.ttl', 'v1-' + 'a'.repeat(64), 'v3-' + 'b'.repeat(64), 'v2-malformed']) {
    it(`rejects incompatible ${legacy} before mutation, preserving all bytes`, async () => {
      await fs.mkdir(root);
      const target = path.join(root, legacy);
      if (legacy.startsWith('v')) { await fs.mkdir(target); await fs.writeFile(path.join(target, 'identity.json'), '{"version":1,"name":"old"}'); }
      else await fs.writeFile(target, old);
      await fs.writeFile(path.join(root, 'sentinel'), 'untouched');
      const before = await fs.readdir(root);
      for (const operation of [() => storage.read(graph), () => storage.write(graph, next)]) await assert.rejects(operation(), /Incompatible/);
      assert.deepEqual(await fs.readdir(root), before);
      assert.equal(await fs.readFile(path.join(root, 'sentinel'), 'utf8'), 'untouched');
      assert.equal(await fs.readFile(legacy.startsWith('v') ? path.join(target, 'identity.json') : target, 'utf8'), legacy.startsWith('v') ? '{"version":1,"name":"old"}' : old);
    });
  }
  for (const metadata of [null, '{bad', '{}', '{"version":1,"graph":{"termType":"DefaultGraph","value":""}}',
    '{"version":"2","graph":{"termType":"DefaultGraph","value":""}}',
    '{"version":3,"graph":{"termType":"DefaultGraph","value":""}}',
    '{"version":2,"graph":{"termType":"NamedNode","value":"urn:other"}}',
    '{"version":2,"graph":{"termType":"BlankNode","value":"g"}}',
    '{"version":2,"graph":{"termType":"DefaultGraph","value":""},"extra":true}']) {
    it(`fails closed without repairing identity ${metadata}`, async () => {
      await storage.write(graph, old);
      const identity = path.join(directory(), 'identity.json');
      if (metadata === null) await fs.unlink(identity); else await fs.writeFile(identity, metadata);
      const sentinel = path.join(root, 'sentinel');
      const bytes = Buffer.from([0, 255, 42]);
      await fs.writeFile(sentinel, bytes);
      await assert.rejects(storage.read(graph), /identity/);
      await assert.rejects(storage.write(f.namedNode('urn:new'), next), /identity/);
      assert.equal(await fs.readFile(payload(), 'utf8'), old);
      assert.deepEqual(await fs.readFile(sentinel), bytes);
      assert.equal((await fs.readdir(root)).length, 2);
      if (metadata === null) await assert.rejects(fs.stat(identity), { code: 'ENOENT' });
      if (metadata !== null) assert.equal(await fs.readFile(identity, 'utf8'), metadata);
    });
  }
  it('rejects a forced key collision by comparing full graph identities', async () => {
    await storage.write(graph, old);
    const key = storage.key(graph); storage.key = () => key;
    await assert.rejects(storage.write(f.namedNode('urn:collision'), next), /Identity mismatch/);
    assert.equal(await fs.readFile(payload(), 'utf8'), old);
  });
  it('rejects malformed candidates before creating metadata and malformed stored RDF on read', async () => {
    await assert.rejects(storage.write(graph, '<relative> <urn:p> <urn:o> .'), /Parse error/);
    await assert.rejects(fs.stat(root), { code: 'ENOENT' });
    await storage.write(graph, old);
    await fs.writeFile(payload(), '_:unencoded <urn:p> <urn:o> .\n');
    await assert.rejects(storage.read(graph), /persisted blank label/);
    assert.equal(await fs.readFile(payload(), 'utf8'), '_:unencoded <urn:p> <urn:o> .\n');
  });
  it('rejects invalid UTF-8 without replacement or repair', async () => {
    await storage.write(graph, old);
    const bytes = Buffer.from([0xff, 0xfe]);
    await fs.writeFile(payload(), bytes);
    await assert.rejects(storage.read(graph), /encoded data/);
    assert.deepEqual(await fs.readFile(payload()), bytes);
  });
  it('revalidates identity before rename and preserves the prior payload', async () => {
    await storage.write(graph, old);
    const exclusive = storage._exclusive.bind(storage);
    storage._exclusive = async (...args) => {
      await exclusive(...args);
      if (args[0].includes('.tmp-')) await fs.writeFile(path.join(directory(), 'identity.json'), '{}');
    };
    await assert.rejects(storage.write(graph, next), /identity/);
    assert.equal(await fs.readFile(payload(), 'utf8'), old);
    assert.deepEqual((await fs.readdir(directory())).sort(), ['graph.nt', 'identity.json']);
  });
  it('reports ambiguous post-rename failure; reread reveals committed payload', async () => {
    await storage.write(graph, old);
    const failure = new Error('post rename injected');
    storage._fs = { ...fs, rename: async (...args) => { await fs.rename(...args); throw failure; } };
    await assert.rejects(storage.write(graph, next), error => {
      assert.equal(error.errors[0].cause, failure);
      assert.equal(error.errors[1].cause.code, 'ENOENT');
      return true;
    });
    storage._fs = fs;
    assert.equal(await storage.read(graph), next);
  });
  it('preserves shared unusual blank labels across separate stored graphs', async () => {
    const b = f.blankNode('space / 😀');
    const quad = createQuad(b, f.namedNode('urn:p'), b);
    const wire = NTriplesSerializer.serialize([quad]);
    for (const g of [graph, f.namedNode('urn:g')]) {
      await storage.write(g, wire);
      assert.equal(NTriplesParser.parse(await new FileStorage(root).read(g), g)[0].subject.value, b.value);
    }
  });
  for (const location of ['root', 'ancestor', 'key', 'identity', 'payload']) {
    it(`rejects ${location} symlinks without touching target sentinel`, async () => {
      const outside = path.join(base, 'outside'); await fs.mkdir(outside);
      const sentinel = path.join(outside, 'sentinel'); await fs.writeFile(sentinel, 'untouched');
      if (location === 'root' || location === 'ancestor') {
        await fs.symlink(outside, root);
        if (location === 'ancestor') storage = new FileStorage(path.join(root, 'nested'));
      } else {
        await storage.write(graph, old);
        const target = location === 'key' ? directory() : path.join(directory(), location === 'identity' ? 'identity.json' : 'graph.nt');
        await fs.rm(target, { recursive: true, force: true });
        await fs.symlink(location === 'key' ? outside : sentinel, target);
      }
      await assert.rejects(storage.write(graph, next), /storage/);
      await assert.rejects(storage.read(graph), /storage/);
      assert.equal(await fs.readFile(sentinel, 'utf8'), 'untouched');
      assert.deepEqual(await fs.readdir(outside), ['sentinel']);
    });
  }
  for (const location of ['root', 'key', 'identity', 'payload', 'fifo']) {
    it(`rejects unsafe ${location} type`, async () => {
      if (location === 'root') await fs.writeFile(root, 'file');
      else {
        await storage.write(graph, old);
        const target = location === 'key' ? directory() : path.join(directory(), location === 'identity' ? 'identity.json' : 'graph.nt');
        await fs.rm(target, { recursive: true, force: true });
        if (location === 'key') await fs.writeFile(target, 'file');
        else if (location === 'fifo') execFileSync('mkfifo', [target]);
        else await fs.mkdir(target);
      }
      await assert.rejects(storage.read(graph), /storage/);
      await assert.rejects(storage.write(graph, next), /storage/);
    });
  }
  it('checks raw ancestors before dot-dot normalization', async () => {
    const outside = path.join(base, 'outside'); await fs.mkdir(outside);
    const link = path.join(base, 'link'); await fs.symlink(outside, link);
    await assert.rejects(new FileStorage(`${link}/../storage`).read(graph), /storage/);
    assert.deepEqual(await fs.readdir(outside), []);
  });
  it('does not delete unowned temporary files after exclusive-create failure', async () => {
    await storage.write(graph, old); let unowned;
    storage._fs = { ...fs, open: async (target, ...args) => {
      if (target.includes('.tmp-')) { unowned = target; await fs.writeFile(target, 'not ours'); }
      return fs.open(target, ...args);
    } };
    await assert.rejects(storage.write(graph, next), { code: 'EEXIST' });
    assert.equal(await fs.readFile(unowned, 'utf8'), 'not ours');
    assert.equal(await fs.readFile(payload(), 'utf8'), old);
  });
  for (const fault of ['read', 'write', 'rename', 'cleanup', 'close']) {
    it(`preserves payload and original cause after ${fault} failure, then recovers`, async () => {
      await storage.write(graph, old);
      const failure = new Error(`${fault} injected`), cleanup = new Error('cleanup injected');
      storage._fs = { ...fs,
        open: async (...args) => {
          const handle = await fs.open(...args);
          if (String(args[0]).endsWith('graph.nt') && fault === 'read') handle.readFile = async () => { throw failure; };
          if (String(args[0]).includes('.tmp-')) {
            if (fault === 'write') handle.writeFile = async () => { throw failure; };
            if (fault === 'close') { const close = handle.close.bind(handle); handle.close = async () => { await close(); throw failure; }; }
          }
          return handle;
        },
        rename: async (...args) => { if (['rename', 'cleanup'].includes(fault)) throw failure; return fs.rename(...args); },
        unlink: async (...args) => { if (fault === 'cleanup') throw cleanup; return fs.unlink(...args); }
      };
      await assert.rejects(fault === 'read' ? storage.read(graph) : storage.write(graph, next), error => {
        if (fault === 'cleanup') { assert.equal(error.errors[0].cause, failure); assert.equal(error.errors[1].cause, cleanup); }
        else assert.equal(error.cause, failure);
        return true;
      });
      assert.equal(await fs.readFile(payload(), 'utf8'), old);
      assert.equal((await fs.readdir(directory())).filter(n => n.startsWith('.tmp-')).length, fault === 'cleanup' ? 1 : 0);
      storage._fs = fs;
      await storage.write(graph, next);
      assert.equal(await storage.read(graph), next);
    });
  }
});
