import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packages = ['core', 'memory', 'file', 'sparql', 'neo4j', 'dataset'];
const readmes = ['README.md', ...packages.map(p => `packages/${p}/README.md`)];
const docs = [...readmes, 'packages/neo4j/SCHEMA.md',
  'packages/core/test/CONFORMANCE.md', 'packages/core/test/STRING-TERMS.md',
  'packages/core/test/TYPED-TERMS.md', 'packages/core/test/DATASET-PERSISTENCE.md'];
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

test('every public README describes its module', () => {
  for (const path of readmes) {
    assert.match(read(path), /^# /, path);
    assert.match(read(path), /```(?:javascript|js)\n/, `${path}: usage example`);
  }
});

test('module documentation preserves critical persistence and recovery boundaries', () => {
  const guide = docs.map(read).join('\n');
  for (const pattern of [/RDF\/JS/, /NamedNode/, /DefaultGraph/, /nonempty|non-empty/,
    /DatasetSaveError/, /cause/, /committed/, /unknown/, /not-attempted/, /reconcil/i,
    /isomorph/i, /idempoten/i, /single.writer|no multiwriter|no.*writer coordination/i, /fsync/, /managed transaction/,
    /endpoint-dependent/, /backpressure/, /canonicalization/, /containment/, /Docker/,
    /npm run test:conformance/]) assert.match(guide, pattern);
});

test('public docs describe implemented APIs without planning or project-directory content', () => {
  for (const path of docs) {
    const text = read(path);
    assert.doesNotMatch(text, /\bM00\d\b|\broadmap\b|\bmilestone\b|\bhandoff\b|\.gsd\/|docs\/(?:jssgdbc-trajectory|breaking-changes)\.md/i, path);
    assert.doesNotMatch(text, /^#{1,6}\s+(?:Repository|Project)\s+(?:layout|structure|directory)/im, path);
  }
  for (const path of ['docs/breaking-changes.md', 'docs/jssgdbc-trajectory.md',
    'handoff/jssgdbc-next-session-prompt.md']) {
    assert.equal(existsSync(resolve(root, path)), false, `${path} is not public API documentation`);
  }
});

test('root quickstart uses typed values rather than legacy string Graph calls', () => {
  const source = read('README.md').match(/<!-- example:memory-quickstart -->\s*```(?:javascript|js)\n([\s\S]*?)```/)?.[1];
  assert(source);
  assert.match(source, /@rdfjs\/data-model|from ['"]n3['"]/);
  assert.match(source, /\bnamedNode\(/);
  assert.match(source, /\bliteral\(/);
  assert.doesNotMatch(source, /\.(?:add|find|has|remove|getGraph)\(\s*['"`]/);
  assert.match(source, /await client\.close\(\)/);
});
