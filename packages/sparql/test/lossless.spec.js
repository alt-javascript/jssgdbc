import assert from 'node:assert/strict';
import { SparqlClient } from '../SparqlClient.js';

describe('Lossless string contract: SPARQL result boundary (deterministic)', () => {
  const uri = value => ({ type: 'uri', value });
  async function decode(objects) {
    const client = new SparqlClient(null, 'jssgdbc:sparql:http://localhost:1/');
    client._query = async () => ({ results: { bindings: objects.map(o => ({ s: uri('urn:s'), p: uri('urn:p'), o })) } });
    try { return (await client.getGraph().find()).getTriples().map(t => t.object); }
    finally { await client.close(); }
  }
  it('keeps equal-content IRI/literal distinct and typed leading zeroes intact', async () => {
    assert.deepEqual(await decode([uri('urn:o'), { type: 'literal', value: 'urn:o' },
      { type: 'literal', value: '001', datatype: 'http://www.w3.org/2001/XMLSchema#integer' },
      { type: 'literal', value: 'mail@example.org^^type' }]),
    ['urn:o', '"urn:o"', '"001"^^<http://www.w3.org/2001/XMLSchema#integer>', '"mail@example.org^^type"']);
  });
  it('canonicalizes RDF-equivalent string datatype and language tag case', async () => {
    assert.deepEqual(await decode([
      { type: 'literal', value: 'text', datatype: 'http://www.w3.org/2001/XMLSchema#string' },
      { type: 'literal', value: 'bonjour', 'xml:lang': 'FR' },
    ]), ['"text"', '"bonjour"@fr']);
  });
});
