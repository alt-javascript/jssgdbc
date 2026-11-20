import assert from 'node:assert/strict';
import { Cursor, Graph } from '@alt-javascript/jssgdbc-core';
import { SparqlClient } from '../SparqlClient.js';
import { SparqlGraph } from '../SparqlGraph.js';
import { SparqlBuilder as B } from '../SparqlBuilder.js';

const uri = value => ({ type: 'uri', value });
const literal = value => ({ type: 'literal', value });
const results = (...rows) => ({ head: { vars: ['s', 'p', 'o'] }, results: { bindings: rows } });
function fixture(name = '') {
  const client = new SparqlClient(null, 'jssgdbc:sparql:http://localhost:1/');
  const calls = [];
  let response = results();
  client._query = async text => { calls.push(['query', text]); return response; };
  client._update = async text => { calls.push(['update', text]); return 'ignored'; };
  return { client, graph: client.getGraph(name), calls, respond: value => { response = value; } };
}

describe('SparqlGraph', () => {
  it('uses core Graph and inherited named/default caching', () => {
    const { client, graph } = fixture();
    assert.ok(graph instanceof Graph);
    assert.ok(graph instanceof SparqlGraph);
    assert.equal(client.getGraph(), graph);
    assert.equal(graph.getName(), '');
    assert.equal(client.getGraph('urn:g'), client.getGraph('urn:g'));
    assert.notEqual(client.getGraph('urn:g'), graph);
    assert.equal(client.getGraph('urn:g').getName(), 'urn:g');
  });

  for (const name of ['', 'urn:g']) {
    it(`routes all operations through builders for ${name || 'default'}`, async () => {
      const f = fixture(name);
      const terms = ['urn:s', 'urn:p', '"object"'];
      f.respond(results({}));
      await f.graph.find(...terms);
      f.respond({ boolean: false });
      assert.equal(await f.graph.has(...terms), false);
      f.respond(results({ count: literal('0') }));
      assert.equal(await f.graph.count(...terms), 0);
      assert.equal(await f.graph.add(...terms), undefined);
      assert.equal(await f.graph.remove(...terms), undefined);
      assert.equal(await f.graph.remove(null, terms[1]), undefined);
      assert.equal(await f.graph.clear(), undefined);
      assert.deepEqual(f.calls, [
        ['query', B.buildSelect(name, ...terms)], ['query', B.buildAsk(name, ...terms)],
        ['query', B.buildCount(name, ...terms)], ['update', B.buildInsertData(name, ...terms)],
        ['update', B.buildDelete(name, ...terms)], ['update', B.buildDelete(name, null, terms[1])],
        ['update', B.buildClear(name)]
      ]);
    });
  }

  for (let mask = 0; mask < 8; mask++) {
    for (const wild of [null, undefined]) {
      it(`reconstructs bound positions mask=${mask}, wildcard=${wild}`, async () => {
        const f = fixture();
        const bound = ['<urn:s>', 'urn:p', '"hello"@en'];
        const variables = ['s', 'p', 'o'];
        const pattern = bound.map((term, i) => mask & (1 << i) ? term : wild);
        const row = Object.fromEntries(variables.flatMap((v, i) => mask & (1 << i) ? [] : [[v, uri(`urn:${v}`)]]));
        f.respond(results(row));
        const cursor = await f.graph.find(...pattern);
        assert.ok(cursor instanceof Cursor);
        assert.throws(() => cursor.getTriple(), /out of bounds/);
        assert.equal(await cursor.next(), true);
        assert.deepEqual(cursor.getTriple(), Object.fromEntries(['subject', 'predicate', 'object'].map((key, i) =>
          [key, mask & (1 << i) ? bound[i] : `urn:${variables[i]}`])));
        assert.equal(await cursor.next(), false);
      });
    }
  }

  it('preserves false, zero and empty string as bound values', async () => {
    const f = fixture();
    f.respond(results({}));
    assert.deepEqual((await f.graph.find(false, 0, '')).getTriples(), [{ subject: false, predicate: 0, object: '' }]);
  });

  it('decodes URI, blank nodes, escaped literals, language and datatype with async iteration', async () => {
    const f = fixture();
    const terms = [
      [uri('urn:o'), 'urn:o'],
      [{ type: 'bnode', value: 'b1' }, '_:b1'],
      [literal('"\\\n\r\t\b\f\u0000\u001f\u007f\u0085'), '"\\"\\\\\\n\\r\\t\\u0008\\u000C\\u0000\\u001F\\u007F\\u0085"'],
      [{ ...literal('bonjour'), 'xml:lang': 'fr-CA' }, '"bonjour"@fr-CA'],
      [{ ...literal('1'), datatype: 'urn:type' }, '"1"^^<urn:type>'],
      [{ type: 'typed-literal', value: '2', datatype: 'urn:type' }, '"2"^^<urn:type>'],
      [{ ...literal('hi'), 'xml:lang': 'en', datatype: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString' }, '"hi"@en'],
      [literal('雪'), '"雪"']
    ];
    f.respond(results(...terms.map(([o]) => ({ s: uri('urn:s'), p: uri('urn:p'), o }))));
    const cursor = await f.graph.find();
    const collected = [];
    for await (const triple of cursor) collected.push(triple.object);
    assert.deepEqual(collected, terms.map(([, expected]) => expected));
    cursor.close();
    await assert.rejects(cursor.next(), /Cursor is closed/);
    assert.throws(() => cursor.getTriple(), /Cursor is closed/);
  });

  it('handles empty results and detached core cursor lifecycle', async () => {
    const f = fixture();
    assert.equal(await (await f.graph.find()).next(), false);
    f.respond(results({}));
    const cursor = await f.graph.find('s', 'p', 'o');
    f.client.close();
    assert.equal(await cursor.next(), true);
  });

  it('rejects malformed SELECT shapes and missing/unsupported bindings with redaction', async () => {
    const f = fixture();
    const badTerms = [null, [], {}, { type: 'uri', value: 5 }, { type: 'triple', value: 'SECRET' },
      { type: 'literal', value: 'SECRET', 'xml:lang': 42 },
      { type: 'literal', value: 'SECRET', 'xml:lang': '' },
      { type: 'literal', value: 'SECRET', datatype: {} },
      { type: 'typed-literal', value: 'SECRET' }];
    const malformed = [null, [], {}, { results: null }, { results: { bindings: {} } }, results(null), results([]), results({}),
      ...badTerms.map(o => results({ s: uri('urn:s'), p: uri('urn:p'), o }))];
    for (const response of malformed) {
      f.respond(response);
      await assert.rejects(f.graph.find(), { message: 'SPARQL SELECT: invalid result' });
    }
    f.respond(results({ extra: { type: 'triple', value: 'SECRET' } }));
    await assert.rejects(f.graph.find('s', 'p', 'o'), /SELECT: invalid result/);
  });

  it('accepts only strict ASK booleans', async () => {
    const f = fixture();
    for (const boolean of [true, false]) {
      f.respond({ boolean });
      assert.equal(await f.graph.has(), boolean);
    }
    for (const response of [null, {}, [], { boolean: 0 }, { boolean: 'false' }]) {
      f.respond(response);
      await assert.rejects(f.graph.has(), { message: 'SPARQL ASK: invalid result' });
    }
  });

  it('accepts nonnegative safe COUNT integers and rejects malformed aggregates', async () => {
    const f = fixture();
    for (const value of ['0', '+1', '42', String(Number.MAX_SAFE_INTEGER)]) {
      f.respond(results({ count: literal(value) }));
      assert.equal(await f.graph.count(), Number(value));
    }
    for (const response of [null, {}, results(), results({}), results({ count: literal('1') }, { count: literal('2') }),
      results({ count: uri('1') }), ...['-1', '1.5', 'NaN', 'Infinity', '', ' ', '1e2', '9007199254740992', 'SECRET'].map(value => results({ count: literal(value) }))]) {
      f.respond(response);
      await assert.rejects(f.graph.count(), { message: 'SPARQL COUNT: invalid result' });
    }
  });

  it('guards INSERT wildcards without sending updates', async () => {
    const f = fixture();
    for (let i = 0; i < 3; i++) {
      for (const value of [null, undefined]) {
        const terms = ['s', 'p', 'o'];
        terms[i] = value;
        await assert.rejects(f.graph.add(...terms), /INSERT DATA requires bound/);
      }
    }
    assert.deepEqual(f.calls, []);
  });

  for (const handle of ['graph', 'client']) {
    it(`rejects every operation after ${handle} closure before transport`, async () => {
      const f = fixture();
      f[handle].close();
      for (const method of ['find', 'has', 'count', 'add', 'remove', 'clear']) {
        await assert.rejects(f.graph[method]('s', 'p', 'o'), /closed/);
      }
      assert.deepEqual(f.calls, []);
    });
  }

  it('bubbles sanitized transport failures without retrying', async () => {
    const f = fixture();
    let calls = 0;
    f.client._query = async () => { calls++; throw new Error('SPARQL query: timeout failure'); };
    f.client._update = async () => { calls++; throw new Error('SPARQL update: HTTP 503 failure'); };
    for (const method of ['find', 'has', 'count']) await assert.rejects(f.graph[method](), /query: timeout/);
    for (const method of ['add', 'remove', 'clear']) await assert.rejects(f.graph[method]('s', 'p', 'o'), /update: HTTP 503/);
    assert.equal(calls, 6);
  });
});
