import { Client } from '../core/Client.js';
import { FileGraph } from './FileGraph.js';
import { FileGraphStore } from './FileGraphStore.js';
import { termKey, createQuad, snapshotTerm } from '../core/RdfTerm.js';
import { randomUUID } from 'node:crypto';
import { createCapabilities } from '../core/Capabilities.js';

const CAPABILITIES = createCapabilities({
  rdf11: { status: 'supported', detail: 'Typed Graph CRUD and selected Dataset load/save (merge/replace); each save freshens blank nodes across all selected graphs with a random persistent scope; direct Graph labels retain identity' }, namedGraphs: { status: 'supported' }, defaultGraph: { status: 'supported' },
  persistence: { status: 'supported', detail: 'Whole-graph files; no fsync or multiwriter isolation guarantee' },
  blankNodeGraphs: { status: 'unavailable' }, rdfStar: { status: 'unavailable' }, variables: { status: 'unavailable' },
  transactions: { status: 'unavailable' }, crossGraphAtomicity: { status: 'unavailable' },
  streaming: { status: 'unavailable', detail: 'Buffered graph state and detached cursors' },
  duplicateQuads: { status: 'unavailable', detail: 'Structural set semantics' }
});

export class FileClient extends Client {
  constructor(driver, url, properties, storage) {
    super(driver, url, properties);
    this._storage = storage;
    this._stores = new Map();
  }

  getCapabilities() { return CAPABILITIES; }

  _loadDatasetGraph(graph) {
    return this._getStore(graph).read();
  }

  _scopeDataset(quads) {
    // Stored labels carry the import scope across reopen without a counter file
    // or scanning unrelated graphs. UUID scopes are collision-resistant, not a
    // separate namespace: direct Graph callers can deliberately reuse a label.
    const prefix = `jssgdbc-save-${randomUUID()}-`;
    const mapping = new Map();
    const scope = term => {
      if (term.termType !== 'BlankNode') return term;
      if (!mapping.has(term.value)) {
        mapping.set(term.value, snapshotTerm({ termType: 'BlankNode', value: `${prefix}${mapping.size}` }));
      }
      return mapping.get(term.value);
    };
    return quads.map(q => createQuad(scope(q.subject), q.predicate, scope(q.object), q.graph));
  }

  _saveDatasetGraph(graph, quads, mode) {
    return this._getStore(graph).save(quads, mode);
  }

  _getGraph(name) {
    return new FileGraph(this, name, this._getStore(name));
  }

  _getStore(name) {
    const key = termKey(name);
    if (!this._stores.has(key)) this._stores.set(key, new FileGraphStore(this._storage, name));
    return this._stores.get(key);
  }

  async _close() {
    await Promise.all([...this._stores.values()].map(store => store.drain()));
  }
}
