import { normalizeTerm } from '@alt-javascript/jssgdbc-core/internal/string-term';

const ADD_QUERY = 'MERGE (s:JssgdbcTerm {graph: $graph, kind: $subjectKind, value: $subject})\n'
  + 'MERGE (o:JssgdbcTerm {graph: $graph, kind: $objectKind, value: $object})\n'
  + 'MERGE (s)-[r:JSSGDBC_TRIPLE {predicate: $predicate}]->(o)';

function requireString(value, operation, position, index) {
  if (typeof value !== 'string') {
    throw new TypeError(`${operation}: ${position} (argument ${index}) must be a string`);
  }
  return value;
}

function normalizeGraph(graphName, operation) {
  return requireString(graphName ?? '', operation, 'graphName', 1);
}

// Canonical string identity without coercing typed lexical values.
function encodeTerm(value, operation, position, index) {
  requireString(value, operation, position, index);
  const kind = value.startsWith('"') || value.startsWith("'") ? 'literal'
    : value.startsWith('_:') ? 'blank' : 'iri';
  if (position === 'subject' && kind === 'literal') {
    throw new TypeError(`${operation}: subject (argument ${index}) must be an IRI or blank node`);
  }
  if (position === 'predicate' && kind !== 'iri') {
    throw new TypeError(`${operation}: predicate (argument ${index}) must be an IRI`);
  }
  return { kind, value: normalizeTerm(value, position) };
}

const MATCH_QUERY = 'MATCH (s:JssgdbcTerm {graph: $graph})-[r:JSSGDBC_TRIPLE]->(o:JssgdbcTerm {graph: $graph})';

function buildPattern(operation, graphName, subject, predicate, object, ending) {
  const params = { graph: normalizeGraph(graphName, operation) };
  const filters = [];
  for (const [value, position, index, binding] of [
    [subject, 'subject', 2, 's'],
    [predicate, 'predicate', 3, 'r'],
    [object, 'object', 4, 'o'],
  ]) {
    if (value === null || value === undefined) continue;
    const term = encodeTerm(value, operation, position, index);
    if (position === 'predicate') {
      filters.push('r.predicate = $predicate');
    } else {
      params[`${position}Kind`] = term.kind;
      filters.push(`${binding}.kind = $${position}Kind`, `${binding}.value = $${position}`);
    }
    params[position] = term.value;
  }
  return {
    query: MATCH_QUERY + (filters.length ? `\nWHERE ${filters.join(' AND ')}` : '') + `\n${ending}`,
    params,
  };
}

/** Pure, parameterized statements; transport and result decoding belong to the adapter. */
export class CypherBuilder {
  static buildFind(graphName, subject, predicate, object) {
    return buildPattern('buildFind', graphName, subject, predicate, object,
      'RETURN s.value AS subject, r.predicate AS predicate, o.value AS object');
  }

  static buildHas(graphName, subject, predicate, object) {
    return buildPattern('buildHas', graphName, subject, predicate, object,
      'RETURN count(r) > 0 AS exists');
  }

  static buildCount(graphName, subject, predicate, object) {
    return buildPattern('buildCount', graphName, subject, predicate, object,
      'RETURN count(r) AS count');
  }

  static buildRemove(graphName, subject, predicate, object) {
    return buildPattern('buildRemove', graphName, subject, predicate, object, 'DELETE r');
  }

  static buildClear(graphName) {
    return buildPattern('buildClear', graphName, null, null, null, 'DELETE r');
  }

  static buildAdd(graphName, subject, predicate, object) {
    const operation = 'buildAdd';
    const graph = normalizeGraph(graphName, operation);
    const s = encodeTerm(subject, operation, 'subject', 2);
    const p = encodeTerm(predicate, operation, 'predicate', 3);
    const o = encodeTerm(object, operation, 'object', 4);
    return {
      query: ADD_QUERY,
      params: {
        graph,
        subjectKind: s.kind,
        subject: s.value,
        predicate: p.value,
        objectKind: o.kind,
        object: o.value,
      },
    };
  }
}
