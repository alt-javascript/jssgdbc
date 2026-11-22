import { UnsupportedOperationError } from './errors.js';
import { DriverManager } from './DriverManager.js';
import { snapshotTerm, termKey, defaultGraph } from './RdfTerm.js';
import { createCapabilities } from './Capabilities.js';
const UNKNOWN_CAPABILITIES = createCapabilities();

export class Client {
  constructor(driver, url, properties) {
    this._driver = driver;
    this._url = url;
    this._properties = properties;
    this._graphs = new Map();
    this._closed = false;
    this._closePromise = null;
    this._ownedGraphs = new Set();
  }

  getCapabilities() { return UNKNOWN_CAPABILITIES; }

  getGraph(name = defaultGraph()) {
    this._checkClosed();
    const identity = snapshotTerm(name, 'graph');
    const key = termKey(identity);
    if (this._graphs.has(key)) {
      return this._graphs.get(key);
    }
    const graph = this._getGraph(identity);
    this._graphs.set(key, graph);
    this._ownedGraphs.add(graph);
    return graph;
  }

  _getGraph(name) {
    throw new UnsupportedOperationError('_getGraph not implemented');
  }

  getUrl() {
    return this._url;
  }

  _graphClosing(graph) {
    const key = termKey(graph.getName());
    if (this._graphs.get(key) === graph) {
      this._graphs.delete(key);
    }
    // Ownership survives cache eviction until resource cleanup settles.
  }

  _graphClosed(graph) {
    this._ownedGraphs.delete(graph);
  }

  close() {
    if (this._closePromise) return this._closePromise;
    this._closed = true;
    const owned = [...this._ownedGraphs];
    // Defer invocation so the cached promise exists even for reentrant hooks.
    this._closePromise = Promise.resolve().then(async () => {
      const outcomes = await Promise.allSettled(
        owned.map(graph => Promise.resolve().then(() => graph.close()))
      );
      const errors = outcomes.filter(result => result.status === 'rejected')
        .map(result => result.reason);
      try { await this._close(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, 'Client cleanup failed');
    });
    return this._closePromise;
  }

  // Adapter release happens only after all owned graph cleanup has settled.
  _close() {}

  isClosed() {
    return this._closed;
  }

  _checkClosed() {
    if (this._closed) {
      throw new Error('Client is closed');
    }
  }
}

export class ClientDataSource {
  constructor(url, properties) {
    this._url = url;
    this._properties = properties;
  }

  async getClient() {
    return DriverManager.getClient(this._url, this._properties);
  }
}
