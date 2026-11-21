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

// Classify API strings only; never parse, normalize, or coerce supplied values.
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
  return { kind, value };
}

/** Pure, parameterized statements; transport and result decoding belong to the adapter. */
export class CypherBuilder {
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
