import { n, b, l, d, q } from './helpers/terms.js';
import assert from 'node:assert/strict';
import { DriverManager, SparqlDriver } from '@alt-javascript/jssgdbc-sparql';
import { typedGraphComplianceTests } from './helpers/typed-graph-compliance.js';
import { startMockSparqlEndpoint } from './helpers/mock-sparql-endpoint.js';

describe('SPARQL stateful loopback contract', () => {
  let fixture, clients, drivers;
  beforeEach(async () => {
    drivers = DriverManager.getDrivers();
    clients = [];
    fixture = await startMockSparqlEndpoint();
  });
  afterEach(async () => {
    try {
      const results = await Promise.allSettled(clients.map(client => client.close()));
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (errors.length) throw new AggregateError(errors, 'SPARQL fixture client cleanup failed');
    } finally {
      try { await fixture?.close(); }
      finally {
        DriverManager.clear();
        for (const driver of drivers) DriverManager.registerDriver(driver);
      }
    }
  });
  async function connect(properties) {
    DriverManager.clear();
    DriverManager.registerDriver(new SparqlDriver());
    const client = await DriverManager.getClient(`jssgdbc:sparql:${fixture.endpoint}`, properties);
    clients.push(client);
    return client;
  }
  async function collect(graph, ...pattern) {
    const cursor = await graph.find(...pattern);
    try {
      const rows = [];
      for await (const row of cursor) rows.push(row);
      return rows;
    } finally { await cursor.close(); }
  }

  typedGraphComplianceTests('SparqlDriver Compliance', connect);

  // Retain the legacy shared suite's operation/mask coverage with RDF/JS inputs.
  for (let mask = 0; mask < 8; mask++) {
    for (const wild of [null, undefined]) {
      it(`find/has/count/remove agree for mask ${mask}, wildcard ${wild}`, async () => {
        const graph = (await connect()).getGraph();
        const triples = [];
        for (const s of [n('urn:s'), n('urn:s2')]) for (const p of [n('urn:p'), n('urn:p2')]) {
          for (const o of [n('urn:o'), l('urn:o')]) triples.push([s, p, o]);
        }
        for (const row of triples) await graph.add(...row);
        const pattern = triples[0].map((t, i) => mask & (1 << i) ? t : wild);
        const expected = triples.filter(row => pattern.every((t, i) => t == null || t.equals(row[i])));
        assert.deepEqual(await collect(graph, ...pattern), expected.map(row => q(...row)));
        assert.equal(await graph.has(...pattern), true);
        assert.equal(await graph.count(...pattern), expected.length);
        await graph.remove(...pattern);
        assert.deepEqual(await collect(graph, ...pattern), []);
        assert.equal(await graph.has(...pattern), false);
        assert.equal(await graph.count(...pattern), 0);
        assert.equal(await graph.count(), triples.length - expected.length);
        await graph.remove(...pattern);
        assert.equal(await graph.count(), triples.length - expected.length);
      });
    }
  }

  it('preserves portable lexical identity across all pattern operations', async () => {
    const graph = (await connect()).getGraph();
    const objects = [n('urn:same'), l('urn:same'), l('same'), l('same', 'en'), l('same', 'fr'),
      l('01', '', 'http://www.w3.org/2001/XMLSchema#integer'), l('1', '', 'http://www.w3.org/2001/XMLSchema#integer'),
      l('1', '', 'urn:custom'), l('a"b\\\\c\n雪')];
    for (const object of objects) { await graph.add(n('urn:s'), n('urn:p'), object); await graph.add(n('urn:s'), n('urn:p'), object); }
    assert.equal(await graph.count(), objects.length);
    for (const object of objects) {
      assert.deepEqual(await collect(graph, undefined, undefined, object), [q(n('urn:s'), n('urn:p'), object)]);
      assert.equal(await graph.has(null, null, object), true);
      assert.equal(await graph.count(null, null, object), 1);
    }
    for (const [i, object] of objects.entries()) {
      await graph.remove(null, null, object);
      assert.equal(await graph.count(), objects.length - i - 1);
      assert.equal(await graph.has(null, null, object), false);
    }
  });

  it('rejects malformed terms and unsupported blank identity with zero HTTP requests', async () => {
    const client = await connect(), graph = client.getGraph();
    const bad = ['urn:legacy', '', false, 0, {}, { termType: 'NamedNode', value: 'relative' },
      { termType: 'NamedNode', value: 'urn:bad> } ; DROP ALL #' },
      { termType: 'Literal', value: 'x', language: '', datatype: { termType: 'NamedNode', value: 'relative' } },
      { termType: 'Variable', value: 'x' }, { termType: 'Quad', value: '' }];
    for (const invalid of bad) for (let index = 0; index < 3; index++) {
      const terms = [n('urn:s'), n('urn:p'), n('urn:o')]; terms[index] = invalid;
      for (const method of ['add', 'find', 'has', 'count', 'remove']) await assert.rejects(graph[method](...terms));
    }
    for (const terms of [[l('subject'), n('urn:p'), n('urn:o')], [n('urn:s'), b('p'), n('urn:o')], [n('urn:s'), n('urn:p'), d()]]) {
      await assert.rejects(graph.add(...terms));
    }
    for (const method of ['find', 'has', 'count', 'remove']) await assert.rejects(graph[method](b('id')), /Blank-node identity/);
    for (const graphName of ['', 'urn:g', b('g'), l('g')]) assert.throws(() => client.getGraph(graphName));
    assert.deepEqual(fixture.requests, []);
  });

  it('round-trips absolute IRIs and escaped, language and typed literals', async () => {
    const graph = (await connect()).getGraph();
    const objects = [n('urn:object1'), n('https://example.org/object'), l('hello'), l('a"b\\c\n雪'),
      l('bonjour', 'fr-ca'), l('42', '', 'http://www.w3.org/2001/XMLSchema#integer')];
    for (const object of objects) await graph.add(n('https://example.org/s'), n('urn:p'), object);
    assert.deepEqual(await collect(graph), objects.map(object => q(n('https://example.org/s'), n('urn:p'), object)));
  });

  it('uses set semantics, positional matching, no-match removal, ASK and COUNT', async () => {
    const graph = (await connect()).getGraph();
    assert.equal(await graph.has(), false);
    assert.equal(await graph.count(), 0);
    for (const terms of [[n('urn:s'), n('urn:p'), n('urn:o')], [n('urn:s'), n('urn:p'), n('urn:o')], [n('urn:p'), n('urn:s'), n('urn:o')], [n('urn:s'), n('urn:q'), n('urn:x')]]) await graph.add(...terms);
    assert.equal(await graph.count(), 3);
    assert.equal(await graph.count(n('urn:s')), 2);
    assert.equal(await graph.count(null, n('urn:p')), 1);
    assert.equal(await graph.count(null, null, n('urn:o')), 2);
    assert.equal(await graph.has(n('urn:s'), n('urn:p'), n('urn:o')), true);
    assert.equal(await graph.has(n('urn:s'), n('urn:o'), n('urn:p')), false);
    assert.deepEqual(await collect(graph, n('urn:missing')), []);
    await graph.remove(n('urn:missing'), n('urn:p'), n('urn:o'));
    assert.equal(await graph.count(), 3);
    await graph.remove(n('urn:s'), n('urn:p'), n('urn:o'));
    assert.equal(await graph.has(n('urn:s'), n('urn:p'), n('urn:o')), false);
    assert.equal(await graph.count(), 2);
    assert.deepEqual(await collect(graph, n('urn:p')), [q(n('urn:p'), n('urn:s'), n('urn:o'))]);
  });

  it('isolates default and named graph insert, delete and clear in both directions', async () => {
    const client = await connect();
    const graphs = [client.getGraph(), client.getGraph(n('urn:a')), client.getGraph(n('urn:b'))];
    for (const graph of graphs) await graph.add(n('urn:s'), n('urn:p'), n('urn:o'));
    await graphs[1].remove(n('urn:s'), n('urn:p'), n('urn:o'));
    assert.deepEqual(await Promise.all(graphs.map(graph => graph.count())), [1, 0, 1]);
    await graphs[0].clear();
    assert.deepEqual(await Promise.all(graphs.map(graph => graph.has())), [false, false, true]);
    await graphs[0].add(n('urn:s'), n('urn:p'), n('urn:o'));
    await graphs[2].clear();
    assert.deepEqual(await Promise.all(graphs.map(graph => graph.count())), [1, 0, 0]);
  });

  it('records method, operation, graph scope and safe configuration headers', async () => {
    const graph = (await connect({ headers: { 'X-Example': 'fixture' } })).getGraph(n('urn:g'));
    await graph.add(n('urn:s'), n('urn:p'), n('urn:o'));
    await collect(graph);
    await graph.has();
    await graph.count();
    await graph.remove(n('urn:s'), n('urn:p'), n('urn:o'));
    await graph.clear();
    assert.deepEqual(fixture.requests.map(({ method, operation, graph }) => [method, operation, graph]), [
      ['POST', 'INSERT DATA', 'urn:g'], ['GET', 'SELECT', 'urn:g'], ['GET', 'ASK', 'urn:g'],
      ['GET', 'COUNT', 'urn:g'], ['POST', 'DELETE DATA', 'urn:g'], ['POST', 'DELETE PATTERN', 'urn:g']
    ]);
    for (const { method, headers } of fixture.requests) {
      assert.equal(headers['x-example'], 'fixture');
      assert.equal(method === 'GET' ? headers.accept : headers['content-type'],
        method === 'GET' ? 'application/sparql-results+json' : 'application/sparql-update');
      assert.equal(headers.authorization, undefined);
    }
  });

  it('rejects unsupported syntax and transport forms explicitly without mutating data', async () => {
    const graph = (await connect()).getGraph();
    await graph.add(n('urn:s'), n('urn:p'), n('urn:o'));
    const cases = [
      ['GET', 'SELECT * WHERE { ?s ?p ?o . }'],
      ['GET', 'ASK { ?s ?p ?o . FILTER(true) }'],
      ['GET', 'ASK { ?x ?p ?o . }'],
      ['GET', 'CLEAR DEFAULT'],
      ['POST', 'ASK { ?s ?p ?o . }'],
      ['POST', 'INSERT DATA { ?s <p> <o> . }'],
      ['POST', 'INSERT DATA { <s> <p> "bad\\z" . }'],
      ['POST', 'DELETE { ?s ?p ?o . } WHERE { <urn:different> ?p ?o . }'],
      ['POST', 'CLEAR ALL'],
      ['POST', 'CLEAR DEFAULT trailing'],
      ['PUT', 'CLEAR DEFAULT']
    ];
    for (const [method, text] of cases) {
      const url = new URL(fixture.endpoint);
      if (method === 'GET') url.searchParams.set('query', text);
      const response = await fetch(url, { method, ...(method === 'GET' ? {} : {
        headers: { 'Content-Type': 'application/sparql-update' }, body: text
      }) });
      assert.equal(response.status, 400);
      assert.equal(await response.text(), 'Unsupported fixture request');
    }
    assert.equal(await graph.count(), 1);
    await graph.remove(n('urn:s'));
    assert.equal(await graph.count(), 0);
  });

  it('reset clears all graph state and request records', async () => {
    const client = await connect();
    await client.getGraph().add(n('urn:s'), n('urn:p'), n('urn:o'));
    await client.getGraph(n('urn:g')).add(n('urn:s'), n('urn:p'), n('urn:o'));
    fixture.reset();
    assert.deepEqual(fixture.requests, []);
    assert.equal(await client.getGraph().count(), 0);
    assert.equal(await client.getGraph(n('urn:g')).has(), false);
  });
});
