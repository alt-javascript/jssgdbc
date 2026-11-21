import assert from 'node:assert/strict';
import { NTriplesParser as P } from '../NTriplesParser.js';
import { NTriplesSerializer as S } from '../NTriplesSerializer.js';

describe('Lossless string contract: strict file codec', () => {
  const triple = { subject: '<urn:s>', predicate: '<urn:p>', object: '"value"' };
  it('accepts comments, CRLF, empty documents and stable document blank labels', () => {
    assert.deepEqual(P.parse(''), []);
    assert.equal(S.serialize([]), '');
    const rows = P.parse('# heading\r\n_:b <urn:p> "a@b^^c" . # trailing\r\n_:b <urn:p> "second" .');
    assert.equal(rows[0].subject, rows[1].subject);
    assert.equal(rows[0].object, '"a@b^^c"');
  });
  it('canonicalizes only RDF-equivalent lexical syntax', () => {
    assert.equal(P.parseLine('<urn:s> <urn:p> "text"^^<http://www.w3.org/2001/XMLSchema#string> .').object, '"text"');
    assert.equal(P.parseLine('<urn:s> <urn:p> "text"@EN-us .').object, '"text"@en-us');
    assert.equal(P.parseLine('<urn:s> <urn:p> "\\u96EA\\U0001F600" .').object, '"雪😀"');
  });
  it('preserves control escape values through repeated serialization', () => {
    const object = String.raw`"\t\n\r\b\f\u0000"`;
    const once = S.serializeLine({ ...triple, object });
    assert.equal(S.serializeLine(P.parseLine(once)), once);
  });
  it('reports document line and serialization field/index with causes', () => {
    assert.throws(() => P.parse('# heading\n\n<urn:s> <urn:p> "bad\\x" .'), error => /line 3/.test(error.message) && !!error.cause);
    assert.throws(() => S.serialize([triple, { ...triple, predicate: '_:b' }]), /index 1: Invalid predicate/);
  });
  for (const invalid of [null, [], {}, { ...triple, graph: '<urn:g>' },
    { ...triple, subject: '"literal"' }, { ...triple, predicate: '_:b' },
    ...[null, undefined, 42, 'bare', '<relative>', '"x" . # comment', '"x" # comment',
      '"x" <urn:extra>', '"x"\n', '"x"@', '"x"^^<relative>'].map(object => ({ ...triple, object }))]) {
    it(`rejects invalid serializer input ${JSON.stringify(invalid)}`, () => assert.throws(() => S.serializeLine(invalid)));
  }
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
    '<urn:s> <urn:p> <urn:o> . <urn:s> <urn:p> <urn:o> .',
    '<urn:s> _:predicate <urn:o> .',
    '<relative> <urn:p> <urn:o> .',
    '@prefix ex: <urn:example:> .',
    '<urn:s> <urn:p> "x"@ .',
    '<urn:s> <urn:p> "x"^^<relative> .',
    '<urn:s> <urn:p> "x" ; <urn:p> "y" .',
    '<urn:s> <urn:p> "line\nbreak" .',
    String.raw`<urn:s> <urn:p> "bad\uZZZZ" .`,
    String.raw`<urn:s> <urn:p> "bad\U00110000" .`,
  ]) {
    it(`rejects malformed N-Triples: ${line}`, () => assert.throws(() => P.parseLine(line)));
  }
});
