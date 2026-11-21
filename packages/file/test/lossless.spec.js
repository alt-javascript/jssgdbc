import assert from 'node:assert/strict';
import { NTriplesParser as P } from '../NTriplesParser.js';
import { NTriplesSerializer as S } from '../NTriplesSerializer.js';

describe('Lossless string contract: strict file codec', () => {
  for (const object of ['"mail@example.org"', '"a^^b"', '"mail@example.org^^type"',
    '"quote \\" slash \\\\ 雪"', '"001"^^<http://www.w3.org/2001/XMLSchema#integer>']) {
    it(`preserves literal content ${object}`, () => {
      const triple = { subject: '<urn:s>', predicate: '<urn:p>', object };
      assert.deepEqual(P.parseLine(S.serializeLine(triple)), triple);
    });
  }
  for (const line of [
    '"subject" <urn:p> <urn:o> .',
    '<urn:s> <urn:p> <urn:o> <urn:fourth> .',
    '<urn:s> "predicate" <urn:o> .',
    '<urn:s> <urn:p> "unterminated .',
    '<urn:s> <urn:p> <urn:o> . junk',
  ]) {
    it(`rejects malformed N-Triples: ${line}`, () => assert.throws(() => P.parseLine(line)));
  }
});
