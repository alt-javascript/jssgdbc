import { UnsupportedOperationError } from './errors.js';
import { snapshotTerm, defaultGraph } from './RdfTerm.js';

export class Graph {
  constructor(client, name = defaultGraph()) {
    this._client = client;
    this._name = snapshotTerm(name, 'graph');
    this._closed = false;
    this._closePromise = null;
    this._activeOperations = new Set();
  }

  getName() {
    return this._name;
  }

  async add(subject, predicate, object) {
    this._checkClosed();
    return this._runOperation(() => this._add(snapshotTerm(subject, 'subject'), snapshotTerm(predicate, 'predicate'), snapshotTerm(object)));
  }

  async remove(subject, predicate, object) {
    this._checkClosed();
    return this._runOperation(() => this._remove(...this._pattern(subject, predicate, object)));
  }

  async find(subject, predicate, object) {
    this._checkClosed();
    return this._runOperation(() => this._find(...this._pattern(subject, predicate, object)));
  }

  async has(subject, predicate, object) {
    this._checkClosed();
    return this._runOperation(() => this._has(...this._pattern(subject, predicate, object)));
  }

  async count(subject, predicate, object) {
    this._checkClosed();
    return this._runOperation(() => this._count(...this._pattern(subject, predicate, object)));
  }

  _pattern(subject, predicate, object) {
    return [snapshotTerm(subject, 'subject', true), snapshotTerm(predicate, 'predicate', true), snapshotTerm(object, 'object', true)];
  }

  async clear() {
    this._checkClosed();
    return this._runOperation(() => this._clear());
  }

  _add(subject, predicate, object) {
    throw new UnsupportedOperationError('add not implemented');
  }

  _remove(subject, predicate, object) {
    throw new UnsupportedOperationError('remove not implemented');
  }

  _find(subject, predicate, object) {
    throw new UnsupportedOperationError('find not implemented');
  }

  _has(subject, predicate, object) {
    throw new UnsupportedOperationError('has not implemented');
  }

  _count(subject, predicate, object) {
    throw new UnsupportedOperationError('count not implemented');
  }

  _clear() {
    throw new UnsupportedOperationError('clear not implemented');
  }

  // Register before invoking the adapter, including synchronous/reentrant work.
  _runOperation(operation) {
    let resolve, reject;
    const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
    this._activeOperations.add(pending);
    const release = () => { this._activeOperations.delete(pending); };
    pending.then(release, release);
    try { resolve(operation()); } catch (error) { reject(error); }
    return pending;
  }

  close() {
    if (this._closePromise) return this._closePromise;
    this._closed = true;
    this._closePromise = Promise.allSettled([...this._activeOperations])
      .then(() => this._close());
    this._client?._graphClosing(this);
    const release = () => { this._client?._graphClosed(this); };
    // Both branches handle settlement without creating an unobserved rejection.
    this._closePromise.then(release, release);
    return this._closePromise;
  }

  // Adapter resource release only: never await the owning client's close here.
  // Public operation admission already happened; do not recheck closure mid-work.
  _close() {}

  isClosed() {
    return this._closed;
  }

  _checkClosed() {
    if (this._closed) {
      throw new Error('Graph is closed');
    }
    this._client?._checkClosed();
  }
}
