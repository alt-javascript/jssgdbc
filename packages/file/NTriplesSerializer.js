import { Lexer, Writer, DataFactory } from 'n3';
import { parseQuad, surfaceTerm } from './NTriplesParser.js';

function readTerm(value) {
  if (typeof value !== 'string' || /[\r\n]/.test(value)) {
    throw new TypeError('Expected a single N-Triples surface term');
  }
  const text = value.trim();
  const tokens = new Lexer({ format: 'N-Triples' }).tokenize(`${text} .\n`);
  const types = tokens.map(token => token.type).join(',');
  if (!/^(IRI|blank|literal)(,(langcode|typeIRI))?,\.,eof$/.test(types)
      || tokens.at(-2).start !== text.length + 1
      || tokens.at(-3).end !== text.length) {
    throw new Error('Expected exactly one N-Triples term without comments or trailing syntax');
  }
  return parseQuad(`<urn:codec:s> <urn:codec:p> ${text} .`).object;
}

export class NTriplesSerializer {
  static serialize(triples) {
    if (!Array.isArray(triples)) throw new TypeError('Expected an array of triples');
    return triples.map((triple, index) => {
      try { return `${this.serializeLine(triple)}\n`; }
      catch (cause) { throw new Error(`Invalid triple at index ${index}: ${cause.message}`, { cause }); }
    }).join('');
  }

  static serializeLine(triple) {
    if (!triple || typeof triple !== 'object' || Array.isArray(triple)
        || Object.keys(triple).length !== 3
        || !['subject', 'predicate', 'object'].every(key => Object.hasOwn(triple, key))) {
      throw new TypeError('Triple must have exactly subject, predicate, and object');
    }
    const terms = {};
    for (const key of ['subject', 'predicate', 'object']) {
      try {
        terms[key] = readTerm(triple[key]);
        if ((key === 'subject' && terms[key].termType === 'Literal')
            || (key === 'predicate' && terms[key].termType !== 'NamedNode')) {
          throw new Error('Illegal RDF term position');
        }
      } catch (cause) {
        throw new Error(`Invalid ${key}: ${cause.message}`, { cause });
      }
    }
    return new Writer({ format: 'N-Triples' })
      .quadToString(terms.subject, terms.predicate, terms.object).trimEnd();
  }

  static serializeTerm(term) { return surfaceTerm(readTerm(term)); }

  static serializeLiteral(literal) {
    const term = readTerm(literal);
    if (term.termType !== 'Literal') throw new TypeError('Expected a literal');
    return surfaceTerm(term);
  }

  static escapeLiteralValue(value) {
    if (typeof value !== 'string') throw new TypeError('Expected a string literal value');
    return surfaceTerm(DataFactory.literal(value)).slice(1, -1);
  }
}
