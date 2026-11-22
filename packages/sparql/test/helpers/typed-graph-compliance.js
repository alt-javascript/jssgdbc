import assert from 'node:assert/strict';
import { namedNode as n, blankNode as b, literal as l, defaultGraph as d } from '../../../core/test/terms.js';

// Remote profile of core typedCompliance: INSERT blank labels are request-local,
// so repeated blank inserts create distinct nodes and identity patterns must reject.
// Capability assertions distinguish typed support from endpoint-dependent guarantees.
export function typedGraphComplianceTests(name, clientFactory) {
  describe(`${name}: typed RDF/JS graph contract`, () => {
    let client, graph;
    const s = n('urn:s'), p = n('urn:p'), o = n('urn:o');
    beforeEach(async () => { client = await clientFactory(); graph = client.getGraph(); });
    afterEach(async () => { await client.close(); });
    it('has structural graph identity, detached names and isolated named/default stores', async () => {
      assert.equal(graph, client.getGraph(d()));
      const name = n('urn:graph'); const named = client.getGraph(name); name.value = 'urn:changed';
      assert.equal(named, client.getGraph(n('urn:graph')));
      assert.equal(named.getName().value, 'urn:graph');
      assert.ok(Object.isFrozen(named.getName()));
      await named.add(s, p, o); assert.equal(await graph.count(), 0);
      const rows = (await named.find()).getTriples();
      assert.equal(rows[0].termType, 'Quad'); assert.ok(rows[0].graph.equals(n('urn:graph')));
    });
    it('deduplicates exact terms but preserves lexical, datatype and language distinctions', async () => {
      const objects = [o, b('o'), l('o'), l('o','en'), l('o','fr'), l('01','', 'http://www.w3.org/2001/XMLSchema#integer'), l('1','', 'http://www.w3.org/2001/XMLSchema#integer')];
      for (const object of objects) { await graph.add(s,p,object); await graph.add(n('urn:s'),n('urn:p'),structuredClone(object)); }
      assert.equal(await graph.count(), objects.length + 1);
      for (const object of objects) {
        if (object.termType === 'BlankNode') {
          for (const method of ['find', 'has', 'count', 'remove']) await assert.rejects(graph[method](null,undefined,object), /Blank-node identity/);
        } else assert.equal(await graph.count(null,undefined,object),1);
      }
      await graph.remove(null,null,l('o','en')); assert.equal(await graph.count(),objects.length);
      assert.equal(await graph.has(s,p,l('o','en')),false);
    });
    it('supports null/undefined wildcards and snapshots cursor results as compatible quads', async () => {
      await graph.add(s,p,o); await graph.add(b('s'),p,l('text'));
      const cursor = await graph.find(); await graph.clear();
      assert.equal(cursor.getTriples().length,2); assert.equal(await cursor.next(),true);
      const q = cursor.getTriple(); assert.equal(q.value,''); assert.ok(q.equals(cursor.getTriples()[0]));
      assert.ok(q.graph.equals(d())); assert.ok(Object.isFrozen(q)); assert.ok(Object.isFrozen(q.subject));
      cursor.close(); assert.throws(() => cursor.getTriple(), /closed/);
      assert.equal(await graph.count(),0);
    });
    it('detaches caller terms before pending writes and rejects strings/invalid positions', async () => {
      const object = l('original'); const pending = graph.add(s,p,object);
      object.value = 'changed'; object.datatype.value = 'urn:changed'; await pending;
      assert.equal(await graph.has(s,p,l('original')),true);
      for (const args of [['urn:s',p,o],[s,b('p'),o],[l('s'),p,o],[null,p,o],[s,p,d()]]) {
        await assert.rejects(graph.add(...args),TypeError);
      }
      await assert.rejects(graph.find('',null,null),TypeError);
      await assert.rejects(graph.remove(null,'*',null),TypeError);
      assert.equal(await graph.count(),1);
    });
    it('rejects unsupported profile features without modifying storage', async () => {
      assert.throws(() => client.getGraph(b('graph')), {name:'UnsupportedRdfFeatureError', position:'graph'});
      assert.throws(() => client.getGraph(''), TypeError);
      assert.throws(() => client.getGraph({termType:'DefaultGraph',value:'not-empty'}), TypeError);
      for (const object of [{termType:'Variable',value:'x'}, {termType:'Quad',value:''}, {...l('x'),direction:'ltr'}]) {
        await assert.rejects(graph.add(s,p,object), {name:'UnsupportedRdfFeatureError'});
      }
      for (const object of [n('relative'), l('x','EN'), {...l('x'),language:'en'}, {...l('x'),datatype:b('dt')}, {...l('x'),value:'\ud800'}]) {
        await assert.rejects(graph.add(s,p,object), TypeError);
      }
      assert.equal(await graph.count(),0);
    });
    it('publishes recursively immutable honest versioned guarantees', () => {
      const c = client.getCapabilities(); assert.equal(c.version,1);
      assert.equal(c.features.defaultGraph.status,'supported');
      assert.equal(c.features.crossGraphAtomicity.status,'unknown');
      assert.equal(c.features.streaming.status,'unavailable');
      assert.ok(Object.isFrozen(c)); assert.ok(Object.isFrozen(c.features));
      for (const feature of Object.values(c.features)) assert.ok(Object.isFrozen(feature));
      assert.throws(() => { c.features.rdf11.status = 'unknown'; }, TypeError);
    });
  });
}
