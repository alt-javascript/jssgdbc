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
      const quads = this._validateDatasetQuads(await this._loadSelectedDataset(selected), selected);
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
        const scoped = Object.freeze(this._validateDatasetQuads(this._scopeDataset(Object.freeze(snapshot)), selected));
        const byKey = new Map(outcomes.map(outcome => [termKey(outcome.graph), outcome]));
        let active = true;
        const update = (graphs, status) => {
          if (!active) throw new Error('Dataset progress is no longer active');
          const keys = graphs.map(termKey);
          if (keys.some(key => !byKey.has(key))) {
            throw new TypeError('Progress contains an unselected graph');
          }
          for (const key of keys) {
            const outcome = byKey.get(key);
            if (outcome.status !== 'committed') outcome.status = status;
          }
        };
        const progress = Object.freeze({
          dispatched: (graphs = selected) => update(graphs, 'unknown'),
          committed: (graphs = selected) => update(graphs, 'committed')
        });
        try {
          await this._saveSelectedDataset(selected, scoped, mode, progress);
          progress.committed();
        } finally { active = false; }
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
    return Object.freeze([...unique.values()]);
  }

  _enqueueDataset(operation) {
    const pending = this._datasetTail.then(operation);
    // A failure must not poison subsequent admissions or become unhandled.
    this._datasetTail = pending.then(() => {}, () => {});
    return pending;
  }

  _validateDatasetQuads(quads, graphs) {
    const keys = new Set(graphs.map(termKey));
    const copies = [];
    for (const q of quads) {
      if (q?.termType !== 'Quad' || q.value !== '') throw new TypeError('Expected RDF/JS Quad');
      const copy = createQuad(q.subject, q.predicate, q.object, snapshotTerm(q.graph, 'graph'));
      if (!keys.has(termKey(copy.graph))) throw new TypeError('Adapter returned an unselected graph');
      copies.push(copy);
    }
    return copies;
  }

  // Override these hooks to preserve a single request/response blank-node scope.
  async _loadSelectedDataset(graphs) {
    const quads = [];
    for (const graph of graphs) {
      for (const quad of this._validateDatasetQuads(await this._loadDatasetGraph(graph), [graph])) quads.push(quad);
    }
    return quads;
  }

  async _saveSelectedDataset(graphs, quads, mode, progress) {
    const groups = new Map(graphs.map(graph => [termKey(graph), []]));
    for (const q of quads) groups.get(termKey(q.graph)).push(q);
    for (const graph of graphs) {
      progress.dispatched([graph]);
      await this._saveDatasetGraph(graph, Object.freeze(groups.get(termKey(graph))), mode);
      progress.committed([graph]);
    }
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
