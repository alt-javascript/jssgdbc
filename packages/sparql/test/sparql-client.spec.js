import assert from 'node:assert/strict';
import http from 'node:http';
import { SparqlClient } from '../SparqlClient.js';

const secret = 'PRIVATE_PAYLOAD';

describe('SparqlClient HTTP transport', () => {
  let server, sockets, endpoint, requests, respond;
  beforeEach(async () => {
    requests = [];
    sockets = new Set();
    respond = (_req, res) => res.end('{"boolean":true}');
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
    endpoint = `http://127.0.0.1:${server.address().port}/sparql?token=${secret}&query=old`;
  });
  afterEach(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  const client = (url, properties) => new SparqlClient({}, `jssgdbc:sparql:${url}`, properties);
  async function rejectsSafe(promise, pattern) {
    await assert.rejects(promise, error => {
      assert.match(error.message, pattern);
      assert.equal(error.cause, undefined);
      assert.ok(!error.stack.includes(secret));
      assert.ok(!error.message.includes('127.0.0.1'));
      return true;
    });
  }

  it('GET encodes query exactly, replaces query, preserves endpoint parameters and enforces Accept', async () => {
    const c = client(endpoint, { headers: { aCcEpT: 'text/plain', Authorization: secret } });
    const text = 'SELECT * WHERE { ?s ?p "a&b + # é" }';
    assert.deepEqual(await c._query(text), { boolean: true });
    const request = requests[0];
    const url = new URL(request.url, endpoint);
    assert.equal(request.method, 'GET');
    assert.deepEqual(url.searchParams.getAll('query'), [text]);
    assert.equal(url.searchParams.get('token'), secret);
    assert.equal(request.headers.accept, 'application/sparql-results+json');
    assert.equal(request.headers.authorization, secret);
    assert.equal(request.body, '');
    assert.equal(c._timeoutMs, 30000);
    assert.equal(c.getUrl(), `jssgdbc:sparql:${endpoint}`);
  });

  it('POST sends raw update, enforces Content-Type and accepts empty 204', async () => {
    respond = (_req, res) => { res.writeHead(204); res.end(); };
    const c = client(endpoint, { headers: [['CONTENT-TYPE', 'text/plain'], ['X-Caller', secret]] });
    assert.equal(await c._update(`INSERT DATA { <s> <p> "${secret}" }`), undefined);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].body, `INSERT DATA { <s> <p> "${secret}" }`);
    assert.equal(requests[0].headers['content-type'], 'application/sparql-update');
    assert.equal(requests[0].headers['x-caller'], secret);
    assert.equal(new URL(requests[0].url, endpoint).searchParams.get('token'), secret);
  });

  for (const operation of ['query', 'update']) {
    it(`${operation} rejects HTTP failures without leaking response or request data and without retries`, async () => {
      respond = (_req, res) => { res.writeHead(503); res.end(secret); };
      await rejectsSafe(client(endpoint)[`_${operation}`](secret), new RegExp(`${operation}.*HTTP 503`));
      assert.equal(requests.length, 1);
    });
    it(`${operation} rejects redirects without following them`, async () => {
      respond = (_req, res) => { res.writeHead(307, { Location: `/private/${secret}` }); res.end(); };
      await rejectsSafe(client(endpoint)[`_${operation}`](secret), new RegExp(`${operation}.*network`));
      assert.equal(requests.length, 1);
    });
    it(`${operation} times out before response headers`, async () => {
      respond = () => {};
      await rejectsSafe(client(endpoint, { timeoutMs: 40 })[`_${operation}`](secret), new RegExp(`${operation}.*timeout`));
    });
    it(`${operation} keeps timeout active while consuming response body`, async () => {
      respond = (_req, res) => { res.writeHead(200); res.write('{'); };
      await rejectsSafe(client(endpoint, { timeoutMs: 40 })[`_${operation}`](secret), new RegExp(`${operation}.*timeout`));
    });
    it(`${operation} rejects refused connections with sanitized network error`, async () => {
      await new Promise(resolve => server.close(resolve));
      await rejectsSafe(client(endpoint)[`_${operation}`](secret), new RegExp(`${operation}.*network`));
    });
    it(`${operation} rejects closed clients before making requests`, async () => {
      const c = client(endpoint);
      c.close();
      await rejectsSafe(c[`_${operation}`](secret), new RegExp(`${operation}.*closed`));
      assert.equal(requests.length, 0);
    });
    it(`${operation} handles connection loss during body consumption`, async () => {
      respond = (_req, res) => { res.write('partial'); res.socket.destroy(); };
      await rejectsSafe(client(endpoint)[`_${operation}`](secret), new RegExp(`${operation}.*network`));
    });
  }

  it('rejects malformed JSON without leaking body', async () => {
    respond = (_req, res) => res.end(secret);
    await rejectsSafe(client(endpoint)._query(secret), /query.*JSON/);
  });
  it('accepts other successful update statuses and consumes bodies', async () => {
    respond = (_req, res) => { res.writeHead(201); res.end(secret); };
    assert.equal(await client(endpoint)._update(secret), undefined);
  });
  it('rejects invalid URLs and userinfo without disclosing them', () => {
    for (const url of [null, 42, '', 'https://example.org', 'jssgdbc:sparql:/relative', 'jssgdbc:sparql:ftp://host', `jssgdbc:sparql:http://user:${secret}@host`, 'jssgdbc:sparql:http://']) {
      assert.throws(() => new SparqlClient({}, url), error => !error.message.includes(secret) && /URL/.test(error.message));
    }
  });
  it('rejects invalid timeouts and malformed headers without unsafe causes', () => {
    for (const timeoutMs of [0, -1, NaN, Infinity, '20', null]) {
      assert.throws(() => client(endpoint, { timeoutMs }), /timeoutMs/);
    }
    assert.throws(() => client(endpoint, { headers: { [secret + '\n']: secret } }), /headers/);
  });
});
