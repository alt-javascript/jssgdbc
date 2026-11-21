import { normalizeTerm } from '@alt-javascript/jssgdbc-core/internal/string-term';
import { Graph, Cursor } from '@alt-javascript/jssgdbc-core';
import { SparqlBuilder } from './SparqlBuilder.js';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = operation => new Error(`SPARQL ${operation}: invalid result`);
const wildcard = value => value === null || value === undefined;

function bindings(result, operation) {
  if (!record(result) || !record(result.results) || !Array.isArray(result.results.bindings)
      || !result.results.bindings.every(record)) throw invalid(operation);
  return result.results.bindings;
}

function decode(term, operation) {
  if (!record(term) || typeof term.value !== 'string') throw invalid(operation);
  if (term.type === 'uri') return term.value;
  if (term.type === 'bnode') return `_:${term.value}`;
  if (term.type !== 'literal' && term.type !== 'typed-literal') throw invalid(operation);
  const language = term['xml:lang'];
  const datatype = term.datatype;
  if ((language !== undefined && (typeof language !== 'string' || !/^[a-zA-Z]+(?:-[a-zA-Z0-9]+)*$/.test(language)))
      || (datatype !== undefined && (typeof datatype !== 'string' || datatype.length === 0))
      || (term.type === 'typed-literal' && datatype === undefined)) throw invalid(operation);
  const escaped = term.value.replace(/["\\\x00-\x1f\x7f-\x9f]/g, char => {
    const escapes = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
    return escapes[char] ?? `\\u${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
  });
  // Language takes precedence over the rdf:langString datatype supplied by some endpoints.
  try {
    return normalizeTerm(`"${escaped}"${language !== undefined ? `@${language}` : datatype !== undefined ? `^^<${datatype}>` : ''}`);
  } catch { throw invalid(operation); }
}

function decodePosition(term, position) {
  try { return normalizeTerm(decode(term, 'SELECT'), position); }
  catch { throw invalid('SELECT'); }
}

/** Buffered results: memory grows with response rows; no pagination or streaming. */
export class SparqlGraph extends Graph {
  _checkClosed() {
    super._checkClosed();
    this._client._checkClosed();
  }

  async _find(subject, predicate, object) {
    const result = await this._client._query(SparqlBuilder.buildSelect(this._name, subject, predicate, object));
    const pattern = [subject, predicate, object];
    const positions = ['subject', 'predicate', 'object'];
    const variables = ['s', 'p', 'o'];
    const triples = bindings(result, 'SELECT').map(row => {
      // Validate even unexpected/bound-position bindings rather than silently discarding unsupported terms.
      for (const term of Object.values(row)) decode(term, 'SELECT');
      return Object.fromEntries(positions.map((position, i) => [position,
        wildcard(pattern[i]) ? decodePosition(row[variables[i]], position) : pattern[i]]));
    });
    return new Cursor(triples);
  }

  async _has(subject, predicate, object) {
    const result = await this._client._query(SparqlBuilder.buildAsk(this._name, subject, predicate, object));
    if (!record(result) || typeof result.boolean !== 'boolean') throw invalid('ASK');
    return result.boolean;
  }

  async _count(subject, predicate, object) {
    const result = await this._client._query(SparqlBuilder.buildCount(this._name, subject, predicate, object));
    const rows = bindings(result, 'COUNT');
    const term = rows[0]?.count;
    if (rows.length !== 1 || !record(term) || !['literal', 'typed-literal'].includes(term.type)
        || typeof term.value !== 'string' || !/^\+?\d+$/.test(term.value)) throw invalid('COUNT');
    decode(term, 'COUNT');
    const count = Number(term.value);
    if (!Number.isSafeInteger(count) || count < 0) throw invalid('COUNT');
    return count;
  }

  async _add(subject, predicate, object) {
    await this._client._update(SparqlBuilder.buildInsertData(this._name, subject, predicate, object));
  }

  async _remove(subject, predicate, object) {
    await this._client._update(SparqlBuilder.buildDelete(this._name, subject, predicate, object));
  }

  async _clear() {
    await this._client._update(SparqlBuilder.buildClear(this._name));
  }
}
