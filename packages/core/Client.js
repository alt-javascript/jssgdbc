import { UnsupportedOperationError, DatasetSaveError } from './errors.js';
import { DriverManager } from './DriverManager.js';
import { snapshotTerm, termKey, defaultGraph, createQuad } from './RdfTerm.js';
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
    this._datasetTail = Promise.resolve();
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

  // Admission is synchronous up to the first await: caller-owned values never
  // cross the async boundary. Dataset operations serialize, not graph operations.
  async loadDataset({ graphs, factory } = {}) {
    this._checkClosed();
    const selected = this._datasetGraphs(graphs);
    if (typeof factory?.dataset !== 'function') throw new TypeError('Expected DatasetFactory');
    const make = factory.dataset.bind(factory);
    return this._enqueueDataset(async () => {
      const quads = [];
      for (const graph of selected) {
        for (const q of await this._loadDatasetGraph(graph)) {
          const copy = createQuad(q.subject, q.predicate, q.object, snapshotTerm(q.graph, 'graph'));
          if (!copy.graph.equals(graph)) throw new TypeError('Adapter returned an unselected graph');
          quads.push(copy);
        }
      }
      return make(quads);
    });
  }

  async saveDataset(dataset, { graphs, mode = 'merge' } = {}) {
    this._checkClosed();
    const selected = this._datasetGraphs(graphs);
    if (!['merge', 'replace'].includes(mode)) throw new TypeError('Expected merge or replace mode');
    if (typeof dataset?.[Symbol.iterator] !== 'function') throw new TypeError('Expected iterable Dataset');
    const keys = new Set(selected.map(termKey));
    const snapshot = [];
    for (const q of dataset) {
      if (q?.termType !== 'Quad' || q.value !== '') throw new TypeError('Expected RDF/JS Quad');
      const copy = createQuad(q.subject, q.predicate, q.object, snapshotTerm(q.graph, 'graph'));
      if (!keys.has(termKey(copy.graph))) throw new TypeError('Dataset contains an unselected graph');
      snapshot.push(copy);
    }
    return this._enqueueDataset(async () => {
      const outcomes = selected.map(graph => ({ graph, status: 'not-attempted' }));
      try {
        const scoped = this._scopeDataset(snapshot);
        const groups = new Map(selected.map(graph => [termKey(graph), []]));
        for (const q of scoped) groups.get(termKey(q.graph)).push(q);
        for (const outcome of outcomes) {
          outcome.status = 'unknown';
          await this._saveDatasetGraph(outcome.graph, groups.get(termKey(outcome.graph)), mode);
          outcome.status = 'committed';
        }
      } catch (cause) {
        throw new DatasetSaveError('Dataset save failed', cause, outcomes);
      }
      return Object.freeze(outcomes.map(outcome => Object.freeze(outcome)));
    });
  }

  _datasetGraphs(graphs) {
    if (!Array.isArray(graphs) || !graphs.length) throw new TypeError('Expected nonempty graphs array');
    const unique = new Map();
    for (const graph of graphs) {
      const copy = snapshotTerm(graph, 'graph');
      unique.set(termKey(copy), copy);
    }
    return [...unique.values()];
  }

  _enqueueDataset(operation) {
    const pending = this._datasetTail.then(operation);
    // A failure must not poison subsequent admissions or become unhandled.
    this._datasetTail = pending.then(() => {}, () => {});
    return pending;
  }

  // Adapter hooks operate on admitted immutable snapshots, even during close.
  // Resolve a save hook only after that graph is committed; rejection is unknown.
  _loadDatasetGraph(graph) { throw new UnsupportedOperationError('loadDataset not implemented'); }
  _scopeDataset(quads) { throw new UnsupportedOperationError('saveDataset not implemented'); }
  _saveDatasetGraph(graph, quads, mode) { throw new UnsupportedOperationError('saveDataset not implemented'); }

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
      await this._datasetTail;
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
