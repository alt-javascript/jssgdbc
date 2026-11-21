import test from 'node:test';
import assert from 'node:assert/strict';
import { CypherBuilder as B } from '../CypherBuilder.js';

test('Lossless string contract: Neo4j parameters preserve identity and lexical content (not live proof)', () => {
  for (const object of ['urn:o', '"urn:o"', '"001"^^<http://www.w3.org/2001/XMLSchema#integer>', '"mail@example.org^^type"']) {
    const { params } = B.buildAdd('', 'urn:s', 'urn:p', object);
    assert.equal(params.object, object);
    assert.equal(params.objectKind, object.startsWith('"') ? 'literal' : 'iri');
    assert.equal(B.buildFind('', null, null, object).params.object, object);
  }
});
test('Lossless string contract: Neo4j canonicalizes equivalent strings', () => {
  assert.equal(B.buildAdd('', 'urn:s', 'urn:p', '"text"^^<http://www.w3.org/2001/XMLSchema#string>').params.object, '"text"');
  assert.equal(B.buildAdd('', 'urn:s', 'urn:p', '"bonjour"@FR').params.object, '"bonjour"@fr');
});
test('Lossless string contract: Neo4j rejects malformed literal syntax', () => {
  assert.throws(() => B.buildAdd('', 'urn:s', 'urn:p', '"unterminated'));
});
