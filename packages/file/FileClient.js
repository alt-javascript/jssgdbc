import { Client } from '../core/Client.js';
import { FileGraph } from './FileGraph.js';
import { FileGraphStore } from './FileGraphStore.js';
import { termKey } from '../core/RdfTerm.js';
import { createCapabilities } from '../core/Capabilities.js';

const CAPABILITIES = createCapabilities({
  rdf11: { status: 'supported' }, namedGraphs: { status: 'supported' }, defaultGraph: { status: 'supported' },
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
