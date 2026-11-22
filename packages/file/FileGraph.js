import { Graph } from '../core/Graph.js';
import { createQuad } from '../core/RdfTerm.js';
import { Cursor } from '../core/Cursor.js';
import { matches } from './FileGraphStore.js';

export class FileGraph extends Graph {
  constructor(client, name, store) {
    super(client, name);
    this._store = store;
  }

  _add(subject, predicate, object) {
    return this._store.mutate(rows => rows.some(q => matches(q, subject, predicate, object))
      ? rows : [...rows, createQuad(subject, predicate, object, this._name)]);
  }

  _remove(subject, predicate, object) {
    return this._store.mutate(rows => {
      const next = rows.filter(q => !matches(q, subject, predicate, object));
      return next.length === rows.length ? rows : next;
    });
  }

  _find(subject, predicate, object) {
    return this._store.read(rows => new Cursor(rows.filter(q => matches(q, subject, predicate, object))));
  }

  _has(subject, predicate, object) {
    return this._store.read(rows => rows.some(q => matches(q, subject, predicate, object)));
  }

  _count(subject, predicate, object) {
    return this._store.read(rows => rows.filter(q => matches(q, subject, predicate, object)).length);
  }

  _clear() { return this._store.mutate(() => []); }
}
