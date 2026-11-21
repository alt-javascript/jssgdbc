import test from 'node:test';
import assert from 'node:assert/strict';
import { CypherBuilder } from '../index.js';

const query = 'MERGE (s:JssgdbcTerm {graph: $graph, kind: $subjectKind, value: $subject})\n'
  + 'MERGE (o:JssgdbcTerm {graph: $graph, kind: $objectKind, value: $object})\n'
  + 'MERGE (s)-[r:JSSGDBC_TRIPLE {predicate: $predicate}]->(o)';

const subjects = [['s', 'iri'], ['<urn:s>', 'iri'], ['_:s', 'blank'], ['', 'iri']];
const objects = [['o', 'iri'], ['<urn:o>', 'iri'], ['_:o', 'blank'], ['', 'iri'],
  ['"hello"', 'literal'], ['"hello"@en', 'literal'], ['"1"^^<urn:type>', 'literal'],
  ["'quoted'", 'literal'], ['"unfinished', 'literal']];
for (const graph of [undefined, null, '', 'named']) {
  for (const [subject, subjectKind] of subjects) {
    for (const [object, objectKind] of objects) {
      test(`buildAdd fixture ${JSON.stringify([graph, subject, object])}`, () => {
        assert.deepEqual(CypherBuilder.buildAdd(graph, subject, 'p', object), {
          query, params: { graph: graph ?? '', subjectKind, subject, predicate: 'p', objectKind, object },
        });
      });
    }
  }
}

test('empty predicate remains concrete; bare and bracketed spellings stay distinct', () => {
  assert.deepEqual(CypherBuilder.buildAdd('', '', '', ''), {
    query, params: { graph: '', subjectKind: 'iri', subject: '', predicate: '', objectKind: 'iri', object: '' },
  });
  assert.notDeepEqual(CypherBuilder.buildAdd('', 's', 'p', 'o').params,
    CypherBuilder.buildAdd('', '<s>', '<p>', '<o>').params);
});

test('hostile strings in every position remain parameters, never Cypher text', () => {
  const payloads = ['x`}) MATCH (n) DETACH DELETE n //', 'x\nRETURN 42; //', 'x\\\"\u0000雪'];
  for (const payload of payloads) {
    for (let position = 0; position < 4; position++) {
      const args = ['graph', 'subject', 'predicate', 'object'];
      args[position] = payload;
      const result = CypherBuilder.buildAdd(...args);
      assert.equal(result.query, query);
      assert.equal(result.params[['graph', 'subject', 'predicate', 'object'][position]], payload);
      assert.equal(result.query.includes(payload), false);
    }
  }
});

const positions = ['graphName', 'subject', 'predicate', 'object'];
for (let position = 0; position < 4; position++) {
  test(`buildAdd rejects invalid ${positions[position]} without coercion or value disclosure`, () => {
    const invalid = [0, false, NaN, 1n, Symbol('secret'), [], {}, new String('secret'),
      { toString() { throw new Error('must not coerce'); } }];
    if (position > 0) invalid.push(null, undefined);
    for (const value of invalid) {
      const args = ['g', 's', 'p', 'o'];
      args[position] = value;
      assert.throws(() => CypherBuilder.buildAdd(...args), {
        name: 'TypeError',
        message: `buildAdd: ${positions[position]} (argument ${position + 1}) must be a string`,
      });
    }
  });
}

test('missing add terms report the first missing position', () => {
  for (let length = 1; length < 4; length++) {
    assert.throws(() => CypherBuilder.buildAdd(...['g', 's', 'p', 'o'].slice(0, length)), {
      name: 'TypeError', message: `buildAdd: ${positions[length]} (argument ${length + 1}) must be a string`,
    });
  }
  assert.throws(() => CypherBuilder.buildAdd(), /buildAdd: subject \(argument 2\)/);
});

test('literal subjects and literal or blank predicates are rejected with redacted errors', () => {
  for (const value of ['"secret"', "'secret'"]) {
    assert.throws(() => CypherBuilder.buildAdd('', value, 'p', 'o'), {
      name: 'TypeError', message: 'buildAdd: subject (argument 2) must be an IRI or blank node',
    });
  }
  for (const value of ['"secret"', "'secret'", '_:secret']) {
    assert.throws(() => CypherBuilder.buildAdd('', 's', value, 'o'), {
      name: 'TypeError', message: 'buildAdd: predicate (argument 3) must be an IRI',
    });
  }
});

test('each call returns fresh result and params and does not mutate arguments', () => {
  const args = Object.freeze(['g', '_:s', 'p', '"o"']);
  const first = CypherBuilder.buildAdd(...args);
  const second = CypherBuilder.buildAdd(...args);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.notEqual(first.params, second.params);
  first.params.graph = 'changed';
  assert.equal(second.params.graph, 'g');
  assert.deepEqual(args, ['g', '_:s', 'p', '"o"']);
});

test('large values do not grow the statement text', () => {
  const object = '"' + 'x'.repeat(100000);
  assert.deepEqual(CypherBuilder.buildAdd('g', 's', 'p', object), {
    query, params: { graph: 'g', subjectKind: 'iri', subject: 's', predicate: 'p', objectKind: 'literal', object },
  });
});
