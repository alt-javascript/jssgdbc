import { expect } from 'chai';
import { SparqlBuilder as B } from '../SparqlBuilder.js';
import { n, b, l, d } from './helpers/terms.js';

describe('SparqlBuilder structural term codec', () => {
  const compact = text => text.replace(/\s+/g, ' ').trim();
  const bound = [n('urn:s'), n('urn:p'), n('urn:o')];
  for (const graph of [d(), n('urn:g')]) {
    for (let mask = 0; mask < 8; mask++) {
      const terms = bound.map((term, i) => mask & (1 << i) ? term : null);
      const pattern = terms.map((term, i) => term ? `<${term.value}>` : ['?s', '?p', '?o'][i]).join(' ') + ' .';
      const body = graph.termType === 'NamedNode' ? `GRAPH <urn:g> { ${pattern} }` : pattern;
      it(`emits complete SELECT/ASK/COUNT/DELETE for ${graph.termType} mask ${mask}`, () => {
        expect(compact(B.buildSelect(graph, ...terms))).to.equal(`SELECT ?s ?p ?o WHERE { ${body} }`);
        expect(compact(B.buildAsk(graph, ...terms))).to.equal(`ASK { ${body} }`);
        expect(compact(B.buildCount(graph, ...terms))).to.equal(`SELECT (COUNT(*) AS ?count) WHERE { ${body} }`);
        expect(compact(B.buildDelete(graph, ...terms))).to.equal(mask === 7 ? `DELETE DATA { ${body} }` : `DELETE { ${body} } WHERE { ${body} }`);
      });
    }
    it(`emits bound INSERT and scoped clear for ${graph.termType}`, () => {
      const pattern = '<urn:s> <urn:p> <urn:o> .';
      const body = graph.termType === 'NamedNode' ? `GRAPH <urn:g> { ${pattern} }` : pattern;
      expect(compact(B.buildInsertData(graph, ...bound))).to.equal(`INSERT DATA { ${body} }`);
      expect(compact(B.buildClear(graph))).to.equal(graph.termType === 'NamedNode'
        ? 'DELETE { GRAPH <urn:g> { ?s ?p ?o . } } WHERE { GRAPH <urn:g> { ?s ?p ?o . } }' : 'CLEAR DEFAULT');
    });
  }
  it('uses typed default graph rather than empty string compatibility', () => {
    expect(B.buildSelect(undefined)).not.to.include('GRAPH');
    for (const graph of ['', null, 'urn:g', b('graph'), l('graph')]) expect(() => B.buildClear(graph)).to.throw();
  });
  it('serializes lexical values without guessing IRIs or typed-literal surface syntax', () => {
    const cases = [[n('http://example.org/alice'), '<http://example.org/alice>'], [n('urn:isbn:123'), '<urn:isbn:123>'],
      [l('hello'), '"hello"'], [l(''), '""'], [l('http://example.org'), '"http://example.org"'],
      [l('héllo 世界'), '"héllo 世界"'], [l('bonjour', 'fr'), '"bonjour"@fr'],
      [l('hello', 'en-us'), '"hello"@en-us'], [l('001', '', 'http://www.w3.org/2001/XMLSchema#integer'), '"001"^^<http://www.w3.org/2001/XMLSchema#integer>'],
      [l('mail@example.org^^type'), '"mail@example.org^^type"']];
    for (const [term, expected] of cases) expect(B.formatTerm(term, 'object')).to.equal(expected);
    expect(B.formatTerm(l('"\\\n\r\t'), 'object')).to.equal('"\\"\\\\\\n\\r\\t"');
    expect(B.formatTerm(l('\u0000\b\f\u001f\u007f\u0085'), 'object')).to.equal('"\\u0000\\u0008\\u000C\\u001F\\u007F\\u0085"');
    expect(B.formatTerm(l('" . } ; DROP ALL; #'), 'object')).to.equal('"\\" . } ; DROP ALL; #"');
  });
  it('rejects illegal IRIs instead of silently changing RDF identity', () => {
    for (const value of ['relative', 'http://ex/a b', 'http://ex/<x>', 'http://ex/"x"', 'http://ex/{x}', 'http://ex/|^`', 'urn:a\\b', 'urn:a\n', 'urn:a\u0001', 'urn:\ud800']) {
      expect(() => B.escapeIri({ termType: 'NamedNode', value })).to.throw();
    }
    expect(B.escapeIri(n('http://example.org/path?x=1&y=2#frag'))).to.equal('<http://example.org/path?x=1&y=2#frag>');
  });
  it('rejects legacy values, unknown kinds and invalid positions', () => {
    for (const value of ['urn:s', 0, false, {}, { termType: 'Variable', value: 's' }, { termType: 'Quad', value: '' }]) {
      expect(() => B.formatTerm(value, 'subject')).to.throw();
    }
    for (const value of [l('s'), d()]) expect(() => B.formatTerm(value, 'subject')).to.throw();
    expect(() => B.formatTerm(b('p'), 'predicate', new Map())).to.throw();
    for (const position of ['subject', 'predicate', 'object']) {
      expect(B.formatTerm(null, position)).to.equal({ subject: '?s', predicate: '?p', object: '?o' }[position]);
      expect(B.formatTerm(undefined, position)).to.equal({ subject: '?s', predicate: '?p', object: '?o' }[position]);
    }
    for (let i = 0; i < 3; i++) { const terms = [...bound]; terms[i] = null; expect(() => B.buildInsertData(d(), ...terms)).to.throw(); }
  });
  it('maps blank inserts once per request and rejects every blank identity pattern', () => {
    const blank = b('unsafe label } ; DROP ALL #');
    expect(compact(B.buildInsertData(d(), blank, bound[1], blank))).to.equal('INSERT DATA { _:b0 <urn:p> _:b0 . }');
    expect(compact(B.buildInsertData(n('urn:g'), blank, bound[1], b('other')))).to.equal('INSERT DATA { GRAPH <urn:g> { _:b0 <urn:p> _:b1 . } }');
    for (const operation of ['buildSelect', 'buildAsk', 'buildCount', 'buildDelete']) {
      expect(() => B[operation](d(), blank, bound[1], bound[2])).to.throw(/Blank-node identity/);
      expect(() => B[operation](d(), bound[0], bound[1], blank)).to.throw(/Blank-node identity/);
    }
  });
});
