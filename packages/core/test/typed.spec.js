import assert from 'node:assert/strict';
import { Client, Graph, createCapabilities, snapshotTerm, termKey, defaultGraph, createQuad } from '../index.js';
import { namedNode as n, literal as l } from './terms.js';

describe('Typed term and capability primitives', () => {
  it('uses disjoint collision-safe structural keys and compatible equals', () => {
    assert.notEqual(termKey(defaultGraph()), termKey(n('')));
    assert.notEqual(termKey(l('a|b','', 'urn:c')), termKey(l('a','', 'urn:b|c')));
    const term = snapshotTerm(l('01','', 'urn:integer'));
    assert.equal(term.equals(l('01','', 'urn:integer')),true);
    assert.equal(term.equals(l('1','', 'urn:integer')),false);
    assert.equal(term.equals(null),false);
    assert.ok(Object.isFrozen(term.datatype));
    const q = createQuad(n('urn:s'),n('urn:p'),term);
    assert.equal(q.equals({...q, graph:n('urn:graph')}),false);
    assert.equal(q.equals(null),false);
  });
  it('defaults to unknown, accepts all four explicit states, detaches and freezes capability entries', () => {
    const source = {rdf11:{status:'configured', detail:'enabled by caller'}};
    const c = createCapabilities(source); source.rdf11.status = 'unavailable';
    assert.equal(c.features.rdf11.status,'configured');
    assert.equal(c.features.transactions.status,'unknown');
    assert.equal(new Client().getCapabilities().features.rdf11.status,'unknown');
    for (const status of ['supported','configured','unavailable','unknown']) {
      assert.equal(createCapabilities({rdf11:{status}}).features.rdf11.status,status);
    }
    assert.throws(() => createCapabilities({rdf11:{status:'yes'}}),TypeError);
    assert.throws(() => createCapabilities({rdf11:{status:'supported',detail:{}}}),TypeError);
    assert.throws(() => createCapabilities({imaginary:{status:'supported'}}),TypeError);
  });
  it('propagates caller getter failures and synchronous/asynchronous adapter errors and still drains', async () => {
    const failure = new Error('adapter failure');
    class FailingGraph extends Graph {
      _add() { throw failure; }
      async _find() { throw failure; }
    }
    const graph = new FailingGraph(null);
    await assert.rejects(graph.add(n('urn:s'),n('urn:p'),n('urn:o')), e => e === failure);
    await assert.rejects(graph.find(), e => e === failure);
    const object = { get termType() { throw failure; } };
    await assert.rejects(graph.add(n('urn:s'),n('urn:p'),object), e => e === failure);
    await graph.close(); assert.equal(graph.isClosed(),true);
  });
});
