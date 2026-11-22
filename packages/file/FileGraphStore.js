import { snapshotTerm, termKey, createQuad } from '../core/RdfTerm.js';
import { NTriplesParser } from './NTriplesParser.js';
import { NTriplesSerializer } from './NTriplesSerializer.js';

const quadKey = q => JSON.stringify([q.subject, q.predicate, q.object].map(termKey));
export const matches = (q, s, p, o) => [s, p, o].every((term, i) =>
  term == null || termKey(term) === termKey(q[['subject', 'predicate', 'object'][i]]));

// One queue and committed snapshot per client/identity, not per public handle.
// Whole-graph buffering; no coordination with other clients or processes.
export class FileGraphStore {
  constructor(storage, name) {
    this.name = snapshotTerm(name, 'graph');
    this.storage = storage;
    this._state = null;
    this._tail = Promise.resolve();
  }

  _enqueue(operation) {
    const pending = this._tail.then(operation);
    this._tail = pending.then(() => {}, () => {});
    return pending;
  }

  async _load() {
    if (this._state === null) {
      const text = await this.storage.read(this.name);
      const rows = NTriplesParser.parse(text, this.name);
      this._state = Object.freeze([...new Map(rows.map(q => [quadKey(q), q])).values()]);
    }
    return this._state;
  }

  read(operation = rows => rows) {
    return this._enqueue(async () => operation(await this._load()));
  }

  mutate(operation) {
    return this._enqueue(async () => {
      const previous = await this._load();
      const candidate = operation(previous);
      if (candidate === previous) return;
      const next = Object.freeze(candidate.map(q => {
        const copy = createQuad(q.subject, q.predicate, q.object, q.graph);
        if (termKey(copy.graph) !== termKey(this.name)) throw new TypeError('Graph identity mismatch');
        return copy;
      }));
      const text = NTriplesSerializer.serialize(next, this.name);
      try { await this.storage.write(this.name, text); }
      catch (error) {
        // A rejected write may have renamed already. Never retry automatically:
        // the next operation reloads authoritative disk state for reconciliation.
        this._state = null;
        throw error;
      }
      this._state = next;
    });
  }

  drain() { return this._tail; }
}
