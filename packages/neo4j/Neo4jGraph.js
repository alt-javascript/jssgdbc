import neo4j from 'neo4j-driver';
import { Graph, Cursor } from '@alt-javascript/jssgdbc-core';
import { CypherBuilder } from './CypherBuilder.js';

// The write lock survives removal of this temporary property until commit.
// A separate statement ensures relationship MERGE runs only after lock acquisition.
const LOCK_SUBJECT = 'MERGE (s:JssgdbcTerm {graph: $graph, kind: $subjectKind, value: $subject})\n'
  + 'SET s._jssgdbcLock = true\nREMOVE s._jssgdbcLock';
const invalid = operation => new Error(`Neo4j ${operation}: invalid result`);

function decodeRows(rows, aliases, operation, decode) {
  try {
    if (!Array.isArray(rows)) throw new Error();
    return rows.map(row => {
      if (!row || !Array.isArray(row.keys) || row.keys.length !== aliases.length
          || !aliases.every(alias => row.keys.includes(alias)) || typeof row.get !== 'function') throw new Error();
      return decode(Object.fromEntries(aliases.map(alias => [alias, row.get(alias)])));
    });
  } catch { throw invalid(operation); }
}

/** Graph operations own no live cursor/session after their promises resolve. */
export class Neo4jGraph extends Graph {
  _checkClosed() {
    super._checkClosed();
    this._client._checkClosed();
  }

  async _find(subject, predicate, object) {
    const { query, params } = CypherBuilder.buildFind(this._name, subject, predicate, object);
    const rows = await this._client._query(query, params);
    const triples = decodeRows(rows, ['subject', 'predicate', 'object'], 'find', triple => {
      if (!Object.values(triple).every(value => typeof value === 'string')) throw new Error();
      return triple;
    });
    return new Cursor(triples);
  }

  async _has(subject, predicate, object) {
    const { query, params } = CypherBuilder.buildHas(this._name, subject, predicate, object);
    const rows = await this._client._query(query, params);
    const values = decodeRows(rows, ['exists'], 'has', ({ exists }) => {
      if (typeof exists !== 'boolean') throw new Error();
      return exists;
    });
    if (values.length !== 1) throw invalid('has');
    return values[0];
  }

  async _count(subject, predicate, object) {
    const { query, params } = CypherBuilder.buildCount(this._name, subject, predicate, object);
    const rows = await this._client._query(query, params);
    const values = decodeRows(rows, ['count'], 'count', ({ count }) => {
      if (!neo4j.isInt(count) || !count.inSafeRange()) throw new Error();
      const value = count.toNumber();
      if (!Number.isSafeInteger(value) || value < 0) throw new Error();
      return value;
    });
    if (values.length !== 1) throw invalid('count');
    return values[0];
  }

  async _add(subject, predicate, object) {
    const { query, params } = CypherBuilder.buildAdd(this._name, subject, predicate, object);
    const { graph, subjectKind } = params;
    await this._client._execute('add', 'write', async tx => {
      await tx.run(LOCK_SUBJECT, { graph, subjectKind, subject });
      await tx.run(query, params);
    });
  }

  async _remove(subject, predicate, object) {
    const { query, params } = CypherBuilder.buildRemove(this._name, subject, predicate, object);
    await this._client._update(query, params);
  }

  async _clear() {
    const { query, params } = CypherBuilder.buildClear(this._name);
    await this._client._update(query, params);
  }
}
