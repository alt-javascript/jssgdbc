import assert from 'node:assert/strict';
import { n, l, q } from './helpers/terms.js';
import { readFile } from 'node:fs/promises';
import { DriverManager, SparqlDriver } from '@alt-javascript/jssgdbc-sparql';
import { startMockSparqlEndpoint } from './helpers/mock-sparql-endpoint.js';

// Execute only the two explicitly marked examples. Resolve the public package
// import for a data-URL module; leave the executable example logic unchanged.
async function example(id) {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const pattern = new RegExp('<!-- example:' + id + ' -->\\s*```javascript\\n([\\s\\S]*?)\\n```', 'g');
  const matches = [...readme.matchAll(pattern)];
  assert.equal(matches.length, 1, `README must contain exactly one ${id} example`);
  const specifier = "'@alt-javascript/jssgdbc-sparql'";
  assert.ok(matches[0][1].includes(specifier), 'example must import the public package');
  const source = matches[0][1].replace(specifier,
    JSON.stringify(import.meta.resolve('@alt-javascript/jssgdbc-sparql')));
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

const subject = 'http://dbpedia.org/resource/Berlin';
const predicate = 'http://www.w3.org/2000/01/rdf-schema#label';
const namedGraph = 'https://example.org/graphs/demo';

describe('Executable SPARQL README examples', () => {
  let fixture, drivers, handles;
  beforeEach(async () => {
    drivers = DriverManager.getDrivers();
    handles = [];
    fixture = await startMockSparqlEndpoint();
    DriverManager.clear();
    const driver = new SparqlDriver();
    const connect = driver.connect.bind(driver);
    // Observe real handles without replacing their behavior, so finally blocks
    // are tested before afterEach's safety cleanup can hide a leak.
    driver.connect = async (...args) => {
      assert.equal(args[0], `jssgdbc:sparql:${fixture.endpoint}`, 'loopback only');
      const client = await connect(...args);
      handles.push(client);
      const getGraph = client.getGraph.bind(client);
      client.getGraph = (...graphArgs) => {
        const graph = getGraph(...graphArgs);
        if (!handles.includes(graph)) {
          handles.push(graph);
          const find = graph.find.bind(graph);
          graph.find = async (...pattern) => {
            const cursor = await find(...pattern);
            handles.push(cursor);
            return cursor;
          };
        }
        return graph;
      };
      return client;
    };
    DriverManager.registerDriver(driver);
  });
  afterEach(async () => {
    try { for (const handle of handles) handle.close(); }
    finally {
      try { await fixture?.close(); }
      finally {
        DriverManager.clear();
        for (const driver of drivers) DriverManager.registerDriver(driver);
      }
    }
  });
  function assertClosed(expected) {
    assert.equal(handles.length, expected);
    assert.ok(handles.every(handle => handle.isClosed()), 'example closes every acquired handle');
  }

  it('executes read-only quick-start with literal results, headers and cleanup', async () => {
    const seed = await DriverManager.getClient(`jssgdbc:sparql:${fixture.endpoint}`);
    const graph = seed.getGraph();
    await graph.add(n(subject), n(predicate), l('Berlin', 'en'));
    graph.close();
    seed.close();
    handles = [];
    fixture.requests.length = 0;
    const { readExample } = await example('read-only');
    assert.deepEqual(await readExample(fixture.endpoint, { 'X-Example': 'configured' }), [
      q(n(subject), n(predicate), l('Berlin', 'en'))
    ]);
    assertClosed(3);
    assert.deepEqual(fixture.requests.map(({ method, operation, graph }) => [method, operation, graph]),
      [['GET', 'SELECT', '']]);
    assert.equal(fixture.requests[0].headers['x-example'], 'configured');
    assert.equal(fixture.requests[0].headers.accept, 'application/sparql-results+json');
  });

  it('handles empty reads and closes the buffered cursor', async () => {
    const { readExample } = await example('read-only');
    assert.deepEqual(await readExample(fixture.endpoint), []);
    assertClosed(3);
  });

  it('executes opt-in mutations, named readback, isolation and configured headers', async () => {
    const { writeExample } = await example('writable');
    assert.deepEqual(await writeExample(fixture.endpoint, {
      allowWrites: true, headers: { 'X-Example': 'writable' }
    }), {
      rows: [q(n('https://example.org/items/demo'), n(predicate), l('Demo', 'en'), n(namedGraph))],
      present: true, count: 1, afterRemove: false, afterClear: 0,
      defaultPreserved: true, defaultAfterRemove: false
    });
    assertClosed(4);
    assert.deepEqual(fixture.requests.map(({ method, operation, graph }) => [method, operation, graph]), [
      ['POST', 'INSERT DATA', ''], ['POST', 'INSERT DATA', namedGraph],
      ['GET', 'SELECT', namedGraph], ['GET', 'ASK', namedGraph], ['GET', 'COUNT', namedGraph],
      ['POST', 'DELETE DATA', namedGraph], ['GET', 'ASK', namedGraph],
      ['POST', 'INSERT DATA', namedGraph], ['POST', 'DELETE PATTERN', namedGraph],
      ['GET', 'COUNT', namedGraph], ['GET', 'ASK', ''],
      ['POST', 'DELETE DATA', ''], ['GET', 'ASK', '']
    ]);
    for (const { method, headers } of fixture.requests) {
      assert.equal(headers['x-example'], 'writable');
      assert.equal(method === 'GET' ? headers.accept : headers['content-type'],
        method === 'GET' ? 'application/sparql-results+json' : 'application/sparql-update');
    }
  });

  it('refuses writes without opt-in before acquiring a client or making requests', async () => {
    const { writeExample } = await example('writable');
    await assert.rejects(writeExample(fixture.endpoint), /explicit opt-in/);
    assert.deepEqual(fixture.requests, []);
    assertClosed(0);
  });

  for (const [id, name, options, expected] of [
    ['read-only', 'readExample', undefined, 2],
    ['writable', 'writeExample', { allowWrites: true }, 3]
  ]) {
    it(`propagates connection failure and closes ${id} handles`, async () => {
      const module = await example(id);
      await fixture.close();
      await assert.rejects(module[name](fixture.endpoint, options), /SPARQL (query|update): network failure/);
      assertClosed(expected);
    });
  }
});
