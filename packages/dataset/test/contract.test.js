import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import rdf, { Dataset } from '../index.js'

const require = createRequire(import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')

// Inventory audited against Dataset 1.0 IDL at 4bb0ed9b0180c4790f58bd1e3df1967c4eee0a86.
const members = ['add', 'delete', 'has', 'match', 'addAll', 'contains', 'deleteMatches',
  'difference', 'equals', 'every', 'filter', 'forEach', 'import', 'intersection',
  'map', 'reduce', 'some', 'toCanonical', 'toStream', 'toString', 'union']

test('pinned normative method inventory and documented return contracts are complete', () => {
  assert.deepEqual(Object.getOwnPropertyNames(Dataset.prototype).filter(x => !['constructor', 'size'].includes(x)).sort(), [...members].sort())
  const d = rdf.dataset()
  for (const member of [...members, 'size', 'Symbol.iterator', 'dataset']) assert.ok(readme.includes(`| ${member} |`), member)
  for (const member of members) assert.equal(typeof d[member], 'function')
  assert.equal(typeof d[Symbol.iterator], 'function')
  assert.equal(typeof d.size, 'number')
  for (const name of ['match', 'filter', 'map', 'difference', 'intersection', 'union']) {
    const result = ['filter', 'map'].includes(name) ? d[name](x => x) : name === 'match' ? d.match() : d[name](rdf.dataset())
    assert.ok(result instanceof Dataset); assert.notEqual(result, d)
  }
})

test('exact installed releases and license files match audited selections', () => {
  const expected = {
    '@rdfjs/dataset': ['2.0.3', 'MIT'], '@rdfjs/data-model': ['2.1.2', 'MIT'],
    '@rdfjs/normalize': ['2.0.4', 'MIT'], '@rdfjs/to-ntriples': ['3.0.1', 'MIT'],
    'rdf-canonize': ['5.0.0', 'BSD-3-Clause'], n3: ['2.13.12', 'MIT']
  }
  for (const [name, [version, license]] of Object.entries(expected)) {
    let dir = dirname(require.resolve(name))
    while (!existsSync(join(dir, 'package.json'))) {
      const parent = dirname(dir); assert.notEqual(parent, dir); dir = parent
    }
    const installed = JSON.parse(readFileSync(join(dir, 'package.json')))
    assert.equal(installed.name, name); assert.equal(installed.version, version); assert.equal(installed.license, license)
    assert.equal((manifest.dependencies ?? {})[name] ?? manifest.devDependencies[name], version)
    const licenseFile = readdirSync(dir).find(x => /^licen[cs]e(\..*)?$/i.test(x))
    assert.ok(licenseFile, name)
    assert.ok(readFileSync(join(dir, licenseFile), 'utf8').includes(license === 'MIT' ? 'Permission is hereby granted' : 'Redistribution and use'))
  }
})

test('optional workspace is private, export-resolvable, publish guarded and absent from core dependencies', () => {
  assert.equal(manifest.private, true)
  assert.equal(manifest.sideEffects, false)
  assert.equal(manifest.exports['.'].import, './index.js')
  assert.equal(require.resolve(manifest.name), require.resolve('../index.js'))
  for (const name of ['core', 'memory']) {
    const other = JSON.parse(readFileSync(new URL(`../../${name}/package.json`, import.meta.url)))
    assert.deepEqual(other.dependencies ?? {}, name === 'core' ? {} : { '@alt-javascript/jssgdbc-core': '0.0.0' })
  }
  const guard = spawnSync(process.execPath, ['../../scripts/prevent-publish.js'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' })
  assert.equal(guard.status, 1)
  assert.match(guard.stderr + guard.stdout, /private|publication|publish/i)
})
