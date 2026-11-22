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

// Counts only adapter-owned storage; unrelated application labels are permitted.
export const INSPECT_SCHEMA = `CALL { MATCH (n:JssgdbcTerm) RETURN count(n) AS legacyNodes }
CALL { MATCH ()-[r:JSSGDBC_TRIPLE]->() RETURN count(r) AS legacyEdges }
CALL { MATCH (n) WHERE n:${LABELS.term} OR n:${LABELS.graph} RETURN count(n) AS ownedNodes }
CALL { MATCH ()-[r:${LABELS.triple}]->() RETURN count(r) AS ownedEdges }
CALL { MATCH (m:${LABELS.schema}) RETURN collect(properties(m)) AS markers }
RETURN legacyNodes > 0 OR legacyEdges > 0 AS legacy,
ownedNodes > 0 OR ownedEdges > 0 AS owned, markers`;
export const ENSURE_SCHEMA = `MERGE (m:${LABELS.schema} {id: $id})
ON CREATE SET m.version = $version, m.profile = $profile
SET m._jssgdbcLock = true
REMOVE m._jssgdbcLock
RETURN properties(m) AS marker`;
export const SCHEMA_PARAMS = Object.freeze({ id: SCHEMA_ID, version: STORAGE_VERSION, profile: STORAGE_PROFILE });

export class StorageCompatibilityError extends Error {
  constructor() {
    super('Neo4j initialize: incompatible RDF storage schema/profile. Use a separate database or explicitly back up and reset adapter-owned storage under operator control; no automatic reset was performed.');
    this.name = 'StorageCompatibilityError';
  }
}
export function validateMarker(marker) {
  if (!marker || marker.id !== SCHEMA_ID || marker.version !== STORAGE_VERSION || marker.profile !== STORAGE_PROFILE) {
    throw new StorageCompatibilityError();
  }
}
export function validateSchema(result) {
  try {
    if (!Array.isArray(result?.records) || result.records.length !== 1) throw new Error();
    const row = result.records[0];
    const legacy = row.get('legacy'), owned = row.get('owned'), markers = row.get('markers');
    if (typeof legacy !== 'boolean' || typeof owned !== 'boolean' || !Array.isArray(markers)
        || legacy || markers.length > 1 || (owned && markers.length === 0)) throw new Error();
    for (const marker of markers) validateMarker(marker);
  } catch { throw new StorageCompatibilityError(); }
}

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
