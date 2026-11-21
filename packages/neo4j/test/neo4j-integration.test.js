import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import neo4j from 'neo4j-driver';
import { DriverManager } from '../index.js';

// Intentionally fixed to the disposable loopback fixture: never seed a remote DB.
const uri = 'bolt://127.0.0.1:17687';
const url = `jssgdbc:neo4j:${uri}`;
const options = { database: 'neo4j', timeoutMs: 10000, connectionTimeoutMs: 2000 };
const sorted = triples => triples.map(t => JSON.stringify(t)).sort();
const rows = async (graph, ...pattern) => {
  const cursor = await graph.find(...pattern);
  try { return cursor.getTriples(); } finally { cursor.close(); }
};

test('public CRUD, exact values, isolation, constraints and cross-client set semantics', { timeout: 120000 }, async t => {
  const owner = randomUUID();
  const names = [`test:${owner}:named`, `test:${owner}:concurrent`];
  const clients = [];
  let connected = false;
  let primaryFailure;
  const native = neo4j.driver(uri, undefined, { connectionTimeout: 2000, connectionAcquisitionTimeout: 2000 });
  const run = async (query, params = {}) => {
    const session = native.session({ database: 'neo4j' });
    try { return await session.run(query, params); } finally { await session.close(); }
  };
  try {
    const client = await DriverManager.getClient(url, options);
    clients.push(client);
    connected = true;
    const second = await DriverManager.getClient(url, options);
    clients.push(second);
    const version = await run('CALL dbms.components() YIELD versions RETURN versions[0] AS version');
    t.diagnostic(`Neo4j runtime ${version.records[0].get('version')}`);
    const constraints = await run('SHOW CONSTRAINTS YIELD name, properties RETURN name, properties');
    assert.ok(constraints.records.some(r => r.get('name') === 'jssgdbc_term_identity'
      && JSON.stringify(r.get('properties')) === JSON.stringify(['graph', 'kind', 'value'])));
    await run('CREATE (a:JssgdbcIntegrationSentinel {owner: $owner})-[:APP_LINK]->(b:JssgdbcIntegrationSentinel {owner: $owner})', { owner });
    const graph = client.getGraph(names[0]);
    const def = client.getGraph();
    assert.equal(def, client.getGraph(null));
    const triples = [
      { subject: `urn:${owner}:s`, predicate: 'urn:p', object: '"quote \\" and \\\\ slash"@en' },
      { subject: '_:blank', predicate: 'urn:p', object: '_:object' },
      { subject: `urn:${owner}:s`, predicate: 'urn:q', object: '<urn:iri>' },
      { subject: 'urn:x\' MATCH (n) DETACH DELETE n //', predicate: 'urn:p\\"', object: '"injection\' RETURN 1 //"' }
    ];
    assert.equal(await graph.count(), 0);
    assert.equal(await graph.has(), false);
    assert.deepEqual(await rows(graph), []);
    for (const triple of triples) assert.equal(await graph.add(...Object.values(triple)), undefined);
    await graph.add(...Object.values(triples[0]));
    assert.equal(await graph.count(), triples.length);
    assert.deepEqual(sorted(await rows(graph)), sorted(triples));
    await def.add(...Object.values(triples[0]));
    assert.equal(await def.count(triples[0].subject), 1);
    for (let mask = 0; mask < 8; mask++) {
      const pattern = Object.values(triples[0]).map((v, i) => mask & (1 << i) ? v : null);
      const expected = triples.filter(triple => Object.values(triple).every((v, i) => pattern[i] === null || pattern[i] === v));
      assert.deepEqual(sorted(await rows(graph, ...pattern)), sorted(expected), `find mask ${mask}`);
      assert.equal(await graph.count(...pattern), expected.length, `count mask ${mask}`);
      assert.equal(await graph.has(...pattern), expected.length > 0, `has mask ${mask}`);
      await graph.remove(...pattern);
      assert.equal(await graph.count(), triples.length - expected.length, `remove mask ${mask}`);
      for (const triple of expected) await graph.add(...Object.values(triple));
    }
    await graph.clear();
    assert.equal(await graph.count(), 0);
    assert.equal(await def.has(...Object.values(triples[0])), true);
    await def.remove(...Object.values(triples[0]));
    assert.equal(await def.has(...Object.values(triples[0])), false);
    const a = client.getGraph(names[1]);
    const b = second.getGraph(names[1]);
    for (const triple of [['urn:s', 'urn:p', 'urn:o'], ['_:s', 'urn:p', '_:o'], ['_:self', 'urn:p', '_:self']]) {
      await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).add(...triple)));
      assert.equal(await a.count(...triple), 1);
    }
    await Promise.all([a.add('urn:left', 'urn:p', 'urn:right'), b.add('urn:right', 'urn:p', 'urn:left')]);
    assert.equal(await a.count(), 5);
    const sentinel = await run('MATCH (:JssgdbcIntegrationSentinel {owner: $owner})-[r:APP_LINK]->(:JssgdbcIntegrationSentinel {owner: $owner}) RETURN count(r) AS count', { owner });
    assert.equal(sentinel.records[0].get('count').toNumber(), 1);
    const cursor = await a.find();
    const closed = client.close();
    assert.equal(client.close(), closed);
    await closed;
    await assert.rejects(a.count(), /closed/);
    assert.equal(cursor.getTriples().length, 5);
    cursor.close();
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    // Cleanup only this run's named graphs, default-graph subject and sentinel.
    try {
      if (connected) {
      await run('MATCH (n:JssgdbcTerm) WHERE n.graph IN $names OR (n.graph = $default AND n.value = $subject) DETACH DELETE n', { names, default: '', subject: `urn:${owner}:s` });
      await run('MATCH (n:JssgdbcIntegrationSentinel {owner: $owner}) DETACH DELETE n', { owner });
      }
    } catch {
      if (!primaryFailure) throw new Error('Neo4j fixture cleanup failed');
    } finally {
      const cleanup = await Promise.allSettled([...clients.map(c => c.close()), native.close()]);
      if (!primaryFailure && cleanup.some(result => result.status === 'rejected')) {
        throw new Error('Neo4j fixture driver close failed');
      }
    }
  }
});

test('unavailable Bolt endpoint fails with bounded redacted connection context', { timeout: 10000 }, async () => {
  // Reserve a loopback port but never listen: connections are genuinely refused.
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const start = Date.now();
  await assert.rejects(DriverManager.getClient(`jssgdbc:neo4j:bolt://127.0.0.1:${port}`, {
    username: 'redaction-user', password: 'redaction-secret', connectionTimeoutMs: 500, timeoutMs: 500
  }), error => {
    assert.match(error.message, /^Neo4j connect failed/);
    assert.doesNotMatch(error.message, /redaction|127\.0\.0\.1|password/);
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.ok(Date.now() - start < 8000);
});
