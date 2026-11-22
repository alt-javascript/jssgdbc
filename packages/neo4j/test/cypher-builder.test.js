import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultGraph, termKey, XSD_STRING, RDF_LANG_STRING } from '@alt-javascript/jssgdbc-core';
import { CypherBuilder as B } from '../index.js';
import { encodeTerm, decodeTerm, graphKey, STORAGE_VERSION, STORAGE_PROFILE, CONSTRAINTS } from '../RdfStorage.js';
import './lossless.test.js';

const nn = value => ({ termType: 'NamedNode', value });
const bn = value => ({ termType: 'BlankNode', value });
const lit = (value, datatype = XSD_STRING, language = '') => ({ termType: 'Literal', value, language, datatype: nn(datatype) });
const graphs = [undefined, defaultGraph(), nn('urn:g')];
const subjects = [nn('urn:s'), bn('s')];
const objects = [nn('urn:o'), bn('o'), lit('hello'), lit('hello', RDF_LANG_STRING, 'en'), lit('01', 'urn:type')];
const addQuery = `MERGE (s:JssgdbcRdfTerm {graph: $graph, key: $subject.key})
ON CREATE SET s += $subject
MERGE (o:JssgdbcRdfTerm {graph: $graph, key: $object.key})
ON CREATE SET o += $object
MERGE (s)-[r:JSSGDBC_RDF_TRIPLE {predicate: $predicate}]->(o)`;
const match = 'MATCH (s:JssgdbcRdfTerm {graph: $graph})-[r:JSSGDBC_RDF_TRIPLE]->(o:JssgdbcRdfTerm {graph: $graph})';
const endings = { buildFind: 'RETURN properties(s) AS subject, r.predicate AS predicate, properties(o) AS object',
  buildHas: 'RETURN count(r) > 0 AS exists', buildCount: 'RETURN count(r) AS count', buildRemove: 'DELETE r' };
const wheres = ['', 's.key = $subject', 'r.predicate = $predicate', 's.key = $subject AND r.predicate = $predicate',
  'o.key = $object', 's.key = $subject AND o.key = $object', 'r.predicate = $predicate AND o.key = $object',
  's.key = $subject AND r.predicate = $predicate AND o.key = $object'];

for (const graph of graphs) for (const subject of subjects) for (const object of objects) {
  test(`typed CRUD ${JSON.stringify([graph, subject, object])}`, () => {
    const expected = term => ({ key: termKey(term), termType: term.termType, value: term.value,
      language: term.language ?? '', datatype: term.datatype?.value ?? '' });
    assert.deepEqual(B.buildAdd(graph, subject, nn('urn:p'), object), { query: addQuery,
      params: { graph: termKey(graph ?? defaultGraph()), subject: expected(subject), predicate: 'urn:p', object: expected(object) } });
    for (const [method, ending] of Object.entries(endings)) for (let mask = 0; mask < 8; mask++) {
      const terms = [subject, nn('urn:p'), object].map((term, i) => mask & (1 << i) ? term : null);
      const params = { graph: termKey(graph ?? defaultGraph()) };
      if (mask & 1) params.subject = termKey(subject);
      if (mask & 2) params.predicate = 'urn:p';
      if (mask & 4) params.object = termKey(object);
      const expected = { query: match + (wheres[mask] ? `\nWHERE ${wheres[mask]}` : '') + `\n${ending}`, params };
      assert.deepEqual(B[method](graph, ...terms), expected);
      assert.deepEqual(B[method](graph, ...terms.map(v => v ?? undefined)), expected);
    }
  });
}

test('typed identity: independent equals, lexical distinctions, graph collisions and cross-partition blanks', () => {
  assert.equal(STORAGE_VERSION, '1');
  assert.equal(STORAGE_PROFILE, 'rdfjs-structural-v1');
  assert.equal(CONSTRAINTS.length, 3);
  assert.notEqual(graphKey(), graphKey(nn('urn:default')));
  assert.throws(() => graphKey(nn('')), /absolute IRI/);
  assert.deepEqual(encodeTerm(lit('a')), encodeTerm(lit('a')));
  const variants = [nn('urn:o'), bn('urn:o'), lit('urn:o'), lit('01', 'urn:int'), lit('1', 'urn:int'), lit('01'), lit('a', RDF_LANG_STRING, 'en'), lit('a', RDF_LANG_STRING, 'fr')];
  assert.equal(new Set(variants.map(t => encodeTerm(t).key)).size, variants.length);
  for (const graph of graphs) {
    const record = { ...encodeTerm(bn('shared')), graph: graphKey(graph) };
    assert.equal(decodeTerm(record, graph).value, 'shared');
  }
});

test('all data stays in parameters, even hostile blank/literal text and huge values', () => {
  for (const payload of ['x`}) MATCH (n) DETACH DELETE n //', 'x\nRETURN 42; //', 'x\\"\u0000雪', 'x'.repeat(100000)]) {
    const args = [nn('urn:g'), bn(payload), nn('urn:p'), lit(payload)];
    for (const method of ['buildAdd', ...Object.keys(endings)]) {
      const first = B[method](...args), second = B[method](...args);
      assert.equal(first.query.includes(payload), false);
      assert.deepEqual(first, second);
      assert.notEqual(first.params, second.params);
      assert.equal(method === 'buildAdd' ? first.params.object.value : first.params.object, method === 'buildAdd' ? payload : termKey(lit(payload)));
      assert.equal(method === 'buildAdd' ? first.params.subject.value : first.params.subject, method === 'buildAdd' ? payload : termKey(bn(payload)));
      first.params.graph = 'changed';
      assert.equal(second.params.graph, graphKey(args[0]));
    }
    for (const position of [0, 2]) {
      const bad = [...args]; bad[position] = nn(payload);
      assert.throws(() => B.buildAdd(...bad), /absolute IRI/);
    }
  }
});

test('mutations have fixed connected graph scope and one reusable serialization lock', () => {
  for (const graph of graphs) {
    assert.deepEqual(B.buildClear(graph), { query: `${match}\nDELETE r`, params: { graph: graphKey(graph) } });
    assert.deepEqual(B.buildClear(graph), B.buildRemove(graph));
    for (const method of ['buildClear', 'buildRemove', 'buildFind', 'buildHas', 'buildCount']) {
      const { query } = B[method](graph);
      assert.equal((query.match(/graph: \$graph/g) ?? []).length, 2);
      assert.doesNotMatch(query, /DETACH|DELETE\s+[so]|\*|MATCH[^\n]*,\s*\(/);
    }
    assert.deepEqual(B.buildLock(graph), { query: 'MERGE (g:JssgdbcRdfGraph {key: $graph})\nSET g._jssgdbcLock = true\nREMOVE g._jssgdbcLock', params: { graph: graphKey(graph) } });
  }
});

test('invalid types, strings and RDF positions reject without coercion or payload echo', () => {
  for (const method of ['buildAdd', ...Object.keys(endings)]) for (let i = 0; i < 4; i++) {
    for (const value of [0, false, NaN, 1n, Symbol('secret'), [], {}, 'secret', new String('secret'), { toString() { throw Error('coercion'); } }]) {
      const args = [defaultGraph(), nn('urn:s'), nn('urn:p'), nn('urn:o')]; args[i] = value;
      assert.throws(() => B[method](...args), error => { assert.doesNotMatch(error.message, /secret|coercion/); return true; });
    }
  }
  for (const value of [null, '', bn('g'), lit('g')]) assert.throws(() => B.buildClear(value));
  for (const value of [lit('secret'), defaultGraph()]) assert.throws(() => B.buildAdd(defaultGraph(), value, nn('urn:p'), nn('urn:o')));
  for (const value of [lit('secret'), bn('secret')]) assert.throws(() => B.buildAdd(defaultGraph(), nn('urn:s'), value, nn('urn:o')));
  for (let length = 0; length < 4; length++) assert.throws(() => B.buildAdd(...[defaultGraph(), nn('urn:s'), nn('urn:p'), nn('urn:o')].slice(0, length)));
});

test('codec rejects corrupt persisted identity/partition/positions without echo', () => {
  const good = { ...encodeTerm(lit('secret')), graph: graphKey() };
  for (const record of [null, {}, { ...good, key: 'secret' }, { ...good, graph: graphKey(nn('urn:foreign')) },
    { ...good, value: 1 }, { ...good, language: 'FR' }, { ...good, datatype: '' },
    { ...encodeTerm(nn('urn:s')), graph: graphKey(), language: 'en' }]) {
    assert.throws(() => decodeTerm(record), { message: 'Neo4j RDF storage: invalid term record' });
  }
  assert.throws(() => decodeTerm(good, defaultGraph(), 'subject'));
});
