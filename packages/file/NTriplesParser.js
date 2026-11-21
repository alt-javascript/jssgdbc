import { Parser, Writer, DataFactory } from 'n3';

const anchor = DataFactory.namedNode('urn:jssgdbc:codec');
const prefix = '<urn:jssgdbc:codec> <urn:jssgdbc:codec> ';

// Use the N-Triples writer for escaping, without exposing RDF/JS terms publicly.
export function surfaceTerm(term) {
  return new Writer({ format: 'N-Triples' })
    .quadToString(anchor, anchor, term).slice(prefix.length, -3).trimEnd();
}

export function parseQuad(line) {
  if (typeof line !== 'string' || /[\r\n]/.test(line)) {
    throw new TypeError('Expected one N-Triples line');
  }
  const quads = new Parser({ format: 'N-Triples', blankNodePrefix: '' }).parse(line);
  if (quads.length !== 1) throw new Error('Expected exactly one triple');
  const quad = quads[0];
  if (!['NamedNode', 'BlankNode'].includes(quad.subject.termType)
      || quad.predicate.termType !== 'NamedNode'
      || !['NamedNode', 'BlankNode', 'Literal'].includes(quad.object.termType)
      || quad.graph.termType !== 'DefaultGraph') {
    throw new Error('Invalid N-Triples term positions');
  }
  return quad;
}

export class NTriplesParser {
  static parse(text) {
    if (typeof text !== 'string') throw new TypeError('Expected N-Triples text');
    const triples = [];
    const lines = text.split(/\r\n|[\r\n]/);
    for (let i = 0; i < lines.length; i++) {
      if (/^[\t ]*(?:#.*)?$/.test(lines[i])) continue;
      try {
        triples.push(this.parseLine(lines[i]));
      } catch (cause) {
        throw new Error(`Parse error at line ${i + 1}: ${cause.message}`, { cause });
      }
    }
    return triples;
  }

  static parseLine(line) {
    try {
      const quad = parseQuad(line);
      return {
        subject: surfaceTerm(quad.subject),
        predicate: surfaceTerm(quad.predicate),
        object: surfaceTerm(quad.object),
      };
    } catch (cause) {
      throw new Error(`Invalid N-Triples line: ${cause.message}`, { cause });
    }
  }
}
