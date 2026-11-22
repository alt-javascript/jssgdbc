import { Client } from '../core/Client.js';
import { MemoryGraph } from './MemoryGraph.js';
import { termKey } from '../core/RdfTerm.js';
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
  }

  getCapabilities() { return CAPABILITIES; }

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
