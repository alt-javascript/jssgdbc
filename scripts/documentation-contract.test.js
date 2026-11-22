import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packages = ['core', 'memory', 'file', 'sparql', 'neo4j', 'dataset'];
const readmes = ['README.md', ...packages.map(p => `packages/${p}/README.md`)];
const docs = [...readmes, 'docs/breaking-changes.md', 'docs/jssgdbc-trajectory.md',
  'packages/core/test/CONFORMANCE.md', 'packages/core/test/STRING-TERMS.md'];
const read = path => readFileSync(resolve(root, path), 'utf8');
// Deliberately bounded to source documentation, never workflow artifacts.
const prose = text => text.replace(/```[^\n]*\n[\s\S]*?```/g, '');
const slug = text => text.toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
function checkLink(source, href) {
  if (/^(?:https?:|mailto:)/.test(href)) return;
  const [path, anchor] = href.split('#');
  const target = resolve(root, dirname(source), decodeURIComponent(path || source.split('/').at(-1)));
  const local = relative(root, target);
  assert(!local.startsWith('..') && !local.split('/').some(p => ['.gsd', '.planning', '.audits'].includes(p)), `non-source link: ${href}`);
  assert(existsSync(target), `${source}: missing ${href}`);
  if (anchor && target.endsWith('.md')) {
    const headings = [...prose(readFileSync(target, 'utf8')).matchAll(/^#{1,6}\s+(.+)$/gm)].map(m => slug(m[1]));
    assert(headings.includes(decodeURIComponent(anchor)), `${source}: missing anchor ${href}`);
  }
}

for (const path of docs) test(`relative links resolve: ${path}`, () => {
  for (const match of prose(read(path)).matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) checkLink(path, match[1]);
});

test('link guard rejects missing paths, anchors and workflow artifacts', () => {
  for (const href of ['absent-doc.md', 'README.md#absent-heading', '.gsd/STATE.md', '../outside.md']) {
    assert.throws(() => checkLink('README.md', href));
  }
});

test('every public README links the migration guide', () => {
  for (const path of readmes) assert.match(read(path), /\]\((?:\.\.\/\.\.\/)?docs\/breaking-changes\.md\)/, path);
});

test('migration guide preserves critical persistence and recovery boundaries', () => {
  const guide = read('docs/breaking-changes.md');
  for (const pattern of [/RDF\/JS/, /NamedNode\/DefaultGraph/, /nonempty/, /local.*never write/i,
    /DatasetSaveError/, /cause/, /committed/, /unknown/, /not-attempted/, /reconcile/,
    /not automatically retry/, /isomorphism/, /not idempotent/, /version: 1/,
    /single-writer/, /no fsync/, /per-graph managed transaction/, /endpoint-dependent/,
    /O\(quads/, /backpressure/, /canonicalization/, /containment/, /Docker/,
    /never a skip/, /npm run test:conformance/, /npm run test:docs/]) assert.match(guide, pattern);
  assert.match(guide, /\| Blank-node graph names, RDF-star, Variable storage \| unavailable \| unavailable \| unavailable \| unavailable \|/);
  assert.match(guide, /\| Streaming, duplicate quads \| unavailable \| unavailable \| unavailable \| unavailable \|/);
});

test('historical string guidance is explicitly superseded and roadmap stays historical', () => {
  assert.match(read('packages/core/test/STRING-TERMS.md'), /Superseded historical M005 contract/);
  assert.match(read('packages/core/test/CONFORMANCE.md'), /superseded/);
  assert.match(read('packages/core/test/CONFORMANCE.md'), /strings are rejected/);
  const trajectory = read('docs/jssgdbc-trajectory.md');
  assert.match(trajectory, /Current experimental baseline \(M006 implementation\)/);
  assert.match(trajectory, /## Historical scan/);
  assert.match(trajectory, /Later milestone proposals below remain proposals, not shipped features/);
  for (const path of ['packages/core/README.md', 'packages/memory/README.md']) {
    assert.doesNotMatch(read(path), /remain migration work|still need typed terms|currently exposes unmigrated/);
  }
});

test('root quickstart uses typed values rather than legacy string Graph calls', () => {
  const source = read('README.md').match(/<!-- example:memory-quickstart -->\s*```javascript\n([\s\S]*?)```/)?.[1];
  assert(source);
  assert.match(source, /@rdfjs\/data-model/);
  assert.match(source, /rdf\.namedNode/);
  assert.match(source, /rdf\.literal/);
  assert.doesNotMatch(source, /\.(?:add|find|has|remove|getGraph)\(\s*['"`]/);
  assert.match(source, /await client\.close\(\)/);
});
