import { n, b, l, d, q } from './helpers/terms.js';
import assert from 'node:assert/strict';
import { Cursor, Graph } from '@alt-javascript/jssgdbc-core';
import { SparqlClient } from '../SparqlClient.js';
import { SparqlGraph } from '../SparqlGraph.js';
import { SparqlBuilder as B } from '../SparqlBuilder.js';

const uri = value => ({ type: 'uri', value });
const literal = value => ({ type: 'literal', value });
const integer = value => ({ type: 'literal', value, datatype: 'http://www.w3.org/2001/XMLSchema#integer' });
const counts = (...rows) => ({ head: { vars: ['count'] }, results: { bindings: rows } });
const results = (...rows) => ({ head: { vars: ['s', 'p', 'o'] }, results: { bindings: rows } });
function fixture(name = d()) {
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
    assert.deepEqual(graph.getName(), d());
    assert.equal(client.getGraph(n('urn:g')), client.getGraph(n('urn:g')));
    assert.notEqual(client.getGraph(n('urn:g')), graph);
    assert.deepEqual(client.getGraph(n('urn:g')).getName(), n('urn:g'));
  });

  for (const name of [d(), n('urn:g')]) {
    it(`routes all operations through builders for ${name || 'default'}`, async () => {
      const f = fixture(name);
      const terms = [n('urn:s'), n('urn:p'), l('object')];
      f.respond(results({}));
      await f.graph.find(...terms);
      f.respond({ boolean: false });
      assert.equal(await f.graph.has(...terms), false);
      f.respond(counts({ count: integer('0') }));
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
        const bound = [n('urn:s'), n('urn:p'), l('hello', 'en')];
        const variables = ['s', 'p', 'o'];
        const pattern = bound.map((term, i) => mask & (1 << i) ? term : wild);
        const row = Object.fromEntries(variables.flatMap((v, i) => mask & (1 << i) ? [] : [[v, uri(`urn:${v}`)]]));
        f.respond(results(row));
        const cursor = await f.graph.find(...pattern);
        assert.ok(cursor instanceof Cursor);
        assert.throws(() => cursor.getTriple(), /out of bounds/);
        assert.equal(await cursor.next(), true);
        assert.deepEqual(cursor.getTriple(), q(...variables.map((v, i) => mask & (1 << i) ? bound[i] : n(`urn:${v}`))));
        assert.equal(await cursor.next(), false);
      });
    }
  }

  it('rejects false, zero and empty string as bound values', async () => {
    const f = fixture();
    f.respond(results({}));
    await assert.rejects(f.graph.find(false, 0, ''), TypeError);
    assert.deepEqual(f.calls, []);
  });

  it('decodes URI, blank nodes, escaped literals, language and datatype with async iteration', async () => {
    const f = fixture();
    const terms = [
      [uri('urn:o'), n('urn:o')],
      [literal('"\\\n\r\t\b\f\u0000\u001f\u007f\u0085'), l('"\\\n\r\t\b\f\u0000\u001f\u007f\u0085')],
      [{ ...literal('bonjour'), 'xml:lang': 'fr-CA' }, l('bonjour', 'fr-ca')],
      [{ ...literal('1'), datatype: 'urn:type' }, l('1', '', 'urn:type')],
      [{ type: 'typed-literal', value: '2', datatype: 'urn:type' }, l('2', '', 'urn:type')],
      [{ ...literal('hi'), 'xml:lang': 'en', datatype: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString' }, l('hi', 'en')],
      [literal('雪'), l('雪')]
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

  it('scopes blank labels across all positions and rows of one response only', async () => {
    const f = fixture(n('urn:g'));
    const blank = value => ({ type: 'bnode', value });
    f.respond(results(
      { s: blank('a'), p: uri('urn:p'), o: blank('a') },
      { s: blank('a'), p: uri('urn:p'), o: blank('b') }));
    const first = (await f.graph.find()).getTriples();
    const second = (await f.graph.find()).getTriples();
    assert.ok(first[0].subject.equals(first[0].object));
    assert.ok(first[0].subject.equals(first[1].subject));
    assert.ok(!first[1].subject.equals(first[1].object));
    assert.ok(!first[0].subject.equals(second[0].subject));
    assert.ok(second[0].subject.equals(second[1].subject));
    for (const row of [...first, ...second]) {
      assert.equal(row.termType, 'Quad');
      assert.ok(row.graph.equals(n('urn:g')));
      assert.ok(Object.isFrozen(row.subject));
    }
  });

  it('rejects blank identity patterns before transport but supports safely mapped insert labels', async () => {
    const f = fixture();
    const blank = b('injection } ; DROP ALL; #');
    for (const method of ['find', 'has', 'count', 'remove']) {
      for (const pattern of [[blank, null, null], [null, null, blank], [n('urn:s'), n('urn:p'), blank]]) {
        await assert.rejects(f.graph[method](...pattern), /Blank-node identity/);
      }
    }
    assert.deepEqual(f.calls, []);
    await f.graph.add(blank, n('urn:p'), blank);
    assert.deepEqual(f.calls, [['update', 'INSERT DATA {\n  _:b0 <urn:p> _:b0 .\n}']]);
  });

  it('validates every returned position, including bindings supplied for bound positions', async () => {
    const f = fixture();
    const valid = { s: uri('urn:s'), p: uri('urn:p'), o: literal('x') };
    for (const row of [
      { ...valid, s: literal('subject') },
      { ...valid, p: { type: 'bnode', value: 'p' } },
      { ...valid, s: uri('relative') },
      { ...valid, o: uri('urn:injection> }') },
      { ...valid, o: { type: 'bnode', value: '' } },
      { ...valid, o: { type: 'bnode', value: '\ud800' } },
      { ...valid, o: { ...literal('x'), datatype: 'relative' } },
      { ...valid, o: { ...literal('x'), 'xml:lang': 'en', datatype: 'urn:not-langString' } },
      { ...valid, o: { type: 'typed-literal', value: 'x', datatype: 'urn:type', 'xml:lang': 'en' } },
      { ...valid, o: { ...literal('x'), datatype: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString' } },
      { ...valid, o: { ...uri('urn:o'), 'xml:lang': 'en' } }
    ]) {
      f.respond(results(row));
      await assert.rejects(f.graph.find(), { message: 'SPARQL SELECT: invalid result' });
      await assert.rejects(f.graph.find(n('urn:s'), n('urn:p'), l('x')), { message: 'SPARQL SELECT: invalid result' });
    }
    for (const row of [{ ...valid, s: uri('urn:wrong') }, { ...valid, o: literal('other') }, { ...valid, p: null }]) {
      f.respond(results(row));
      await assert.rejects(f.graph.find(n('urn:s'), n('urn:p'), l('x')), /SELECT: invalid result/);
    }
    f.respond(results(valid));
    assert.deepEqual((await f.graph.find(n('urn:s'), n('urn:p'), l('x'))).getTriples(), [q(n('urn:s'), n('urn:p'), l('x'))]);
    for (const vars of [null, {}, ['s', 'p'], ['s', 'p', 'o', 'extra'], ['s', 'p', 'p'], [1, 'p', 'o']]) {
      f.respond({ head: { vars }, results: { bindings: [] } });
      await assert.rejects(f.graph.find(), /SELECT: invalid result/);
    }
  });

  it('rejects plain, wrong-datatype and language COUNT literals, even with integer lexical text', async () => {
    const f = fixture();
    for (const count of [literal('1'), { ...literal('1'), datatype: 'urn:number' },
      { ...literal('1'), 'xml:lang': 'en' }, { ...integer('1'), 'xml:lang': 'en' }]) {
      f.respond(counts({ count }));
      await assert.rejects(f.graph.count(), /COUNT: invalid result/);
    }
    f.respond(counts({ count: { ...integer('01'), type: 'typed-literal' } }));
    assert.equal(await f.graph.count(), 1);
  });

  it('clears an absent or already emptied named graph without CLEAR GRAPH errors', async () => {
    const f = fixture(n('urn:clear:missing'));
    let updates = 0;
    // Model a store that discards empty graphs and rejects CLEAR on absence.
    f.client._update = async query => {
      if (query.startsWith('CLEAR GRAPH')) throw new Error('No such graph');
      assert.equal(query, B.buildDelete(n('urn:clear:missing'), null, null, null));
      updates++;
    };
    try {
      await f.graph.clear();
      await f.graph.clear();
      assert.equal(updates, 2);
    } finally { await f.client.close(); }
  });

  it('does not suppress named graph clear update failures', async () => {
    const f = fixture(n('urn:clear:failure'));
    const failure = new Error('SPARQL update: HTTP 500 failure');
    f.client._update = async () => { throw failure; };
    try { await assert.rejects(f.graph.clear(), error => error === failure); }
    finally { await f.client.close(); }
  });

  it('handles empty results and detached core cursor lifecycle', async () => {
    const f = fixture();
    assert.equal(await (await f.graph.find()).next(), false);
    f.respond(results({}));
    const cursor = await f.graph.find(n('urn:s'), n('urn:p'), n('urn:o'));
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
    await assert.rejects(f.graph.find(n('urn:s'), n('urn:p'), n('urn:o')), /SELECT: invalid result/);
  });

  it('accepts only strict ASK booleans', async () => {
    const f = fixture();
    for (const boolean of [true, false]) {
      f.respond({ boolean });
      assert.equal(await f.graph.has(), boolean);
    }
    for (const response of [null, {}, [], { boolean: 0 }, { boolean: 'false' },
      { boolean: true, head: null }, { boolean: true, results: { bindings: [] } }]) {
      f.respond(response);
      await assert.rejects(f.graph.has(), { message: 'SPARQL ASK: invalid result' });
    }
  });

  it('accepts nonnegative safe COUNT integers and rejects malformed aggregates', async () => {
    const f = fixture();
    for (const value of ['0', '+1', '42', String(Number.MAX_SAFE_INTEGER)]) {
      f.respond(counts({ count: integer(value) }));
      assert.equal(await f.graph.count(), Number(value));
    }
    for (const response of [null, {}, results(), results({}), counts({ count: integer('1') }, { count: integer('2') }),
      counts({ count: uri('1') }), ...['-1', '1.5', 'NaN', 'Infinity', '', ' ', '1e2', '9007199254740992', 'SECRET'].map(value => counts({ count: integer(value) }))]) {
      f.respond(response);
      await assert.rejects(f.graph.count(), { message: 'SPARQL COUNT: invalid result' });
    }
  });

  it('guards INSERT wildcards without sending updates', async () => {
    const f = fixture();
    for (let i = 0; i < 3; i++) {
      for (const value of [null, undefined]) {
        const terms = [n('urn:s'), n('urn:p'), n('urn:o')];
        terms[i] = value;
        await assert.rejects(f.graph.add(...terms), /Expected RDF\/JS term/);
      }
    }
    assert.deepEqual(f.calls, []);
  });

  for (const handle of ['graph', 'client']) {
    it(`rejects every operation after ${handle} closure before transport`, async () => {
      const f = fixture();
      f[handle].close();
      for (const method of ['find', 'has', 'count', 'add', 'remove', 'clear']) {
        await assert.rejects(f.graph[method](n('urn:s'), n('urn:p'), n('urn:o')), /closed/);
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
    for (const method of ['add', 'remove', 'clear']) await assert.rejects(f.graph[method](n('urn:s'), n('urn:p'), n('urn:o')), /update: HTTP 503/);
    assert.equal(calls, 6);
  });
});
