import { Writer, DataFactory } from 'n3';
import { createQuad, defaultGraph, snapshotTerm, termKey } from '../core/RdfTerm.js';
import { encodeTerm, surfaceTerm } from './NTriplesParser.js';

export class NTriplesSerializer {
  static serialize(quads, graph = quads?.[0]?.graph ?? defaultGraph()) {
    if (!Array.isArray(quads)) throw new TypeError('Expected an array of quads');
    graph = snapshotTerm(graph, 'graph');
    return quads.map((quad, index) => {
      try { return `${this.serializeLine(quad, graph)}\n`; }
      catch (cause) { throw new Error(`Invalid quad at index ${index}: ${cause.message}`, { cause }); }
    }).join('');
  }

  static serializeLine(quad, graph = quad?.graph ?? defaultGraph()) {
    if (!quad || !quad.graph) throw new TypeError('Expected a typed quad with graph');
    const copy = createQuad(quad.subject, quad.predicate, quad.object, quad.graph);
    if (termKey(copy.graph) !== termKey(snapshotTerm(graph, 'graph'))) throw new Error('Graph identity mismatch');
    return new Writer({ format: 'N-Triples' }).quadToString(
      encodeTerm(copy.subject), copy.predicate, encodeTerm(copy.object)).trimEnd();
  }

  static serializeTerm(term) { return surfaceTerm(encodeTerm(snapshotTerm(term))); }
  static serializeLiteral(literal) {
    const term = snapshotTerm(literal);
    if (term.termType !== 'Literal') throw new TypeError('Expected a literal');
    return surfaceTerm(term);
  }
  static escapeLiteralValue(value) {
    if (typeof value !== 'string') throw new TypeError('Expected a string literal value');
    return this.serializeLiteral(DataFactory.literal(value)).slice(1, -1);
  }
}
