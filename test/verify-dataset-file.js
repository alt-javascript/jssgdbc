import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import rdf from '@rdfjs/data-model';
import external from '@rdfjs/dataset';
import factory from '@alt-javascript/jssgdbc-dataset';
import '@alt-javascript/jssgdbc-file';
import { DriverManager } from '@alt-javascript/jssgdbc-core';

const directory = await mkdtemp(join(await realpath(process.cwd()), '.verify-dataset-file-'));
const url = `jssgdbc:file:${directory}`;
const d = rdf.defaultGraph(), g = rdf.namedNode('urn:g'), h = rdf.namedNode('urn:h');
const unrelated = rdf.namedNode('urn:unrelated');
const s = rdf.namedNode('urn:s'), p = rdf.namedNode('urn:p'), b = rdf.blankNode('shared');
const integer = rdf.namedNode('http://www.w3.org/2001/XMLSchema#integer');
const input = external.dataset([
  rdf.quad(b, p, b, d), rdf.quad(b, p, rdf.literal('hello', 'en'), g),
  rdf.quad(s, p, b, h), rdf.quad(s, p, rdf.literal('01', integer), d),
  rdf.quad(s, p, rdf.literal('1', integer), d)
]);
let client;
try {
  client = await DriverManager.getClient(url);
  await client.getGraph(unrelated).add(b, p, s);
  await client.saveDataset(input, { graphs: [d, g, h], mode: 'merge' });
  await client.close();
  client = await DriverManager.getClient(url);
  const loaded = await client.loadDataset({ graphs: [d, g, h], factory });
  assert(loaded.equals(input), 'reopen preserves isomorphism, shared blanks and lexical distinctions');
  loaded.deleteMatches();
  assert.equal((await client.loadDataset({ graphs: [d, g, h], factory })).size, 5, 'edits stay local');
  await client.saveDataset(input, { graphs: [d, g, h], mode: 'merge' });
  const merged = await client.loadDataset({ graphs: [d, g, h], factory });
  assert.equal(merged.size, 8);
  assert.equal(new Set([...merged].filter(q => q.subject.termType === 'BlankNode').map(q => q.subject.value)).size, 2);
  await client.saveDataset(input, { graphs: [d, g, h], mode: 'replace' });
  await client.close();
  client = await DriverManager.getClient(url);
  assert((await client.loadDataset({ graphs: [d, g, h], factory })).equals(input));
  await client.saveDataset([], { graphs: [g], mode: 'replace' });
  assert.equal(await client.getGraph(g).count(), 0);
  assert.equal(await client.getGraph(d).count(), 3);
  assert.equal(await client.getGraph(h).count(), 1);
  assert(await client.getGraph(unrelated).has(b, p, s));
  assert.equal([...input][0].subject.value, 'shared', 'external input is unchanged');
} finally {
  try { await client?.close(); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
console.log('File typed Dataset persistence passed; remote adapters not evaluated.');
