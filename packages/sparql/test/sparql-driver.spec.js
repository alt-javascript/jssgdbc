import assert from 'node:assert/strict';
import http from 'node:http';
import * as api from '@alt-javascript/jssgdbc-sparql';
import * as core from '@alt-javascript/jssgdbc-core';

const { DriverManager, ClientDataSource, SparqlDriver, SparqlClient, SparqlGraph, Cursor } = api;
const secret = 'PRIVATE_ENDPOINT_DATA';
const s = 'urn:subject', p = 'urn:predicate', o = '"hello"';

describe('SPARQL public driver HTTP composition', () => {
  let server, sockets, endpoint, url, requests, respond, clients;
  beforeEach(async () => {
    requests = [];
    clients = [];
    sockets = new Set();
    respond = (_req, res) => res.end(JSON.stringify({ results: { bindings: [] } }));
    server = http.createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      respond(req, res);
    });
    server.on('connection', socket => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${server.address().port}/sparql?token=${secret}`;
    url = `jssgdbc:sparql:${endpoint}`;
  });
  afterEach(async () => {
    for (const client of clients) client.close();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  async function connect() {
    const client = await DriverManager.getClient(url, { headers: { Authorization: secret } });
    clients.push(client);
    return client;
  }
  function json(value) {
    respond = (_req, res) => {
      res.setHeader('Content-Type', 'application/sparql-results+json');
      res.end(JSON.stringify(value));
    };
  }
  function query(expected) {
    const request = requests.at(-1);
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.accept, 'application/sparql-results+json');
    assert.equal(request.headers.authorization, secret);
    assert.equal(request.body, '');
    const parsed = new URL(request.url, endpoint);
    assert.equal(parsed.searchParams.get('token'), secret);
    assert.equal(parsed.searchParams.get('query'), expected);
  }
  async function safeReject(promise, expected) {
    await assert.rejects(promise, error => {
      assert.match(error.message, expected);
      assert.equal(error.cause, undefined);
      assert.ok(!error.stack.includes(secret));
      assert.ok(!error.stack.includes(endpoint));
      return true;
    });
  }

  it('exports core identities and builder, and auto-registers a singleton driver', async () => {
    for (const [name, value] of Object.entries(core)) assert.equal(api[name], value);
    assert.equal(typeof api.SparqlBuilder.buildSelect, 'function');
    assert.ok(api._driver instanceof core.Driver);
    assert.ok(api._driver instanceof SparqlDriver);
    assert.equal(DriverManager.getDrivers().filter(driver => driver === api._driver).length, 1);
    const client = await connect();
    assert.ok(client instanceof SparqlClient);
    assert.ok(client instanceof core.Client);
    assert.equal(client.getUrl(), url);
    assert.equal(requests.length, 0, 'connecting must not fetch');
    const sourced = await new ClientDataSource(url).getClient();
    clients.push(sourced);
    assert.ok(sourced instanceof SparqlClient);
    assert.equal(sourced.getUrl(), url);
    assert.equal(requests.length, 0);
  });

  it('safely rejects unrelated/nonstring URLs and validates matching URLs without I/O', async () => {
    const driver = new SparqlDriver();
    for (const value of [null, undefined, 42, {}, '', 'jssgdbc:memory:', 'jsgdbc:sparql:http://host']) {
      assert.equal(driver.acceptsURL(value), false);
      await safeReject(driver.connect(value), /Invalid SPARQL endpoint URL/);
    }
    assert.equal(driver.acceptsURL('jssgdbc:sparql:bad'), true);
    await safeReject(DriverManager.getClient('jssgdbc:sparql:bad'), /Invalid SPARQL endpoint URL/);
    await assert.rejects(DriverManager.getClient('unrelated:example'), /No suitable driver/);
    await safeReject(DriverManager.getClient(url, { timeoutMs: 0 }), /timeoutMs/);
    assert.equal(requests.length, 0);
  });

  for (const name of ['', 'urn:graph']) {
    it(`composes SELECT/ASK/COUNT and INSERT/DELETE/CLEAR for ${name || 'default graph'}`, async () => {
      const client = await connect();
      const graph = client.getGraph(name);
      assert.ok(graph instanceof SparqlGraph);
      assert.ok(graph instanceof core.Graph);
      assert.equal(graph.getName(), name);
      assert.equal(client.getGraph(name), graph);
      assert.equal(client.getGraph(), client.getGraph(''));
      assert.notEqual(client.getGraph(), client.getGraph('urn:graph'));
      const wrap = pattern => name ? `GRAPH <urn:graph> {\n    ${pattern}\n  }` : pattern;
      json({ results: { bindings: [
        { s: { type: 'uri', value: s }, p: { type: 'uri', value: p }, o: { type: 'literal', value: 'hello' } },
      ] } });
      const cursor = await graph.find();
      assert.ok(cursor instanceof Cursor);
      query(`SELECT ?s ?p ?o WHERE {\n  ${wrap('?s ?p ?o .')}\n}`);
      const triples = [];
      for await (const triple of cursor) triples.push(triple);
      assert.deepEqual(triples, [{ subject: s, predicate: p, object: o }]);
      json({ results: { bindings: [{ o: { type: 'literal', value: 'hello' } }] } });
      const bound = await graph.find(s, p);
      query(`SELECT ?s ?p ?o WHERE {\n  ${wrap('<urn:subject> <urn:predicate> ?o .')}\n}`);
      assert.equal(await bound.next(), true);
      assert.deepEqual(bound.getTriple(), triples[0]);
      assert.equal(await bound.next(), false);
      json({ boolean: false });
      assert.equal(await graph.has(s, p, o), false);
      query(`ASK {\n  ${wrap('<urn:subject> <urn:predicate> "hello" .')}\n}`);
      json({ results: { bindings: [{ count: { type: 'literal', value: '0' } }] } });
      assert.equal(await graph.count(), 0);
      query(`SELECT (COUNT(*) AS ?count) WHERE {\n  ${wrap('?s ?p ?o .')}\n}`);
      respond = (_req, res) => { res.writeHead(204); res.end(); };
      const updates = [
        [() => graph.add(s, p, o), `INSERT DATA {\n  ${wrap('<urn:subject> <urn:predicate> "hello" .')}\n}`],
        [() => graph.remove(s, p, o), `DELETE DATA {\n  ${wrap('<urn:subject> <urn:predicate> "hello" .')}\n}`],
        [() => graph.remove(s), `DELETE {\n  ${wrap('<urn:subject> ?p ?o .')}\n}\nWHERE {\n  ${wrap('<urn:subject> ?p ?o .')}\n}`],
        [() => graph.clear(), name ? 'CLEAR GRAPH <urn:graph>' : 'CLEAR DEFAULT'],
      ];
      for (const [operation, text] of updates) {
        assert.equal(await operation(), undefined);
        const request = requests.at(-1);
        assert.equal(request.method, 'POST');
        assert.equal(request.headers['content-type'], 'application/sparql-update');
        assert.equal(request.body, text);
        assert.equal(new URL(request.url, endpoint).searchParams.get('token'), secret);
      }
      assert.equal(requests.length, 8);
    });
  }

  it('rejects closed graph/parent handles without HTTP while detached Cursor remains usable', async () => {
    const client = await connect();
    const graph = client.getGraph();
    json({ results: { bindings: [{}] } });
    const cursor = await graph.find(s, p, o);
    graph.close();
    assert.equal(graph.isClosed(), true);
    const other = client.getGraph('urn:other');
    client.close();
    assert.equal(client.isClosed(), true);
    assert.throws(() => client.getGraph(), /closed/);
    for (const handle of [graph, other]) {
      for (const operation of ['find', 'has', 'count', 'add', 'remove', 'clear']) {
        await assert.rejects(handle[operation](s, p, o), /closed/);
      }
    }
    assert.equal(requests.length, 1);
    assert.equal(await cursor.next(), true);
    assert.deepEqual(cursor.getTriple(), { subject: s, predicate: p, object: o });
    cursor.close();
    await assert.rejects(cursor.next(), /closed/);
  });

  for (const operation of ['find', 'add']) {
    it(`redacts end-to-end HTTP failures for ${operation} without retrying`, async () => {
      respond = (_req, res) => { res.writeHead(503); res.end(secret); };
      const graph = (await connect()).getGraph(`urn:${secret}`);
      await safeReject(graph[operation](s, p, `"${secret}"`), new RegExp(`${operation === 'find' ? 'query' : 'update'}.*HTTP 503`));
      assert.equal(requests.length, 1);
    });
  }
  for (const [operation, result, category] of [
    ['find', { results: { bindings: [{ s: { type: 'unknown', value: secret } }] } }, 'SELECT'],
    ['has', { boolean: secret }, 'ASK'],
    ['count', { results: { bindings: [{ count: { type: 'literal', value: secret } }] } }, 'COUNT'],
  ]) {
    it(`redacts malformed ${category} results through public graph`, async () => {
      json(result);
      const graph = (await connect()).getGraph();
      await safeReject(graph[operation](), new RegExp(`${category}: invalid result`));
      assert.equal(requests.length, 1);
    });
  }
});
