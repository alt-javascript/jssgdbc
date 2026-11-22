import test from 'node:test';
import assert from 'node:assert/strict';
import neo4j from 'neo4j-driver';
import rdf from '@rdfjs/data-model';
import external from '@rdfjs/dataset';
import { factory } from '../../dataset/index.js';
import { datasetCompliance } from '../../core/test/datasetCompliance.js';
import { DriverManager } from '../index.js';
import { CypherBuilder } from '../CypherBuilder.js';
import { graphKey } from '../RdfStorage.js';

const url = 'jssgdbc:neo4j:bolt://127.0.0.1:17687';
const options = { database: 'neo4j', timeoutMs: 10000, connectionTimeoutMs: 2000 };
const n = rdf.namedNode, d = rdf.defaultGraph(), g = n('urn:dataset:g'), h = n('urn:dataset:h');
const s = n('urn:s'), p = n('urn:p');
const q = (object, graph = d) => rdf.quad(s, p, object, graph);
const open = () => DriverManager.getClient(url, options);

// This file runs serially, before the other live files. Raw fixture writes never
// run unless the random project marker from the owned Compose runner is present.
test('real Neo4j Dataset durability, transactions and schema admission', { timeout: 120000 }, async t => {
  assert.match(process.env.JSSGDBC_DISPOSABLE_NEO4J ?? '', /^jssgdbc-test-[0-9a-f-]{36}$/);
  const native = neo4j.driver('bolt://127.0.0.1:17687');
  async function raw(query, params = {}) {
    const session = native.session({ database: 'neo4j' });
    try { return await session.run(query, params); } finally { await session.close(); }
  }
  const reset = () => raw('MATCH (n) DETACH DELETE n'); // exclusively disposable fixture
  let client;
  try {
    await reset();
    await t.test('concurrent first opens converge and repeated opens validate', async () => {
      const results = await Promise.allSettled(Array.from({ length: 4 }, open));
      await Promise.all(results.filter(r => r.status === 'fulfilled').map(r => r.value.close()));
      assert(results.every(r => r.status === 'fulfilled'), 'all first opens succeed');
      const result = await raw('MATCH (m:JssgdbcRdfSchema) RETURN count(m) AS count');
      assert.equal(result.records[0].get('count').toNumber(), 1);
    });
    client = await open();
    const blank = rdf.blankNode('shared');
    const input = external.dataset([
      q(rdf.literal('01', n('http://www.w3.org/2001/XMLSchema#integer'))),
      q(rdf.literal('1', n('http://www.w3.org/2001/XMLSchema#integer'))),
      rdf.quad(blank, p, rdf.literal('hello', 'en'), d), q(blank, g)
    ]);
    await t.test('independent Dataset survives close/reopen with shared blank identity', async () => {
      await client.saveDataset(input, { graphs: [d, g] });
      await client.close(); client = await open();
      assert((await client.loadDataset({ graphs: [d, g], factory })).equals(input));
      await client.saveDataset(input, { graphs: [d, g] });
      assert.equal((await client.loadDataset({ graphs: [d, g], factory })).size, 6);
      await client.saveDataset([q(rdf.literal('sentinel'), h)], { graphs: [h] });
      await client.saveDataset(input, { graphs: [d, g], mode: 'replace' });
      assert((await client.loadDataset({ graphs: [d, g], factory })).equals(input));
      await client.saveDataset([], { graphs: [g], mode: 'replace' });
      assert.equal(await client.getGraph(g).count(), 0);
      assert.equal(await client.getGraph(d).count(), 3);
      assert.equal(await client.getGraph(h).count(), 1);
    });
    await t.test('late malformed quad and foreign graph perform no writes', async () => {
      const before = await client.loadDataset({ graphs: [d, g], factory });
      function* invalid() { yield q(rdf.literal('must not write')); yield { ...q(s), predicate: rdf.literal('bad') }; }
      await assert.rejects(client.saveDataset(invalid(), { graphs: [d], mode: 'replace' }), TypeError);
      await assert.rejects(client.saveDataset([q(s, h)], { graphs: [d], mode: 'replace' }), TypeError);
      await assert.rejects(client.loadDataset({ graphs: ['urn:bad'], factory }), TypeError);
      assert((await client.loadDataset({ graphs: [d, g], factory })).equals(before));
    });
    await t.test('replace versus add is serialized per graph across clients', async () => {
      const other = await open();
      try {
        for (let i = 0; i < 5; i++) {
          await client.saveDataset([q(rdf.literal('old'), g)], { graphs: [g], mode: 'replace' });
          await Promise.all([
            client.saveDataset([q(rdf.literal('replacement'), g)], { graphs: [g], mode: 'replace' }),
            other.getGraph(g).add(s, p, rdf.literal('concurrent'))
          ]);
          assert.equal(await client.getGraph(g).has(s, p, rdf.literal('replacement')), true);
          assert.equal(await client.getGraph(g).has(s, p, rdf.literal('old')), false);
          assert([1, 2].includes(await client.getGraph(g).count()));
        }
      } finally { await other.close(); }
    });
    await t.test('server transaction failure rolls back clear and insertion', async () => {
      const before = await client.loadDataset({ graphs: [g], factory });
      const session = native.session({ database: 'neo4j' });
      try {
        await assert.rejects(session.executeWrite(async tx => {
          for (const statement of [CypherBuilder.buildLock(g), CypherBuilder.buildClear(g), CypherBuilder.buildAdd(g, s, p, rdf.literal('rolled back'))]) {
            await tx.run(statement.query, statement.params);
          }
          await tx.run('THIS IS NOT CYPHER');
        }), error => error.code === 'Neo.ClientError.Statement.SyntaxError');
      } finally { await session.close(); }
      assert((await client.loadDataset({ graphs: [g], factory })).equals(before));
    });
    await t.test('corrupt owned term fails buffered decoding without payload disclosure', async () => {
      await raw('MATCH (n:JssgdbcRdfTerm {graph: $graph}) WHERE n.termType = "Literal" SET n.key = "secret-corrupt-key"', { graph: graphKey(h) });
      await assert.rejects(client.loadDataset({ graphs: [h], factory }), error => !error.message.includes('secret-corrupt-key'));
    });
    await client.close(); client = null;
    await reset();
    await t.test('shared independent Dataset compliance through public client', async () => {
      await datasetCompliance(await open(), rdf, external, factory);
    });
    await t.test('incompatible schemas reject without touching sentinel nodes or relationships', async () => {
      const fixtures = [
        'CREATE (:JssgdbcTerm {value: "legacy-secret"})',
        'CREATE (:JssgdbcTerm)-[:JSSGDBC_TRIPLE]->(:JssgdbcTerm), (:JssgdbcRdfSchema {id: "jssgdbc-rdf", version: "1", profile: "rdfjs-structural-v1"})',
        'CREATE (:JssgdbcRdfSchema {id: "jssgdbc-rdf", version: "unknown-secret", profile: "rdfjs-structural-v1"})',
        'CREATE (:JssgdbcRdfTerm {key: "unmarked-secret"})',
        'CREATE (:JssgdbcRdfSchema {id: "wrong-secret"})'
      ];
      for (const fixture of fixtures) {
        await reset();
        await raw('CREATE (:ApplicationSentinel {value: "keep"})-[:KEEPS]->(:ApplicationSentinel {value: "also keep"})');
        await raw(fixture);
        const snapshot = async () => {
          const nodes = await raw('MATCH (n) RETURN elementId(n) AS id, labels(n) AS labels, properties(n) AS props ORDER BY id');
          const edges = await raw('MATCH ()-[r]->() RETURN elementId(r) AS id, type(r) AS type, properties(r) AS props ORDER BY id');
          return [nodes.records.map(r => r.toObject()), edges.records.map(r => r.toObject())];
        };
        const before = await snapshot();
        await assert.rejects(open(), error => /incompatible RDF storage schema\/profile/.test(error.message)
          && /operator control/.test(error.message) && !error.message.includes('secret'));
        assert.deepEqual(await snapshot(), before);
      }
    });
  } finally {
    try { if (client) await client.close(); }
    finally { try { await reset(); } finally { await native.close(); } }
  }
});
