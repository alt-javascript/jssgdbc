import assert from 'node:assert/strict';
import { DriverManager, SparqlDriver } from '@alt-javascript/jssgdbc-sparql';
import driverComplianceTests from '@alt-javascript/jssgdbc-core/test/driverCompliance.js';
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
      for (const client of clients) client.close();
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
    } finally { cursor.close(); }
  }

  driverComplianceTests('SparqlDriver Compliance', connect);

  it('round-trips bare and absolute IRIs and escaped, language and typed literals', async () => {
    const graph = (await connect()).getGraph();
    const objects = ['object1', 'https://example.org/object', '"hello"', '"a\\"b\\\\c\\n雪"',
      '"bonjour"@fr-CA', '"42"^^<http://www.w3.org/2001/XMLSchema#integer>'];
    for (const object of objects) await graph.add('https://example.org/s', 'urn:p', object);
    assert.deepEqual(await collect(graph), objects.map(object => ({ subject: 'https://example.org/s', predicate: 'urn:p', object })));
  });

  it('uses set semantics, positional matching, no-match removal, ASK and COUNT', async () => {
    const graph = (await connect()).getGraph();
    assert.equal(await graph.has(), false);
    assert.equal(await graph.count(), 0);
    for (const terms of [['s', 'p', 'o'], ['s', 'p', 'o'], ['p', 's', 'o'], ['s', 'q', 'x']]) await graph.add(...terms);
    assert.equal(await graph.count(), 3);
    assert.equal(await graph.count('s'), 2);
    assert.equal(await graph.count(null, 'p'), 1);
    assert.equal(await graph.count(null, null, 'o'), 2);
    assert.equal(await graph.has('s', 'p', 'o'), true);
    assert.equal(await graph.has('s', 'o', 'p'), false);
    assert.deepEqual(await collect(graph, 'missing'), []);
    await graph.remove('missing', 'p', 'o');
    assert.equal(await graph.count(), 3);
    await graph.remove('s', 'p', 'o');
    assert.equal(await graph.has('s', 'p', 'o'), false);
    assert.equal(await graph.count(), 2);
    assert.deepEqual(await collect(graph, 'p'), [{ subject: 'p', predicate: 's', object: 'o' }]);
  });

  it('isolates default and named graph insert, delete and clear in both directions', async () => {
    const client = await connect();
    const graphs = [client.getGraph(), client.getGraph('urn:a'), client.getGraph('urn:b')];
    for (const graph of graphs) await graph.add('s', 'p', 'o');
    await graphs[1].remove('s', 'p', 'o');
    assert.deepEqual(await Promise.all(graphs.map(graph => graph.count())), [1, 0, 1]);
    await graphs[0].clear();
    assert.deepEqual(await Promise.all(graphs.map(graph => graph.has())), [false, false, true]);
    await graphs[0].add('s', 'p', 'o');
    await graphs[2].clear();
    assert.deepEqual(await Promise.all(graphs.map(graph => graph.count())), [1, 0, 0]);
  });

  it('records method, operation, graph scope and safe configuration headers', async () => {
    const graph = (await connect({ headers: { 'X-Example': 'fixture' } })).getGraph('urn:g');
    await graph.add('s', 'p', 'o');
    await collect(graph);
    await graph.has();
    await graph.count();
    await graph.remove('s', 'p', 'o');
    await graph.clear();
    assert.deepEqual(fixture.requests.map(({ method, operation, graph }) => [method, operation, graph]), [
      ['POST', 'INSERT DATA', 'urn:g'], ['GET', 'SELECT', 'urn:g'], ['GET', 'ASK', 'urn:g'],
      ['GET', 'COUNT', 'urn:g'], ['POST', 'DELETE DATA', 'urn:g'], ['POST', 'CLEAR', 'urn:g']
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
    await graph.add('s', 'p', 'o');
    const cases = [
      ['GET', 'SELECT * WHERE { ?s ?p ?o . }'],
      ['GET', 'ASK { ?s ?p ?o . FILTER(true) }'],
      ['GET', 'ASK { ?x ?p ?o . }'],
      ['GET', 'CLEAR DEFAULT'],
      ['POST', 'ASK { ?s ?p ?o . }'],
      ['POST', 'INSERT DATA { ?s <p> <o> . }'],
      ['POST', 'INSERT DATA { <s> <p> "bad\\z" . }'],
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
    await assert.rejects(graph.remove('s'), { message: 'SPARQL update: HTTP 400 failure' });
    assert.equal(await graph.count(), 1);
  });

  it('reset clears all graph state and request records', async () => {
    const client = await connect();
    await client.getGraph().add('s', 'p', 'o');
    await client.getGraph('urn:g').add('s', 'p', 'o');
    fixture.reset();
    assert.deepEqual(fixture.requests, []);
    assert.equal(await client.getGraph().count(), 0);
    assert.equal(await client.getGraph('urn:g').has(), false);
  });
});
