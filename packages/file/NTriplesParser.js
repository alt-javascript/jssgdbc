import { Parser, Writer, DataFactory } from 'n3';
import { createQuad, defaultGraph, snapshotTerm } from '../core/RdfTerm.js';

const anchor = DataFactory.namedNode('urn:jssgdbc:codec');
const prefix = '<urn:jssgdbc:codec> <urn:jssgdbc:codec> ';
export function surfaceTerm(term) {
  return new Writer({ format: 'N-Triples' })
    .quadToString(anchor, anchor, term).slice(prefix.length, -3).trimEnd();
}

// Every persisted blank label is encoded, including labels that already look
// encoded. Canonical UTF-8 hex is legal N-Triples and injective for scalar strings.
export function encodeTerm(term) {
  return term.termType === 'BlankNode'
    ? DataFactory.blankNode(`b${Buffer.from(term.value, 'utf8').toString('hex')}`) : term;
}
function decodeTerm(term) {
  if (term.termType !== 'BlankNode') return term;
  if (!/^b(?:[0-9a-f]{2})+$/.test(term.value)) throw new Error('Invalid persisted blank label');
  const value = Buffer.from(term.value.slice(1), 'hex').toString('utf8');
  if (`b${Buffer.from(value, 'utf8').toString('hex')}` !== term.value) throw new Error('Invalid UTF-8 blank label');
  return DataFactory.blankNode(value);
}

export function parseQuad(line, graph = defaultGraph()) {
  if (typeof line !== 'string' || /[\r\n]/.test(line)) throw new TypeError('Expected one N-Triples line');
  const quads = new Parser({ format: 'N-Triples', blankNodePrefix: '' }).parse(line);
  if (quads.length !== 1) throw new Error('Expected exactly one triple');
  const quad = quads[0];
  if (quad.graph.termType !== 'DefaultGraph') throw new Error('Invalid N-Triples graph');
  return createQuad(decodeTerm(quad.subject), quad.predicate, decodeTerm(quad.object), graph);
}

export class NTriplesParser {
  static parse(text, graph = defaultGraph()) {
    if (typeof text !== 'string') throw new TypeError('Expected N-Triples text');
    graph = snapshotTerm(graph, 'graph');
    const quads = [];
    const lines = text.split(/\r\n|[\r\n]/);
    for (let i = 0; i < lines.length; i++) {
      if (/^[\t ]*(?:#.*)?$/.test(lines[i])) continue;
      try { quads.push(this.parseLine(lines[i], graph)); }
      catch (cause) { throw new Error(`Parse error at line ${i + 1}: ${cause.message}`, { cause }); }
    }
    return quads;
  }

  static parseLine(line, graph = defaultGraph()) {
    try { return parseQuad(line, graph); }
    catch (cause) { throw new Error(`Invalid N-Triples line: ${cause.message}`, { cause }); }
  }
}
