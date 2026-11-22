import { randomUUID } from 'node:crypto';
import { Graph, Cursor, snapshotTerm, createQuad, XSD_STRING, RDF_LANG_STRING } from '@alt-javascript/jssgdbc-core';
import { SparqlBuilder } from './SparqlBuilder.js';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = operation => new Error(`SPARQL ${operation}: invalid result`);

export function bindings(result, operation) {
  if (!record(result) || 'boolean' in result || !record(result.head) || !Array.isArray(result.head.vars)
      || !result.head.vars.every(v => typeof v === 'string') || new Set(result.head.vars).size !== result.head.vars.length
      || !record(result.results) || !Array.isArray(result.results.bindings)
      || !result.results.bindings.every(record)) throw invalid(operation);
  return result.results.bindings;
}

/** One decoder per response, never per row or per client. */
export function responseDecoder(operation = 'SELECT') {
  const blanks = new Map(), scope = randomUUID();
  return (term, position = 'object') => {
    try {
      if (!record(term) || typeof term.value !== 'string') throw invalid(operation);
      let value;
      if (term.type === 'uri' || term.type === 'bnode') {
        if ('datatype' in term || 'xml:lang' in term) throw invalid(operation);
        if (term.type === 'uri') value = { termType: 'NamedNode', value: term.value };
        else {
          snapshotTerm({ termType: 'BlankNode', value: term.value }, position);
          if (!blanks.has(term.value)) blanks.set(term.value, `${scope}_${blanks.size}`);
          value = { termType: 'BlankNode', value: blanks.get(term.value) };
        }
      } else if (term.type === 'literal' || term.type === 'typed-literal') {
        if ('xml:lang' in term && (typeof term['xml:lang'] !== 'string' || !term['xml:lang'])) throw invalid(operation);
        if ('datatype' in term && typeof term.datatype !== 'string') throw invalid(operation);
        if (term.type === 'typed-literal' && (!term.datatype || 'xml:lang' in term)) throw invalid(operation);
        const language = term['xml:lang']?.toLowerCase() ?? '';
        value = { termType: 'Literal', value: term.value, language,
          datatype: { termType: 'NamedNode', value: term.datatype ?? (language ? RDF_LANG_STRING : XSD_STRING) } };
      } else throw invalid(operation);
      return snapshotTerm(value, position);
    } catch { throw invalid(operation); }
  };
}

/** Typed, buffered graph operations; remote blank identity is response-local. */
export class SparqlGraph extends Graph {
  async _add(s, p, o) { await this._client._update(SparqlBuilder.buildInsertData(this._name, s, p, o)); }
  async _remove(s, p, o) { await this._client._update(SparqlBuilder.buildDelete(this._name, s, p, o)); }
  async _find(subject, predicate, object) {
    const result = await this._client._query(SparqlBuilder.buildSelect(this._name, subject, predicate, object));
    const rows = bindings(result, 'SELECT'), decode = responseDecoder();
    const positions = ['subject', 'predicate', 'object'], vars = ['s', 'p', 'o'];
    if (result.head.vars.some(v => !vars.includes(v)) || vars.some(v => !result.head.vars.includes(v))) throw invalid('SELECT');
    const bound = [subject, predicate, object];
    const quads = rows.map(row => {
      if (Object.keys(row).some(v => !vars.includes(v))) throw invalid('SELECT');
      const terms = vars.map((v, i) => {
        const decoded = Object.hasOwn(row, v) ? decode(row[v], positions[i]) : null;
        if (bound[i] != null) {
          if (decoded && !bound[i].equals(decoded)) throw invalid('SELECT');
          return bound[i];
        }
        if (!decoded) throw invalid('SELECT');
        return decoded;
      });
      return createQuad(...terms, this._name);
    });
    return new Cursor(quads);
  }
  async _has(s, p, o) {
    const result = await this._client._query(SparqlBuilder.buildAsk(this._name, s, p, o));
    if (!record(result) || typeof result.boolean !== 'boolean' || 'results' in result
        || ('head' in result && !record(result.head))) throw invalid('ASK');
    return result.boolean;
  }
  async _count(s, p, o) {
    const result = await this._client._query(SparqlBuilder.buildCount(this._name, s, p, o));
    const rows = bindings(result, 'COUNT');
    if (result.head.vars.length !== 1 || result.head.vars[0] !== 'count' || rows.length !== 1
        || Object.keys(rows[0]).length !== 1 || !Object.hasOwn(rows[0], 'count')) throw invalid('COUNT');
    const count = responseDecoder('COUNT')(rows[0].count);
    if (count.termType !== 'Literal' || count.language || count.datatype.value !== 'http://www.w3.org/2001/XMLSchema#integer'
        || !/^\+?\d+$/.test(count.value)) throw invalid('COUNT');
    const value = Number(count.value);
    if (!Number.isSafeInteger(value) || value < 0) throw invalid('COUNT');
    return value;
  }
  async _clear() { await this._client._update(SparqlBuilder.buildClear(this._name)); }
}
