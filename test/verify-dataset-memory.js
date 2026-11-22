import assert from 'node:assert/strict';
import rdf from '@rdfjs/data-model';
import external from '@rdfjs/dataset';
import factory from '@alt-javascript/jssgdbc-dataset';
import { DriverManager, DatasetSaveError } from '@alt-javascript/jssgdbc-core';
import { MemoryClient } from '@alt-javascript/jssgdbc-memory';
import { datasetCompliance } from '../packages/core/test/datasetCompliance.js';

await datasetCompliance(await DriverManager.getClient('jssgdbc:memory:'), rdf, external, factory);
// Test-only fault injection models an adapter losing acknowledgement after writing.
const d = rdf.defaultGraph(), g = rdf.namedNode('urn:failure'), h = rdf.namedNode('urn:untouched');
const cause = Error('lost acknowledgement');
class Failing extends MemoryClient {
  _saveDatasetGraph(graph, quads, mode) {
    super._saveDatasetGraph(graph, quads, mode);
    if (graph.equals(g)) throw cause;
  }
}
const client = new Failing();
try {
  const input = external.dataset([d, g, h].map(graph => rdf.quad(rdf.namedNode('urn:s'), rdf.namedNode('urn:p'), rdf.literal('value'), graph)));
  await assert.rejects(client.saveDataset(input, { graphs: [d, g, h] }), error => {
    assert(error instanceof DatasetSaveError);
    assert.equal(error.cause, cause);
    assert.deepEqual(error.outcomes.map(o => o.status), ['committed', 'unknown', 'not-attempted']);
    return true;
  });
  assert.equal(await client.getGraph(g).count(), 1);
  assert.equal(await client.getGraph(h).count(), 0);
} finally { await client.close(); }
console.log('Memory typed Dataset interoperability and partial-failure contract passed; remote adapters not evaluated.');
