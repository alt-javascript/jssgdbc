import { Graph } from '../core/Graph.js';
import { normalizeTerm } from '../core/StringTerm.js';
import { Cursor } from '../core/Cursor.js';
import { NTriplesParser } from './NTriplesParser.js';
import { NTriplesSerializer } from './NTriplesSerializer.js';

export class FileGraph extends Graph {
  constructor(client, name, storage) {
    super(client, name);
    this._storage = storage;
    this._store = [];
    this._loaded = false;
    this._tail = Promise.resolve();
  }

  // Register queued work with core admission/draining, not only running I/O.
  _runOperation(operation) {
    return super._runOperation(() => {
      const pending = this._tail.then(operation);
      this._tail = pending.then(() => {}, () => {});
      return pending;
    });
  }

  async _ensureLoaded() {
    if (this._loaded) {
      return;
    }

    const text = await this._storage.read(this._name);
    this._store = NTriplesParser.parse(text).map(triple => Object.fromEntries(
      Object.entries(triple).map(([position, term]) => [position, this._normalizeTerm(normalizeTerm(term, position))])
    ));

    this._loaded = true;
  }

  async _add(subject, predicate, object) {
    await this._ensureLoaded();
    const normalized = {
      subject: this._normalizeTerm(subject),
      predicate: this._normalizeTerm(predicate),
      object: this._normalizeTerm(object)
    };
    const exists = this._store.some(t =>
      t.subject === normalized.subject &&
      t.predicate === normalized.predicate &&
      t.object === normalized.object
    );
    if (!exists) {
      await this._flush([...this._store, normalized]);
    }
    return undefined;
  }

  async _remove(subject, predicate, object) {
    await this._ensureLoaded();
    const next = this._store.filter(t => !this._matchesPattern(t, subject, predicate, object));
    if (next.length !== this._store.length) await this._flush(next);
    return undefined;
  }

  async _find(subject, predicate, object) {
    await this._ensureLoaded();
    const matches = this._store.filter(t =>
      this._matchesPattern(t, subject, predicate, object)
    );
    const denormalized = matches.map(t => ({
      subject: this._denormalizeTerm(t.subject),
      predicate: this._denormalizeTerm(t.predicate),
      object: this._denormalizeTerm(t.object)
    }));
    return new Cursor(denormalized);
  }

  async _has(subject, predicate, object) {
    await this._ensureLoaded();
    return this._store.some(t =>
      this._matchesPattern(t, subject, predicate, object)
    );
  }

  async _count(subject, predicate, object) {
    await this._ensureLoaded();
    return this._store.filter(t =>
      this._matchesPattern(t, subject, predicate, object)
    ).length;
  }

  async _clear() {
    await this._ensureLoaded();
    await this._flush([]);
    return undefined;
  }

  _normalizeTerm(term) {
    if (term === null || term === undefined) {
      return term;
    }
    if (typeof term !== 'string') {
      return term;
    }
    if (term.startsWith('<') || term.startsWith('_:') || term.startsWith('"')) {
      return term;
    }
    return `<${term}>`;
  }

  _denormalizeTerm(term) {
    if (term === null || term === undefined) {
      return term;
    }
    if (typeof term !== 'string') {
      return term;
    }
    if (term.startsWith('<') && term.endsWith('>')) {
      return term.slice(1, -1);
    }
    return term;
  }

  _matchesPattern(triple, subject, predicate, object) {
    const normalizedSubject = this._normalizeTerm(subject);
    const normalizedPredicate = this._normalizeTerm(predicate);
    const normalizedObject = this._normalizeTerm(object);
    return (normalizedSubject === null || normalizedSubject === undefined || triple.subject === normalizedSubject) &&
           (normalizedPredicate === null || normalizedPredicate === undefined || triple.predicate === normalizedPredicate) &&
           (normalizedObject === null || normalizedObject === undefined || triple.object === normalizedObject);
  }

  async _flush(next) {
    const text = NTriplesSerializer.serialize(next);
    await this._storage.write(this._name, text);
    this._store = next;
  }
}
