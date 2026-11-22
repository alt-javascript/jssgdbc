import { snapshotTerm, defaultGraph } from '@alt-javascript/jssgdbc-core';
import { encodeTerm, graphKey, LABELS } from './RdfStorage.js';

const ADD_QUERY = `MERGE (s:${LABELS.term} {graph: $graph, key: $subject.key})
ON CREATE SET s += $subject
MERGE (o:${LABELS.term} {graph: $graph, key: $object.key})
ON CREATE SET o += $object
MERGE (s)-[r:${LABELS.triple} {predicate: $predicate}]->(o)`;
const MATCH_QUERY = `MATCH (s:${LABELS.term} {graph: $graph})-[r:${LABELS.triple}]->(o:${LABELS.term} {graph: $graph})`;

function buildPattern(graph, subject, predicate, object, ending) {
  const params = { graph: graphKey(graph) };
  const filters = [];
  for (const [value, position, binding] of [[subject, 'subject', 's'], [predicate, 'predicate', 'r'], [object, 'object', 'o']]) {
    if (value == null) continue;
    const term = encodeTerm(value, position);
    params[position] = position === 'predicate' ? term.value : term.key;
    filters.push(position === 'predicate' ? 'r.predicate = $predicate' : `${binding}.key = $${position}`);
  }
  return { query: MATCH_QUERY + (filters.length ? `\nWHERE ${filters.join(' AND ')}` : '') + `\n${ending}`, params };
}

/** Pure parameterized statements. Every mutation must acquire buildLock first
 * in the SAME transaction. The separate statement establishes the lock before
 * relationship MERGE and serializes add/remove/clear/Dataset replacement. */
export class CypherBuilder {
  static buildLock(graph = defaultGraph()) {
    return { query: `MERGE (g:${LABELS.graph} {key: $graph})\nSET g._jssgdbcLock = true\nREMOVE g._jssgdbcLock`, params: { graph: graphKey(graph) } };
  }
  static buildFind(graph, subject, predicate, object) {
    return buildPattern(graph, subject, predicate, object, 'RETURN properties(s) AS subject, r.predicate AS predicate, properties(o) AS object');
  }
  static buildHas(graph, subject, predicate, object) {
    return buildPattern(graph, subject, predicate, object, 'RETURN count(r) > 0 AS exists');
  }
  static buildCount(graph, subject, predicate, object) {
    return buildPattern(graph, subject, predicate, object, 'RETURN count(r) AS count');
  }
  static buildRemove(graph, subject, predicate, object) {
    return buildPattern(graph, subject, predicate, object, 'DELETE r');
  }
  static buildClear(graph) { return this.buildRemove(graph); }
  static buildAdd(graph, subject, predicate, object) {
    return { query: ADD_QUERY, params: { graph: graphKey(graph),
      subject: encodeTerm(subject, 'subject'), predicate: snapshotTerm(predicate, 'predicate').value,
      object: encodeTerm(object) } };
  }
}
