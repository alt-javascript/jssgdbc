import { Client } from '../core/Client.js';
import { MemoryGraph } from './MemoryGraph.js';
import { termKey, createQuad, snapshotTerm } from '../core/RdfTerm.js';
import { createCapabilities } from '../core/Capabilities.js';

const CAPABILITIES = createCapabilities({
  rdf11: { status: 'supported', detail: 'RDF 1.1 terms; graph names restricted to NamedNode and DefaultGraph' },
  namedGraphs: { status: 'supported' }, defaultGraph: { status: 'supported' },
  blankNodeGraphs: { status: 'unavailable' }, rdfStar: { status: 'unavailable' },
  variables: { status: 'unavailable' }, persistence: { status: 'unavailable', detail: 'Client-local volatile storage' },
  transactions: { status: 'unavailable' }, crossGraphAtomicity: { status: 'unavailable' },
  streaming: { status: 'unavailable', detail: 'Buffered cursor snapshots; linear scans' },
  duplicateQuads: { status: 'unavailable', detail: 'Structural set semantics; repeated add is a no-op' }
});

export class MemoryClient extends Client {
  constructor(driver, url, properties) {
    super(driver, url, properties);
    // Stores outlive individual graph handles; core close evicts handles, not data.
    this._stores = new Map();
    this._blankSequence = 0;
  }

  getCapabilities() { return CAPABILITIES; }

  _loadDatasetGraph(graph) {
    return [...(this._stores.get(termKey(graph)) ?? [])];
  }

  _scopeDataset(quads) {
    const used = new Set();
    for (const store of this._stores.values()) {
      for (const q of store) {
        for (const t of [q.subject, q.object]) if (t.termType === 'BlankNode') used.add(t.value);
      }
    }
    const mapping = new Map();
    const scope = term => {
      if (term.termType !== 'BlankNode') return term;
      if (!mapping.has(term.value)) {
        let value;
        do { value = `jsgdbc-save-${++this._blankSequence}`; } while (used.has(value));
        used.add(value);
        mapping.set(term.value, snapshotTerm({ termType: 'BlankNode', value }));
      }
      return mapping.get(term.value);
    };
    return quads.map(q => createQuad(scope(q.subject), q.predicate, scope(q.object), q.graph));
  }

  _saveDatasetGraph(graph, quads, mode) {
    const key = termKey(graph);
    let store = this._stores.get(key);
    if (!store) { store = []; this._stores.set(key, store); }
    // Preserve the array identity held by existing Graph handles.
    const quadKey = q => JSON.stringify([q.subject, q.predicate, q.object].map(termKey));
    const seen = new Set(mode === 'replace' ? [] : store.map(quadKey));
    if (mode === 'replace') store.length = 0;
    for (const q of quads) {
      const identity = quadKey(q);
      if (!seen.has(identity)) { seen.add(identity); store.push(q); }
    }
  }

  _getGraph(name) {
    const key = termKey(name);
    let store = this._stores.get(key);
    if (!store) {
      store = [];
      this._stores.set(key, store);
    }
    return new MemoryGraph(this, name, store);
  }
}
