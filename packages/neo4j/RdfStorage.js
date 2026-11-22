import { snapshotTerm, termKey, createQuad, defaultGraph } from '@alt-javascript/jssgdbc-core';

// Incompatible with the legacy string representation. Admission gating belongs
// to client initialization; these labels must never match legacy records.
export const STORAGE_VERSION = '1';
export const STORAGE_PROFILE = 'rdfjs-structural-v1';
export const SCHEMA_ID = 'jssgdbc-rdf';
export const LABELS = Object.freeze({ term: 'JssgdbcRdfTerm', graph: 'JssgdbcRdfGraph', schema: 'JssgdbcRdfSchema', triple: 'JSSGDBC_RDF_TRIPLE' });
export const CONSTRAINTS = Object.freeze([
  `CREATE CONSTRAINT jssgdbc_rdf_term_identity IF NOT EXISTS FOR (t:${LABELS.term}) REQUIRE (t.graph, t.key) IS UNIQUE`,
  `CREATE CONSTRAINT jssgdbc_rdf_graph_identity IF NOT EXISTS FOR (g:${LABELS.graph}) REQUIRE g.key IS UNIQUE`,
  `CREATE CONSTRAINT jssgdbc_rdf_schema_identity IF NOT EXISTS FOR (m:${LABELS.schema}) REQUIRE m.id IS UNIQUE`
]);

export function graphKey(graph = defaultGraph()) {
  return termKey(snapshotTerm(graph, 'graph'));
}

// Blank value/key is deliberately independent of graph partition. Dataset save
// can scope blank identifiers once before invoking this codec for each graph.
export function encodeTerm(term, position = 'object') {
  const copy = snapshotTerm(term, position);
  return { key: termKey(copy), termType: copy.termType, value: copy.value,
    language: copy.termType === 'Literal' ? copy.language : '',
    datatype: copy.termType === 'Literal' ? copy.datatype.value : '' };
}

export function decodeTerm(record, graph, position = 'object') {
  try {
    if (!record || typeof record !== 'object' || record.graph !== graphKey(graph)
        || typeof record.key !== 'string' || typeof record.language !== 'string'
        || typeof record.datatype !== 'string') throw new Error();
    const term = snapshotTerm({ termType: record.termType, value: record.value,
      language: record.language, datatype: { termType: 'NamedNode', value: record.datatype } }, position);
    if (termKey(term) !== record.key || (term.termType !== 'Literal' && (record.language !== '' || record.datatype !== ''))) throw new Error();
    return term;
  } catch { throw new Error('Neo4j RDF storage: invalid term record'); }
}

export function decodeTriple(record, graph) {
  try {
    const quad = createQuad(decodeTerm(record.subject, graph, 'subject'),
      { termType: 'NamedNode', value: record.predicate }, decodeTerm(record.object, graph), graph);
    return { subject: quad.subject, predicate: quad.predicate, object: quad.object };
  } catch { throw new Error('Neo4j RDF storage: invalid triple record'); }
}
