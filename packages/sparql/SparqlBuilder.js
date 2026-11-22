import { snapshotTerm, termKey, defaultGraph, UnsupportedRdfFeatureError, XSD_STRING } from '@alt-javascript/jssgdbc-core';

/** Buffered RDF/JS codec. A blank map belongs to exactly one update request. */
export class SparqlBuilder {
  static wrap(graph, pattern) {
    const name = snapshotTerm(graph === undefined ? defaultGraph() : graph, 'graph');
    return name.termType === 'DefaultGraph' ? pattern : `GRAPH ${this.escapeIri(name)} {\n    ${pattern}\n  }`;
  }

  static buildDatasetSelect(graphs) {
    const branches = graphs.map(graph => `{ ${this.wrap(graph, '?s ?p ?o .')}${graph.termType === 'NamedNode' ? ` BIND(${this.escapeIri(graph)} AS ?g)` : ''} }`);
    return `SELECT ?s ?p ?o ?g WHERE { ${branches.join(' UNION ')} }`;
  }

  static buildDatasetUpdate(graphs, quads, mode) {
    const blanks = new Map();
    const groups = new Map(graphs.map(graph => [termKey(graph), { graph, triples: [] }]));
    for (const quad of quads) {
      const triple = ['subject', 'predicate', 'object'].map(position => this.formatTerm(quad[position], position, blanks)).join(' ') + ' .';
      groups.get(termKey(quad.graph)).triples.push(triple);
    }
    const operations = mode === 'replace' ? graphs.map(graph => this.buildClear(graph)) : [];
    if (quads.length) operations.push(`INSERT DATA {\n${[...groups.values()].filter(group => group.triples.length).map(group => this.wrap(group.graph, group.triples.join('\n'))).join('\n')}\n}`);
    return operations.join(';\n');
  }

  static buildSelect(graph, s, p, o) {
    return `SELECT ?s ?p ?o WHERE {\n  ${this.wrap(graph, this.buildTriplePattern(graph, s, p, o))}\n}`;
  }
  static buildAsk(graph, s, p, o) {
    return `ASK {\n  ${this.wrap(graph, this.buildTriplePattern(graph, s, p, o))}\n}`;
  }
  static buildCount(graph, s, p, o) {
    return `SELECT (COUNT(*) AS ?count) WHERE {\n  ${this.wrap(graph, this.buildTriplePattern(graph, s, p, o))}\n}`;
  }
  static buildInsertData(graph, s, p, o) {
    if ([s, p, o].some(t => t == null)) throw new TypeError('INSERT DATA requires bound subject, predicate, and object');
    const blanks = new Map();
    const pattern = [s, p, o].map((t, i) => this.formatTerm(t, ['subject', 'predicate', 'object'][i], blanks)).join(' ') + ' .';
    return `INSERT DATA {\n  ${this.wrap(graph, pattern)}\n}`;
  }
  static buildDelete(graph, s, p, o) {
    const body = this.wrap(graph, this.buildTriplePattern(graph, s, p, o));
    return [s, p, o].some(t => t == null)
      ? `DELETE {\n  ${body}\n}\nWHERE {\n  ${body}\n}` : `DELETE DATA {\n  ${body}\n}`;
  }
  static buildClear(graph) {
    const name = snapshotTerm(graph === undefined ? defaultGraph() : graph, 'graph');
    return name.termType === 'DefaultGraph' ? 'CLEAR DEFAULT' : this.buildDelete(name, null, null, null);
  }
  static buildTriplePattern(graph, s, p, o) {
    snapshotTerm(graph === undefined ? defaultGraph() : graph, 'graph');
    return [s, p, o].map((t, i) => this.formatTerm(t, ['subject', 'predicate', 'object'][i])).join(' ') + ' .';
  }
  static formatTerm(value, position, blanks) {
    const t = snapshotTerm(value, position, true);
    if (t === null) return { subject: '?s', predicate: '?p', object: '?o' }[position];
    if (t.termType === 'NamedNode') return this.escapeIri(t);
    if (t.termType === 'BlankNode') {
      if (!blanks) throw new UnsupportedRdfFeatureError('Blank-node identity patterns are unavailable in SPARQL', { feature: 'blankNodeIdentity', position });
      const key = termKey(t);
      if (!blanks.has(key)) blanks.set(key, `b${blanks.size}`);
      return `_:${blanks.get(key)}`;
    }
    const lexical = '"' + t.value.replace(/["\\\x00-\x1f\x7f-\x9f]/g, c => ({ '"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t' }[c] ?? `\\u${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`)) + '"';
    return lexical + (t.language ? `@${t.language}` : t.datatype.value === XSD_STRING ? '' : `^^${this.escapeIri(t.datatype)}`);
  }
  static escapeIri(term) {
    // Reject illegal IRIs instead of percent-encoding them into different RDF terms.
    return `<${snapshotTerm(term, 'predicate').value}>`;
  }
}
