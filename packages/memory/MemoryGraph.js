import { Graph } from '../core/Graph.js';
import { Cursor } from '../core/Cursor.js';
import { createQuad } from '../core/RdfTerm.js';

export class MemoryGraph extends Graph {
  constructor(client, name, store) {
    super(client, name);
    this._store = store;
  }

  _add(subject, predicate, object) {
    const triple = createQuad(subject, predicate, object, this._name);
    const exists = this._store.some(t =>
      t.equals(triple)
    );
    if (!exists) {
      this._store.push(triple);
    }
    return undefined;
  }

  _remove(subject, predicate, object) {
    for (let i = this._store.length - 1; i >= 0; i--) {
      const t = this._store[i];
      if (this._matchesPattern(t, subject, predicate, object)) {
        this._store.splice(i, 1);
      }
    }
    return undefined;
  }

  _find(subject, predicate, object) {
    const matches = this._store.filter(t =>
      this._matchesPattern(t, subject, predicate, object)
    );
    return new Cursor(matches);
  }

  _has(subject, predicate, object) {
    return this._store.some(t =>
      this._matchesPattern(t, subject, predicate, object)
    );
  }

  _count(subject, predicate, object) {
    let count = 0;
    for (const t of this._store) if (this._matchesPattern(t, subject, predicate, object)) count++;
    return count;
  }

  _clear() {
    this._store.length = 0;
    return undefined;
  }

  _matchesPattern(triple, subject, predicate, object) {
    return (subject === null || subject === undefined || triple.subject.equals(subject)) &&
           (predicate === null || predicate === undefined || triple.predicate.equals(predicate)) &&
           (object === null || object === undefined || triple.object.equals(object));
  }
}
