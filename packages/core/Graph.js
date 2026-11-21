import { UnsupportedOperationError } from './errors.js';
import { normalizeTerm } from './StringTerm.js';

export class Graph {
  constructor(client, name) {
    this._client = client;
    this._name = name;
    this._closed = false;
  }

  getName() {
    return this._name;
  }

  async add(subject, predicate, object) {
    this._checkClosed();
    return this._add(normalizeTerm(subject, 'subject'), normalizeTerm(predicate, 'predicate'), normalizeTerm(object));
  }

  async remove(subject, predicate, object) {
    this._checkClosed();
    return this._remove(...this._pattern(subject, predicate, object));
  }

  async find(subject, predicate, object) {
    this._checkClosed();
    return this._find(...this._pattern(subject, predicate, object));
  }

  async has(subject, predicate, object) {
    this._checkClosed();
    return this._has(...this._pattern(subject, predicate, object));
  }

  async count(subject, predicate, object) {
    this._checkClosed();
    return this._count(...this._pattern(subject, predicate, object));
  }

  _pattern(subject, predicate, object) {
    return [normalizeTerm(subject, 'subject', true), normalizeTerm(predicate, 'predicate', true), normalizeTerm(object, 'object', true)];
  }

  async clear() {
    this._checkClosed();
    return this._clear();
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

  close() {
    this._closed = true;
  }

  isClosed() {
    return this._closed;
  }

  _checkClosed() {
    if (this._closed) {
      throw new Error('Graph is closed');
    }
  }
}
