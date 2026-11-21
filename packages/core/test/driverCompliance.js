import { expect } from 'chai';
import assert from 'node:assert/strict';
import { Client } from '../Client.js';
import { Graph } from '../Graph.js';

/**
 * Shared compliance test generator for jssgdbc drivers.
 *
 * This skeleton provides the structure for driver compliance testing.
 * Drivers implement their own tests by calling driverComplianceTests()
 * and providing a clientFactory function.
 *
 * @param {string} suiteName - Name for the test suite
 * @param {Function} clientFactory - Async function returning a Client instance
 * @param {Object} options - Optional test configuration
 * @returns {void}
 */
export default function driverComplianceTests(suiteName, clientFactory, options = {}) {
  const { skip = false } = options;

  describe(suiteName, function() {
    if (skip) {
      return;
    }

    // Register immediately after acquisition so assertion/setup failures still
    // await every resource; one cleanup failure must not skip sibling cleanup.
    let resources;
    beforeEach(() => { resources = new Set(); });
    const own = resource => { resources.add(resource); return resource; };
    const connect = async () => own(await clientFactory());
    const find = async (graph, ...terms) => own(await graph.find(...terms));
    afterEach(async () => {
      const results = await Promise.allSettled([...resources].map(resource =>
        Promise.resolve().then(() => resource.close())));
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (errors.length) throw new AggregateError(errors, 'Compliance resource cleanup failed');
    });

    describe('lifecycle', () => {
      const terms = ['urn:lifecycle:s', 'urn:lifecycle:p', '"retained"'];
      async function rejectsOperations(graph) {
        for (const method of ['add', 'remove', 'find', 'has', 'count', 'clear']) {
          await assert.rejects(() => graph[method](...terms), /closed/);
        }
      }

      for (const name of ['', 'urn:lifecycle:named']) {
        it(`awaits repeatable ${name || 'default'} close and reacquires retained data`, async () => {
          const client = await connect();
          const graph = client.getGraph(name);
          await graph.clear();
          await graph.add(...terms);
          const cursor = await find(graph);
          const closing = graph.close();
          assert.equal(graph.isClosed(), true);
          assert.equal(graph.close(), closing);
          await closing;
          assert.equal(graph.close(), closing);
          await graph.close();
          await rejectsOperations(graph);
          const fresh = client.getGraph(name);
          assert.notEqual(fresh, graph);
          assert.equal(await fresh.count(), 1);
          assert.equal(await fresh.has(...terms), true);
          // Mutations and owner closure cannot change an already buffered result.
          await fresh.clear();
          await client.close();
          assert.equal(await cursor.next(), true);
          assert.deepEqual(cursor.getTriple(), { subject: terms[0], predicate: terms[1], object: terms[2] });
          assert.equal(await cursor.next(), false);
        });
      }

      it('terminal client close rejects acquisition and all owned graph operations', async () => {
        const client = await connect();
        const graphs = [client.getGraph(), client.getGraph('urn:lifecycle:named')];
        const closing = client.close();
        assert.equal(client.isClosed(), true);
        assert.equal(client.close(), closing);
        for (const name of ['', 'urn:lifecycle:named', 'urn:lifecycle:new']) {
          assert.throws(() => client.getGraph(name), /closed/);
        }
        for (const graph of graphs) await rejectsOperations(graph);
        await closing;
        assert.equal(client.close(), closing);
        await client.close();
        for (const graph of graphs) {
          assert.equal(graph.isClosed(), true);
          await rejectsOperations(graph);
          await graph.close();
        }
        assert.throws(() => client.getGraph(), /closed/);
      });
    });

    describe('Lossless string contract', () => {
      let client, graph;
      beforeEach(async () => {
        client = await connect();
        graph = client.getGraph();
        await graph.clear();
      });

      it('distinguishes equal-content IRI and quoted literal and preserves lexical values', async () => {
        const objects = ['urn:o', '"urn:o"', '"001"^^<http://www.w3.org/2001/XMLSchema#integer>'];
        for (const object of objects) await graph.add('urn:s', 'urn:p', object);
        const cursor = await find(graph, 'urn:s', 'urn:p', null);
        expect(cursor.getTriples().map(t => t.object)).to.have.members(objects);
        expect(await graph.count()).to.equal(3);
        await cursor.close();
        await graph.remove('urn:s', 'urn:p', '"urn:o"');
        expect(await graph.has('urn:s', 'urn:p', 'urn:o')).to.equal(true);
        expect(await graph.has('urn:s', 'urn:p', '"urn:o"')).to.equal(false);
      });

      it('canonicalizes plain/xsd:string and language tag case', async () => {
        for (const object of ['"text"', '"text"^^<http://www.w3.org/2001/XMLSchema#string>', '"bonjour"@FR', '"bonjour"@fr']) {
          await graph.add('urn:s', 'urn:p', object);
        }
        expect((await find(graph)).getTriples().map(t => t.object)).to.have.members(['"text"', '"bonjour"@fr']);
      });

      it('matches canonical IRIs and escapes in all pattern operations', async () => {
        await graph.add('<urn:s>', '<urn:p>', String.raw`"\u96EA\U0001F600"`);
        await graph.add('urn:s', 'urn:p', '"雪😀"');
        expect(await graph.count('urn:s', '<urn:p>', '"雪😀"')).to.equal(1);
        expect(await graph.has('<urn:s>', 'urn:p', String.raw`"\u96EA😀"`)).to.equal(true);
        expect((await find(graph)).getTriples()).to.deep.equal([{ subject: 'urn:s', predicate: 'urn:p', object: '"雪😀"' }]);
        await graph.remove('<urn:s>', 'urn:p', String.raw`"\u96EA😀"`);
        expect(await graph.count()).to.equal(0);
      });

      for (const invalid of ['', 'bare', '<relative>', '"unfinished', '"x"\n', '"x" # comment', '"x" <urn:extra>', '"x"@', '"x"^^<relative>', String.raw`"\uD800"`, String.raw`"\U00110000"`, '_:bad.', '_:bad\n', 42, false]) {
        it(`rejects malformed bound terms before mutation or pattern lookup: ${JSON.stringify(invalid)}`, async () => {
          for (const method of ['add', 'find', 'has', 'count', 'remove']) {
            let error;
            try { await graph[method]('urn:s', 'urn:p', invalid); } catch (caught) { error = caught; }
            expect(error, method).to.be.instanceOf(TypeError);
          }
          expect(await graph.count()).to.equal(0);
        });
      }

      for (const terms of [['"subject"', 'urn:p', 'urn:o'], ['urn:s', '"predicate"', 'urn:o'],
        [null, 'urn:p', 'urn:o'], ['urn:s', 'urn:p', undefined]]) {
        it(`rejects invalid add positions ${JSON.stringify(terms)}`, async () => {
          let error;
          try { await graph.add(...terms); } catch (caught) { error = caught; }
          expect(error, 'invalid add must reject').to.be.instanceOf(Error);
          expect(await graph.count()).to.equal(0);
        });
      }
    });

    describe('Triple add and find', () => {
      it('stores and retrieves a triple', async function() {
        const client = await connect();
        const graph = client.getGraph();
        await graph.add('urn:subject1', 'urn:predicate1', 'urn:object1');
        const cursor = await find(graph, 'urn:subject1', 'urn:predicate1', 'urn:object1');
        const found = await cursor.next();
        expect(found).to.be.true;
        await cursor.close();
        await client.close();
      });
    });

    describe('Triple remove', () => {
      it('removes a stored triple', async function() {
        const client = await connect();
        const graph = client.getGraph();
        await graph.add('urn:subject1', 'urn:predicate1', 'urn:object1');
        await graph.remove('urn:subject1', 'urn:predicate1', 'urn:object1');
        const cursor = await find(graph, 'urn:subject1', 'urn:predicate1', 'urn:object1');
        const found = await cursor.next();
        expect(found).to.be.false;
        await cursor.close();
        await client.close();
      });
    });

    describe('Pattern wildcards (null positions)', () => {
      it('finds triples with null subject wildcard', async function() {
        const client = await connect();
        const graph = client.getGraph();
        await graph.add('urn:subject1', 'urn:predicate1', 'urn:object1');
        await graph.add('urn:subject2', 'urn:predicate1', 'urn:object1');
        const cursor = await find(graph, null, 'urn:predicate1', 'urn:object1');
        let count = 0;
        while (await cursor.next()) count++;
        expect(count).to.equal(2);
        await cursor.close();
        await client.close();
      });

      it('finds triples with null predicate wildcard', async function() {
        const client = await connect();
        const graph = client.getGraph();
        await graph.add('urn:subject1', 'urn:predicate1', 'urn:object1');
        await graph.add('urn:subject1', 'urn:predicate2', 'urn:object1');
        const cursor = await find(graph, 'urn:subject1', null, 'urn:object1');
        let count = 0;
        while (await cursor.next()) count++;
        expect(count).to.equal(2);
        await cursor.close();
        await client.close();
      });

      it('finds triples with null object wildcard', async function() {
        const client = await connect();
        const graph = client.getGraph();
        await graph.add('urn:subject1', 'urn:predicate1', 'urn:object1');
        await graph.add('urn:subject1', 'urn:predicate1', 'urn:object2');
        const cursor = await find(graph, 'urn:subject1', 'urn:predicate1', null);
        let count = 0;
        while (await cursor.next()) count++;
        expect(count).to.equal(2);
        await cursor.close();
        await client.close();
      });
    });

    describe('Named graph isolation', () => {
      it('isolates data between named graphs', async function() {
        const client = await connect();
        const graph1 = client.getGraph('graph1');
        const graph2 = client.getGraph('graph2');
        await graph1.add('urn:subject1', 'urn:predicate1', 'urn:object1');
        const cursor = await find(graph2, 'urn:subject1', 'urn:predicate1', 'urn:object1');
        const found = await cursor.next();
        expect(found).to.be.false;
        await cursor.close();
        await graph1.close();
        await graph2.close();
        await client.close();
      });
    });

    describe('Cursor iteration', () => {
      it('iterates over find results', async function() {
        const client = await connect();
        const graph = client.getGraph();
        await graph.add('urn:s1', 'urn:p', 'urn:o1');
        await graph.add('urn:s1', 'urn:p', 'urn:o2');
        await graph.add('urn:s1', 'urn:p', 'urn:o3');
        const cursor = await find(graph, 'urn:s1', 'urn:p', null);
        const results = [];
        for await (const triple of cursor) {
          results.push(triple);
        }
        expect(results).to.have.length(3);
        await cursor.close();
        await client.close();
      });
    });

    describe('DriverManager URL resolution', () => {
      it('resolves driver URL scheme correctly', async function() {
        const client = await connect();
        expect(client).to.be.instanceof(Client);
        expect(client.getUrl()).to.match(/^jssgdbc:/);
        await client.close();
      });
    });

    describe('Default graph access', () => {
      it('provides default graph via getGraph()', async function() {
        const client = await connect();
        const graph = client.getGraph();
        expect(graph).to.be.instanceof(Graph);
        await graph.close();
        await client.close();
      });
    });
  });
}
