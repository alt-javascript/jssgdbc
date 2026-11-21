import { expect } from 'chai';
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

    describe('Triple add and find', () => {
      it('stores and retrieves a triple', async function() {
        const client = await clientFactory();
        const graph = client.getGraph();
        await graph.add('subject1', 'predicate1', 'object1');
        const cursor = await graph.find('subject1', 'predicate1', 'object1');
        const found = await cursor.next();
        expect(found).to.be.true;
        cursor.close();
        await client.close();
      });
    });

    describe('Triple remove', () => {
      it('removes a stored triple', async function() {
        const client = await clientFactory();
        const graph = client.getGraph();
        await graph.add('subject1', 'predicate1', 'object1');
        await graph.remove('subject1', 'predicate1', 'object1');
        const cursor = await graph.find('subject1', 'predicate1', 'object1');
        const found = await cursor.next();
        expect(found).to.be.false;
        cursor.close();
        await client.close();
      });
    });

    describe('Pattern wildcards (null positions)', () => {
      it('finds triples with null subject wildcard', async function() {
        const client = await clientFactory();
        const graph = client.getGraph();
        await graph.add('subject1', 'predicate1', 'object1');
        await graph.add('subject2', 'predicate1', 'object1');
        const cursor = await graph.find(null, 'predicate1', 'object1');
        let count = 0;
        while (await cursor.next()) count++;
        expect(count).to.equal(2);
        cursor.close();
        await client.close();
      });

      it('finds triples with null predicate wildcard', async function() {
        const client = await clientFactory();
        const graph = client.getGraph();
        await graph.add('subject1', 'predicate1', 'object1');
        await graph.add('subject1', 'predicate2', 'object1');
        const cursor = await graph.find('subject1', null, 'object1');
        let count = 0;
        while (await cursor.next()) count++;
        expect(count).to.equal(2);
        cursor.close();
        await client.close();
      });

      it('finds triples with null object wildcard', async function() {
        const client = await clientFactory();
        const graph = client.getGraph();
        await graph.add('subject1', 'predicate1', 'object1');
        await graph.add('subject1', 'predicate1', 'object2');
        const cursor = await graph.find('subject1', 'predicate1', null);
        let count = 0;
        while (await cursor.next()) count++;
        expect(count).to.equal(2);
        cursor.close();
        await client.close();
      });
    });

    describe('Named graph isolation', () => {
      it('isolates data between named graphs', async function() {
        const client = await clientFactory();
        const graph1 = client.getGraph('graph1');
        const graph2 = client.getGraph('graph2');
        await graph1.add('subject1', 'predicate1', 'object1');
        const cursor = await graph2.find('subject1', 'predicate1', 'object1');
        const found = await cursor.next();
        expect(found).to.be.false;
        cursor.close();
        graph1.close();
        graph2.close();
        await client.close();
      });
    });

    describe('Cursor iteration', () => {
      it('iterates over find results', async function() {
        const client = await clientFactory();
        const graph = client.getGraph();
        await graph.add('s1', 'p', 'o1');
        await graph.add('s1', 'p', 'o2');
        await graph.add('s1', 'p', 'o3');
        const cursor = await graph.find('s1', 'p', null);
        const results = [];
        for await (const triple of cursor) {
          results.push(triple);
        }
        expect(results).to.have.length(3);
        cursor.close();
        await client.close();
      });
    });

    describe('DriverManager URL resolution', () => {
      it('resolves driver URL scheme correctly', async function() {
        const client = await clientFactory();
        expect(client).to.be.instanceof(Client);
        expect(client.getUrl()).to.match(/^jssgdbc:/);
        await client.close();
      });
    });

    describe('Default graph access', () => {
      it('provides default graph via getGraph()', async function() {
        const client = await clientFactory();
        const graph = client.getGraph();
        expect(graph).to.be.instanceof(Graph);
        graph.close();
        await client.close();
      });
    });
  });
}
