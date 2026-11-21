import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const names = ['core', 'memory', 'file', 'sparql', 'neo4j'];
const registration = { memory: './MemoryDriver.js', file: './FileDriver.js', sparql: './SparqlDriver.js', neo4j: './index.js' };
const readJSON = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const manifests = Object.fromEntries(['', ...names.map(n => `packages/${n}`)].map(p => [p, readJSON(`${p ? `${p}/` : ''}package.json`)]));
const lock = readJSON('package-lock.json');

function validate(packages, locked) {
  assert.equal(locked.version, '0.0.0', 'package-lock.json version');
  for (const [path, pkg] of Object.entries(packages)) {
    const label = path || 'root';
    assert.equal(pkg.version, '0.0.0', `${label} version`);
    assert.equal(pkg.private, true, `${label} private`);
    assert.equal(locked.packages[path]?.version, '0.0.0', `${label} lock version`);
    for (const [source, record] of [['manifest', pkg], ['lock', locked.packages[path]]]) {
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const [name, version] of Object.entries(record[field] || {})) {
          if (name.startsWith('@alt-javascript/jssgdbc-')) assert.equal(version, '0.0.0', `${label} ${source} ${field}.${name}`);
        }
      }
    }
    if (!path) continue;
    assert.equal(pkg.scripts?.prepublishOnly, 'node ../../scripts/prevent-publish.js', `${label} prepublishOnly`);
    const name = path.split('/')[1];
    if (name === 'core') assert.equal(pkg.sideEffects, false, `${label} sideEffects`);
    else {
      for (const entry of new Set(['./index.js', registration[name]])) {
        assert.ok(Array.isArray(pkg.sideEffects) && pkg.sideEffects.includes(entry), `${label} sideEffects missing ${entry}`);
      }
      assert.equal(pkg.dependencies?.['@alt-javascript/jssgdbc-core'], '0.0.0', `${label} core dependency`);
      assert.equal(locked.packages[path].dependencies?.['@alt-javascript/jssgdbc-core'], '0.0.0', `${label} lock core dependency`);
    }
  }
}

function checkProcess(label, result, status) {
  const diagnostic = `${label}: status=${result.status} signal=${result.signal} error=${result.error?.message || ''}\n${result.stdout || ''}\n${result.stderr || ''}`;
  assert.ifError(result.error && new Error(diagnostic));
  assert.equal(result.status, status, diagnostic);
  return `${result.stdout || ''}${result.stderr || ''}`;
}
const options = { cwd: root, encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 };

test('root, five workspace manifests and owned lock metadata are experimental', () => validate(manifests, lock));

for (const name of names) {
  test(`${name}: actual declared prepublishOnly rejects offline`, () => {
    const pkg = manifests[`packages/${name}`];
    assert.equal(pkg.scripts.prepublishOnly, 'node ../../scripts/prevent-publish.js', `${name} prepublishOnly`);
    // Execute the declared command, never npm publish (including dry-run).
    const [executable, ...args] = pkg.scripts.prepublishOnly.split(' ');
    const result = spawnSync(executable === 'node' ? process.execPath : executable, args, { ...options, cwd: `${root}packages/${name}` });
    assert.match(checkProcess(name, result, 1), /Experimental publication denied: jssgdbc 0\.0\.0 is local-workspace only\./);
  });
  for (const [field, mutate] of [
    ['private', p => { delete p.private; }],
    ['prepublishOnly', p => { delete p.scripts.prepublishOnly; }],
    ['version', p => { p.version = '1.0.0'; }],
    ['sideEffects', p => { delete p.sideEffects; }]
  ]) {
    test(`${name}: detects missing or invalid ${field}`, () => {
      const copy = structuredClone(manifests);
      mutate(copy[`packages/${name}`]);
      assert.throws(() => validate(copy, lock), new RegExp(`packages/${name}.*${field}`));
    });
  }
  test(`${name}: detects bad owned lock version`, () => {
    const copy = structuredClone(lock);
    copy.packages[`packages/${name}`].version = '1.0.0';
    assert.throws(() => validate(manifests, copy), new RegExp(`packages/${name} lock version`));
  });
}

test('detects non-exact internal references in manifest and lock', () => {
  for (const source of ['manifest', 'lock']) {
    const packages = structuredClone(manifests), locked = structuredClone(lock);
    const record = source === 'manifest' ? packages['packages/file'] : locked.packages['packages/file'];
    record.dependencies['@alt-javascript/jssgdbc-core'] = '*';
    assert.throws(() => validate(packages, locked), /packages\/file.*dependencies/);
  }
});

for (const name of names.filter(n => n !== 'core')) {
  test(`${name}: fresh public import registers and creates/closes a client offline`, () => {
    const code = `
      import assert from 'node:assert/strict';
      import net from 'node:net';
      import { DriverManager } from '@alt-javascript/jssgdbc-core';
      net.Socket.prototype.connect = () => { throw new Error('Network forbidden in packaging smoke'); };
      globalThis.fetch = () => { throw new Error('Network forbidden in packaging smoke'); };
      assert.equal(DriverManager.getDrivers().length, 0);
      const api = await import('@alt-javascript/jssgdbc-${name}');
      const drivers = DriverManager.getDrivers();
      assert.equal(drivers.length, 1);
      const driver = drivers[0];
      let nativeClosed = false, initialized = false, sessionClosed = false, verified = false;
      // Neo4j eagerly verifies connectivity; substitute only its existing native seam.
      if ('${name}' === 'neo4j') driver._nativeDriverFactory = () => ({
        verifyConnectivity: async () => { verified = true; },
        session: () => ({
          executeWrite: async work => work({ run: async () => { initialized = true; return { records: [] }; } }),
          close: async () => { sessionClosed = true; }
        }),
        close: async () => { nativeClosed = true; }
      });
      const urls = { memory: 'jssgdbc:memory:', file: 'jssgdbc:file:' + process.cwd() + '/packaging-unused', sparql: 'jssgdbc:sparql:http://127.0.0.1:1/dataset', neo4j: 'jssgdbc:neo4j:bolt://127.0.0.1:1' };
      assert.ok(driver.acceptsURL(urls['${name}']));
      const client = await DriverManager.getClient(urls['${name}']);
      try { assert.ok(client instanceof api.${name === 'sparql' ? 'Sparql' : name === 'neo4j' ? 'Neo4j' : name[0].toUpperCase() + name.slice(1)}Client); }
      finally { await client.close(); }
      assert.equal(client.isClosed(), true);
      if ('${name}' === 'neo4j') assert.ok(verified && initialized && sessionClosed && nativeClosed);
    `;
    checkProcess(name, spawnSync(process.execPath, ['--input-type=module', '--eval', code], options), 0);
  });
}

test('subprocess diagnostics preserve package, exit, stderr and timeout', () => {
  assert.throws(() => checkProcess('fixture-package', { status: 2, stderr: 'fixture failure' }, 0), /fixture-package.*status=2[\s\S]*fixture failure/);
  const result = spawnSync(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { ...options, timeout: 100 });
  assert.throws(() => checkProcess('timeout-package', result, 0), /timeout-package.*ETIMEDOUT/);
});
