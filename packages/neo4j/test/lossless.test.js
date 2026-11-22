import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultGraph, XSD_STRING, RDF_LANG_STRING, termKey } from '@alt-javascript/jssgdbc-core';
import { CypherBuilder as B } from '../CypherBuilder.js';
import { decodeTerm, graphKey } from '../RdfStorage.js';
const nn = value => ({ termType: 'NamedNode', value });
const lit = (value, datatype = XSD_STRING, language = '') => ({ termType: 'Literal', value, language, datatype: nn(datatype) });

test('Lossless typed contract: parameters and codec preserve identity and lexical content (not live proof)', () => {
  for (const object of [nn('urn:o'), lit('urn:o'), lit('001', 'http://www.w3.org/2001/XMLSchema#integer'), lit('mail@example.org^^type'), lit('bonjour', RDF_LANG_STRING, 'fr')]) {
    const { params } = B.buildAdd(defaultGraph(), nn('urn:s'), nn('urn:p'), object);
    assert.equal(params.object.value, object.value);
    assert.equal(params.object.termType, object.termType);
    assert.equal(B.buildFind(defaultGraph(), null, null, object).params.object, termKey(object));
    assert.equal(termKey(decodeTerm({ ...params.object, graph: graphKey() })), termKey(object));
  }
});
test('Lossless typed contract: equivalent independent terms share keys; no language rewriting', () => {
  assert.equal(B.buildAdd(defaultGraph(), nn('urn:s'), nn('urn:p'), lit('text')).params.object.key,
    B.buildAdd(defaultGraph(), nn('urn:s'), nn('urn:p'), lit('text', XSD_STRING)).params.object.key);
  assert.throws(() => B.buildAdd(defaultGraph(), nn('urn:s'), nn('urn:p'), lit('bonjour', RDF_LANG_STRING, 'FR')));
});
test('Lossless typed contract: rejects obsolete strings and malformed literal structure', () => {
  for (const value of ['"unterminated', { termType: 'Literal', value: 'text' }]) {
    assert.throws(() => B.buildAdd(defaultGraph(), nn('urn:s'), nn('urn:p'), value));
  }
});
