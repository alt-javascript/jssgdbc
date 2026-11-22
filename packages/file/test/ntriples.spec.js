import assert from 'node:assert/strict';
import { DataFactory as f } from 'n3';
import { createQuad, defaultGraph } from '../../core/RdfTerm.js';
import { NTriplesParser as Parser } from '../NTriplesParser.js';
import { NTriplesSerializer as Serializer } from '../NTriplesSerializer.js';
const s = f.namedNode('urn:s'), p = f.namedNode('urn:p');
const integer = f.namedNode('http://www.w3.org/2001/XMLSchema#integer');

describe('typed persisted N-Triples codecs', () => {
  for (const graph of [defaultGraph(), f.namedNode('urn:graph')]) {
    for (const object of [f.namedNode('urn:o'), f.literal(''), f.literal('hello'),
      f.literal('bonjour', 'fr'), f.literal('hello', 'en-us'),
      f.literal('01', integer), f.literal('1', integer), f.literal('not-an-integer', integer),
      f.literal('line\n\r\ttab "quote" \\ café 😀\u0000')]) {
      it(`round trips ${graph.termType} ${JSON.stringify(object.value)} without lexical conversion`, () => {
        const quad = createQuad(s, p, object, graph);
        const text = Serializer.serialize([quad], graph);
        assert.deepEqual(Parser.parse(text, graph), [quad]);
        assert(Object.isFrozen(Parser.parse(text, graph)[0]));
      });
    }
  }
  for (const label of ['b1', 'b6231', 'space and / slash', '😀\u0000\n', '_:already', 'é', 'e\u0301']) {
    it(`reversibly encodes external blank label ${JSON.stringify(label)} across files`, () => {
      const blank = f.blankNode(label);
      const quad = createQuad(blank, p, blank);
      const text = Serializer.serialize([quad]);
      assert.match(text, /^_:b[0-9a-f]+ /);
      assert.deepEqual(Parser.parse(text), [quad]);
      assert.equal(Parser.parse(text, f.namedNode('urn:other'))[0].subject.value, label);
    });
  }
  it('handles comments, CRLF, escapes and canonical language tags', () => {
    const rows = Parser.parse('# comment\r\n\t \r\n<urn:s> <urn:p> "caf\\u00e9\\U0001F600"@EN-us . # tail\r\n');
    assert.equal(rows[0].object.value, 'café😀');
    assert.equal(rows[0].object.language, 'en-us');
    assert.deepEqual(Parser.parse(''), []);
    assert.equal(Serializer.serialize([]), '');
    assert.equal(Serializer.serializeLiteral(f.literal('a\nb')), '"a\\nb"');
  });
  for (const line of [
    '<urn:s> <urn:p> <urn:o>', '<urn:s <urn:p> <urn:o> .',
    '<urn:s> <urn:p> "unterminated .', '<urn:s> <urn:p> "bad\\x" .',
    '<urn:s> <urn:p> .', '"literal" <urn:p> <urn:o> .',
    '<relative> <urn:p> <urn:o> .', '<urn:s> _:b61 <urn:o> .',
    '<urn:s> <urn:p> <urn:o> <urn:g> .',
    '_:raw <urn:p> <urn:o> .', '_:bff <urn:p> <urn:o> .',
    '<urn:s> <urn:p> <urn:o> . <urn:s> <urn:p> <urn:o> .'
  ]) it(`rejects malformed persisted line ${line}`, () => {
    assert.throws(() => Parser.parse(`\n${line}`), /line 2/);
  });
  it('validates all positions, graph identity and late malformed quads', () => {
    const quad = createQuad(s, p, f.literal('ok'));
    for (const bad of [{ ...quad, subject: f.literal('bad') }, { ...quad, predicate: f.blankNode('x') },
      { ...quad, object: 'wire string' }, { ...quad, graph: f.blankNode('g') },
      { ...quad, object: { ...f.literal('x'), value: '\ud800' } },
      { ...quad, graph: f.namedNode('urn:other') }]) {
      assert.throws(() => Serializer.serialize([quad, bad]), /index 1/);
    }
    assert.throws(() => Parser.parse('', f.blankNode('g')));
    assert.throws(() => Serializer.serializeLine({ subject: s, predicate: p, object: s }));
    assert.throws(() => Parser.parse(null));
    assert.throws(() => Serializer.serialize(null));
  });
});
