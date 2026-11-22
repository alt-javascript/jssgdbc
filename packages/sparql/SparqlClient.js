import { Client, createCapabilities, createQuad, defaultGraph, termKey } from '@alt-javascript/jssgdbc-core';
import { SparqlGraph, bindings, responseDecoder } from './SparqlGraph.js';
import { SparqlBuilder } from './SparqlBuilder.js';

const CAPABILITIES = createCapabilities({
  rdf11: { status: 'supported', detail: 'Typed RDF 1.1; blanks are request-local on insert and response-local on load. Blank identity query/delete is unavailable.' },
  namedGraphs: { status: 'supported' },
  defaultGraph: { status: 'supported', detail: 'Uses the endpoint configured default graph, which may be a union view.' },
  blankNodeGraphs: { status: 'unavailable' }, rdfStar: { status: 'unavailable' }, variables: { status: 'unavailable' },
  persistence: { status: 'unknown', detail: 'Durability depends on endpoint configuration.' },
  transactions: { status: 'unavailable' },
  crossGraphAtomicity: { status: 'unknown', detail: 'One HTTP request is not a transaction guarantee.' },
  streaming: { status: 'unavailable', detail: 'Buffered O(quads + graphs) memory; queued saves retain snapshots. GET URL and update/response size limits depend on endpoint/proxy. Bound input and await saves.' },
  duplicateQuads: { status: 'unavailable' }
});

const URL_PREFIX = 'jssgdbc:sparql:';

/** Buffered HTTP transport. Timeouts bound I/O duration, not response memory. */
export class SparqlClient extends Client {
  constructor(driver, url, properties = {}) {
    super(driver, url, properties);
    try {
      if (typeof url !== 'string' || !url.startsWith(URL_PREFIX)) throw new Error();
      this._endpoint = new URL(url.slice(URL_PREFIX.length));
      if (!['http:', 'https:'].includes(this._endpoint.protocol)
          || this._endpoint.username || this._endpoint.password) throw new Error();
    } catch {
      throw new Error('Invalid SPARQL endpoint URL');
    }
    if (properties === null || typeof properties !== 'object') {
      throw new Error('Invalid SPARQL properties');
    }
    this._timeoutMs = properties.timeoutMs === undefined ? 30000 : properties.timeoutMs;
    if (typeof this._timeoutMs !== 'number' || !Number.isFinite(this._timeoutMs) || this._timeoutMs <= 0) {
      throw new Error('SPARQL timeoutMs must be a positive finite number');
    }
    try {
      this._headers = new Headers(properties.headers);
    } catch {
      throw new Error('Invalid SPARQL headers');
    }
  }

  getCapabilities() { return CAPABILITIES; }

  // Serialization allocates one blank-label map for the entire update. The
  // endpoint allocates fresh identities per INSERT DATA request.
  _scopeDataset(quads) { return quads; }

  async _loadSelectedDataset(graphs) {
    const result = await this._requestOwned('query', SparqlBuilder.buildDatasetSelect(graphs));
    const rows = bindings(result, 'dataset SELECT');
    const vars = ['s', 'p', 'o', 'g'];
    const invalid = () => new Error('SPARQL dataset SELECT: invalid result provenance or bindings');
    if (result.head.vars.length !== 4 || vars.some(v => !result.head.vars.includes(v))) throw invalid();
    const selected = new Set(graphs.map(termKey));
    const decode = responseDecoder('dataset SELECT');
    return rows.map(row => {
      if (Object.keys(row).some(v => !vars.includes(v))) throw invalid();
      const graph = Object.hasOwn(row, 'g') ? decode(row.g, 'graph') : defaultGraph();
      if (!selected.has(termKey(graph))) throw invalid();
      return createQuad(decode(row.s, 'subject'), decode(row.p, 'predicate'), decode(row.o, 'object'), graph);
    });
  }

  async _saveSelectedDataset(graphs, quads, mode, progress) {
    const text = SparqlBuilder.buildDatasetUpdate(graphs, quads, mode);
    if (!text) return; // Empty merge is an acknowledged no-op.
    await this._requestOwned('update', text, () => progress.dispatched());
  }

  _getGraph(name) {
    return new SparqlGraph(this, name);
  }

  async _query(text) {
    return this._request('query', text);
  }

  async _update(text) {
    await this._request('update', text);
  }

  async _request(operation, text) {
    if (this.isClosed()) throw new Error(`SPARQL ${operation}: client is closed`);
    return this._requestOwned(operation, text);
  }

  // Only admitted operations use this path, including queued Dataset work during close.
  async _requestOwned(operation, text, dispatched = () => {}) {
    const controller = new AbortController();
    const deadline = performance.now() + this._timeoutMs;
    let timer;
    // Chunk large timeouts to avoid Node's signed 32-bit timer overflow.
    const arm = () => {
      const remaining = deadline - performance.now();
      if (remaining <= 0) controller.abort();
      else timer = setTimeout(arm, Math.min(remaining, 2147483647));
    };
    arm();
    let category = 'network';
    try {
      const url = new URL(this._endpoint);
      const headers = new Headers(this._headers);
      const options = { headers, redirect: 'error', signal: controller.signal };
      if (operation === 'query') {
        url.searchParams.set('query', text);
        headers.set('Accept', 'application/sparql-results+json');
        options.method = 'GET';
      } else {
        headers.set('Content-Type', 'application/sparql-update');
        options.method = 'POST';
        options.body = text;
      }
      dispatched();
      const response = await fetch(url, options);
      if (!response.ok) {
        category = `HTTP ${response.status}`;
        // Do not retain or expose an error response body.
        await response.body?.cancel();
        throw new Error();
      }
      // Reading separately distinguishes broken transport from invalid JSON.
      const body = await response.text();
      if (operation === 'query') {
        category = 'JSON';
        return JSON.parse(body);
      }
      return undefined;
    } catch {
      throw new Error(`SPARQL ${operation}: ${controller.signal.aborted ? 'timeout' : category} failure`);
    } finally {
      clearTimeout(timer);
    }
  }
}
