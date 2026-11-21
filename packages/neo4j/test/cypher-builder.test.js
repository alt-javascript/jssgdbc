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

const match = 'MATCH (s:JssgdbcTerm {graph: $graph})-[r:JSSGDBC_TRIPLE]->(o:JssgdbcTerm {graph: $graph})';
const endings = {
  buildFind: 'RETURN s.value AS subject, r.predicate AS predicate, o.value AS object',
  buildHas: 'RETURN count(r) > 0 AS exists',
  buildCount: 'RETURN count(r) AS count',
  buildRemove: 'DELETE r',
};
// Explicit fixtures independent of the builder's filter-generation loop.
const patterns = [
  [[null, null, null], '', {}],
  [['s', null, null], 's.kind = $subjectKind AND s.value = $subject', { subjectKind: 'iri', subject: 's' }],
  [[null, 'p', null], 'r.predicate = $predicate', { predicate: 'p' }],
  [[null, null, 'o'], 'o.kind = $objectKind AND o.value = $object', { objectKind: 'iri', object: 'o' }],
  [['s', 'p', null], 's.kind = $subjectKind AND s.value = $subject AND r.predicate = $predicate', { subjectKind: 'iri', subject: 's', predicate: 'p' }],
  [['s', null, 'o'], 's.kind = $subjectKind AND s.value = $subject AND o.kind = $objectKind AND o.value = $object', { subjectKind: 'iri', subject: 's', objectKind: 'iri', object: 'o' }],
  [[null, 'p', 'o'], 'r.predicate = $predicate AND o.kind = $objectKind AND o.value = $object', { predicate: 'p', objectKind: 'iri', object: 'o' }],
  [['s', 'p', 'o'], 's.kind = $subjectKind AND s.value = $subject AND r.predicate = $predicate AND o.kind = $objectKind AND o.value = $object', { subjectKind: 'iri', subject: 's', predicate: 'p', objectKind: 'iri', object: 'o' }],
];
for (const [method, ending] of Object.entries(endings)) {
  for (const graph of [undefined, null, '', 'named']) {
    for (const [terms, where, params] of patterns) {
      test(`${method} wildcard fixture ${JSON.stringify([graph, ...terms])}`, () => {
        const expected = { query: match + (where ? `\nWHERE ${where}` : '') + `\n${ending}`, params: { graph: graph ?? '', ...params } };
        assert.deepEqual(CypherBuilder[method](graph, ...terms), expected);
        assert.deepEqual(CypherBuilder[method](graph, ...terms.map(v => v === null ? undefined : v)), expected);
      });
    }
  }

  test(`${method} exact term kinds, empty filters and distinct spellings`, () => {
    for (const [subject, subjectKind] of subjects) {
      for (const [object, objectKind] of objects) {
        assert.deepEqual(CypherBuilder[method]('', subject, '', object), {
          query: `${match}\nWHERE ${patterns[7][1]}\n${ending}`,
          params: { graph: '', subjectKind, subject, predicate: '', objectKind, object },
        });
      }
    }
    assert.notDeepEqual(CypherBuilder[method]('', 's', 'p', 'o').params,
      CypherBuilder[method]('', '<s>', '<p>', '<o>').params);
    assert.deepEqual(CypherBuilder[method](), { query: `${match}\n${ending}`, params: { graph: '' } });
  });

  test(`${method} rejects invalid concrete arguments and kinds with contextual redacted errors`, () => {
    for (let i = 0; i < 4; i++) {
      for (const value of [0, false, NaN, 1n, Symbol('secret'), [], {}, new String('secret'), { toString() { throw Error('coercion'); } }]) {
        const args = ['g', 's', 'p', 'o'];
        args[i] = value;
        assert.throws(() => CypherBuilder[method](...args), {
          name: 'TypeError', message: `${method}: ${positions[i]} (argument ${i + 1}) must be a string`,
        });
      }
    }
    for (const value of ['"secret"', "'secret'"]) {
      assert.throws(() => CypherBuilder[method]('', value), {
        name: 'TypeError', message: `${method}: subject (argument 2) must be an IRI or blank node`,
      });
    }
    for (const value of ['"secret"', "'secret'", '_:secret']) {
      assert.throws(() => CypherBuilder[method]('', null, value), {
        name: 'TypeError', message: `${method}: predicate (argument 3) must be an IRI`,
      });
    }
  });
}

for (const method of [...Object.keys(endings), 'buildClear']) {
  test(`${method} fixed connected scope, safe deletion, hostile values and fresh params`, () => {
    const base = CypherBuilder[method]('g', 's', 'p', 'o');
    assert.ok(base.query.startsWith(match));
    assert.equal((base.query.match(/graph: \$graph/g) ?? []).length, 2);
    assert.doesNotMatch(base.query, /DETACH|DELETE\s+[so]|\*|MATCH[^\n]*,\s*\(/);
    if (method === 'buildRemove' || method === 'buildClear') assert.ok(base.query.endsWith('\nDELETE r'));
    for (const payload of ['x`}) MATCH (n) DETACH DELETE n //', 'x\nRETURN 42; //', 'x\\"\u0000雪', 'x'.repeat(100000)]) {
      for (let i = 0; i < (method === 'buildClear' ? 1 : 4); i++) {
        const args = ['g', 's', 'p', 'o'];
        args[i] = payload;
        Object.freeze(args);
        const result = CypherBuilder[method](...args);
        assert.equal(result.query, base.query);
        assert.equal(result.query.includes(payload), false);
        assert.equal(result.params[['graph', 'subject', 'predicate', 'object'][i]], payload);
        const again = CypherBuilder[method](...args);
        assert.deepEqual(result, again);
        assert.notEqual(result, again);
        assert.notEqual(result.params, again.params);
        result.params.graph = 'changed';
        assert.equal(again.params.graph, args[0]);
        assert.equal(args[i], payload);
      }
    }
  });
}

test('buildClear only deletes scoped relationships, retaining orphan nodes', () => {
  for (const graph of [undefined, null, '', 'named']) {
    assert.deepEqual(CypherBuilder.buildClear(graph), { query: `${match}\nDELETE r`, params: { graph: graph ?? '' } });
    assert.deepEqual(CypherBuilder.buildClear(graph), CypherBuilder.buildRemove(graph));
  }
  for (const graph of [0, false, [], {}, Symbol('secret'), new String('secret')]) {
    assert.throws(() => CypherBuilder.buildClear(graph), {
      name: 'TypeError', message: 'buildClear: graphName (argument 1) must be a string',
    });
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
