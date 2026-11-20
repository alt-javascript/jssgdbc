export class SparqlBuilder {
  static buildSelect(graphName, subject, predicate, object) {
    const pattern = this.buildTriplePattern(graphName, subject, predicate, object);
    if (graphName && graphName !== '') {
      return `SELECT ?s ?p ?o WHERE {\n  GRAPH ${this.escapeIri(graphName)} {\n    ${pattern}\n  }\n}`;
    }
    return `SELECT ?s ?p ?o WHERE {\n  ${pattern}\n}`;
  }

  static buildAsk(graphName, subject, predicate, object) {
    const s = this.formatTerm(subject, 'subject');
    const p = this.formatTerm(predicate, 'predicate');
    const o = this.formatTerm(object, 'object');

    if (graphName && graphName !== '') {
      return `ASK {\n  GRAPH ${this.escapeIri(graphName)} {\n    ${s} ${p} ${o} .\n  }\n}`;
    }
    return `ASK {\n  ${s} ${p} ${o} .\n}`;
  }

  static buildCount(graphName, subject, predicate, object) {
    const pattern = this.buildTriplePattern(graphName, subject, predicate, object);
    if (graphName && graphName !== '') {
      return `SELECT (COUNT(*) AS ?count) WHERE {\n  GRAPH ${this.escapeIri(graphName)} {\n    ${pattern}\n  }\n}`;
    }
    return `SELECT (COUNT(*) AS ?count) WHERE {\n  ${pattern}\n}`;
  }

  static buildInsertData(graphName, subject, predicate, object) {
    const s = this.formatTerm(subject, 'subject');
    const p = this.formatTerm(predicate, 'predicate');
    const o = this.formatTerm(object, 'object');

    if (graphName && graphName !== '') {
      return `INSERT DATA {\n  GRAPH ${this.escapeIri(graphName)} {\n    ${s} ${p} ${o} .\n  }\n}`;
    }
    return `INSERT DATA {\n  ${s} ${p} ${o} .\n}`;
  }

  static buildDelete(graphName, subject, predicate, object) {
    const hasWildcard = subject === null || subject === undefined ||
                       predicate === null || predicate === undefined ||
                       object === null || object === undefined;

    if (!hasWildcard) {
      // All terms bound: DELETE DATA
      const s = this.formatTerm(subject, 'subject');
      const p = this.formatTerm(predicate, 'predicate');
      const o = this.formatTerm(object, 'object');

      if (graphName && graphName !== '') {
        return `DELETE DATA {\n  GRAPH ${this.escapeIri(graphName)} {\n    ${s} ${p} ${o} .\n  }\n}`;
      }
      return `DELETE DATA {\n  ${s} ${p} ${o} .\n}`;
    }

    // Has wildcard: DELETE/WHERE
    const pattern = this.buildTriplePattern(graphName, subject, predicate, object);
    if (graphName && graphName !== '') {
      return `DELETE {\n  GRAPH ${this.escapeIri(graphName)} {\n    ${pattern}\n  }\n}\nWHERE {\n  GRAPH ${this.escapeIri(graphName)} {\n    ${pattern}\n  }\n}`;
    }
    return `DELETE {\n  ${pattern}\n}\nWHERE {\n  ${pattern}\n}`;
  }

  static buildClear(graphName) {
    if (!graphName || graphName === '') {
      return 'CLEAR DEFAULT';
    }
    return `CLEAR GRAPH ${this.escapeIri(graphName)}`;
  }

  static formatTerm(value, position) {
    if (value === null || value === undefined) {
      // Convert position to variable name
      switch (position) {
        case 'subject':
          return '?s';
        case 'predicate':
          return '?p';
        case 'object':
          return '?o';
        default:
          return '?x';
      }
    }

    // Already formatted terms: pass through
    if (typeof value === 'string') {
      if (value.startsWith('<') || value.startsWith('_:') || value.startsWith('"')) {
        return value;
      }
      // Bare string: wrap in angle brackets with IRI escaping
      return this.escapeIri(value);
    }

    return String(value);
  }

  static escapeIri(iri) {
    if (iri.startsWith('<') && iri.endsWith('>')) {
      return iri;
    }

    // Characters disallowed in SPARQL IRI references: space, <, >, {, }, |, ^, backtick, \
    const disallowedChars = /[ <>{}\|^\`\\]/g;

    const escaped = iri.replace(disallowedChars, (char) => {
      const code = char.charCodeAt(0);
      return `%${code.toString(16).toUpperCase().padStart(2, '0')}`;
    });

    return `<${escaped}>`;
  }

  static buildTriplePattern(graphName, subject, predicate, object) {
    const s = this.formatTerm(subject, 'subject');
    const p = this.formatTerm(predicate, 'predicate');
    const o = this.formatTerm(object, 'object');

    return `${s} ${p} ${o} .`;
  }
}
