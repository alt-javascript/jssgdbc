import assert from 'node:assert/strict';

/** Destructive typed Dataset contract. Supply a fresh, disposable client and
 * independent RDF/JS DataFactory/DatasetFactory, plus a full Dataset factory.
 * Deliberately separate from legacy string compliance; never auto-skip adapters.
 */
export async function datasetCompliance(client, rdf, external, factory) {
  const d = rdf.defaultGraph(), g = rdf.namedNode('urn:contract:g');
  const h = rdf.namedNode('urn:contract:unrelated');
  const s = rdf.namedNode('urn:contract:s'), p = rdf.namedNode('urn:contract:p');
  const b = rdf.blankNode('shared'), type = rdf.namedNode('http://www.w3.org/2001/XMLSchema#integer');
  const input = external.dataset([
    rdf.quad(s, p, rdf.literal('01', type), d),
    rdf.quad(s, p, rdf.literal('1', type), d),
    rdf.quad(b, p, rdf.literal('hello', 'en'), d),
    rdf.quad(s, p, b, g)
  ]);
  try {
    assert.equal(client.getGraph(), client.getGraph(d));
    assert.equal(client.getGraph(g), client.getGraph(rdf.namedNode(g.value)));
    assert.notEqual(client.getGraph(), client.getGraph(g));
    const capabilities = client.getCapabilities();
    assert.equal(capabilities.version, 1);
    assert(Object.isFrozen(capabilities));
    assert(Object.isFrozen(capabilities.features));
    assert.deepEqual(Object.keys(capabilities.features).sort(), [
      'rdf11', 'namedGraphs', 'defaultGraph', 'blankNodeGraphs', 'rdfStar',
      'variables', 'persistence', 'transactions', 'crossGraphAtomicity', 'streaming', 'duplicateQuads'
    ].sort());
    for (const entry of Object.values(capabilities.features)) {
      assert(Object.isFrozen(entry));
      assert(['supported', 'configured', 'unavailable', 'unknown'].includes(entry.status));
      if (entry.detail !== undefined) assert.equal(typeof entry.detail, 'string');
      assert.throws(() => { entry.status = 'configured'; }, TypeError);
    }
    assert.throws(() => { capabilities.version = 2; }, TypeError);
    assert.throws(() => { capabilities.features.rdf11 = {}; }, TypeError);
    // These portable declarations are exercised by the typed round trip, graph
    // selection and merge/set semantics below; backend guarantees stay separate.
    for (const key of ['rdf11', 'namedGraphs', 'defaultGraph']) {
      assert.equal(capabilities.features[key].status, 'supported');
    }
    for (const key of ['blankNodeGraphs', 'rdfStar', 'variables', 'streaming', 'duplicateQuads']) {
      assert.equal(capabilities.features[key].status, 'unavailable');
    }
    const outcomes = await client.saveDataset(input, { graphs: [d, g, rdf.namedNode(g.value)] });
    assert.deepEqual(outcomes.map(o => o.status), ['committed', 'committed']);
    const loaded = await client.loadDataset({ graphs: [d, g], factory });
    assert(loaded.equals(input), 'round trip must preserve cross-graph blank sharing');
    loaded.deleteMatches();
    assert.equal((await client.loadDataset({ graphs: [d, g], factory })).size, 4);
    await client.saveDataset(input, { graphs: [d, g] });
    assert.equal((await client.loadDataset({ graphs: [d, g], factory })).size, 6);
    await client.saveDataset(input, { graphs: [d, g], mode: 'replace' });
    assert((await client.loadDataset({ graphs: [d, g], factory })).equals(input));
    assert.equal(input.size, 4);
    assert.equal([...input][2].subject.value, 'shared');
    await assert.rejects(client.saveDataset(input, { graphs: [d], mode: 'replace' }), TypeError);
    await assert.rejects(client.saveDataset([], { graphs: [] }), TypeError);
    assert((await client.loadDataset({ graphs: [d, g], factory })).equals(input));
    await client.saveDataset([rdf.quad(s, p, s, h)], { graphs: [h] });
    const handle = client.getGraph(g);
    await client.saveDataset([], { graphs: [d, g], mode: 'replace' });
    assert.equal(await handle.count(), 0);
    assert.equal(await client.getGraph(h).count(), 1);
    await handle.close();
    assert.notEqual(client.getGraph(g), handle);
    const admitted = client.loadDataset({ graphs: [h], factory });
    const closing = client.close();
    await assert.rejects(client.loadDataset({ graphs: [h], factory }), /closed/i);
    assert.equal((await admitted).size, 1);
    await closing;
  } finally { await client.close(); }
}
