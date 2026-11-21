import { expect } from 'chai';
import { SparqlBuilder } from '../SparqlBuilder.js';

describe('SparqlBuilder', () => {
  // Compare complete statements, normalizing layout only (fixtures contain no literals).
  describe('complete statement contracts', () => {
    const compact = (query) => query.replace(/\s+/g, ' ').trim();
    const patterns = [
      [['urn:s', 'urn:p', 'urn:o'], '<urn:s> <urn:p> <urn:o> .'],
      [[null, 'urn:p', 'urn:o'], '?s <urn:p> <urn:o> .'],
      [['urn:s', null, 'urn:o'], '<urn:s> ?p <urn:o> .'],
      [['urn:s', 'urn:p', null], '<urn:s> <urn:p> ?o .'],
      [[null, null, 'urn:o'], '?s ?p <urn:o> .'],
      [[null, 'urn:p', null], '?s <urn:p> ?o .'],
      [['urn:s', null, null], '<urn:s> ?p ?o .'],
      [[null, null, null], '?s ?p ?o .']
    ];

    for (const graph of ['', 'graph name']) {
      const wrap = (pattern) => graph ? `GRAPH <graph%20name> { ${pattern} }` : pattern;
      for (const [terms, pattern] of patterns) {
        for (const wildcard of [null, undefined]) {
          const inputs = terms.map((term) => term === null ? wildcard : term);
          const label = `${JSON.stringify(terms)} with ${String(wildcard)} in ${graph || 'default graph'}`;
          for (const [method, prefix] of [
            ['buildSelect', 'SELECT ?s ?p ?o WHERE'],
            ['buildAsk', 'ASK'],
            ['buildCount', 'SELECT (COUNT(*) AS ?count) WHERE']
          ]) {
            it(`${method}: ${label}`, () => {
              expect(compact(SparqlBuilder[method](graph, ...inputs)))
                .to.equal(`${prefix} { ${wrap(pattern)} }`);
            });
          }
          it(`buildDelete: ${label}`, () => {
            const body = wrap(pattern);
            const expected = terms.includes(null)
              ? `DELETE { ${body} } WHERE { ${body} }`
              : `DELETE DATA { ${body} }`;
            expect(compact(SparqlBuilder.buildDelete(graph, ...inputs))).to.equal(expected);
          });
        }
      }
      it(`complete INSERT DATA in ${graph || 'default graph'}`, () => {
        expect(compact(SparqlBuilder.buildInsertData(graph, 'urn:s', 'urn:p', 'urn:o')))
          .to.equal(`INSERT DATA { ${wrap('<urn:s> <urn:p> <urn:o> .')} }`);
      });
      for (const position of [0, 1, 2]) {
        for (const wildcard of [null, undefined]) {
          it(`rejects INSERT wildcard ${String(wildcard)} at position ${position} in ${graph || 'default graph'}`, () => {
            const terms = ['urn:s', 'urn:p', 'urn:o'];
            terms[position] = wildcard;
            expect(() => SparqlBuilder.buildInsertData(graph, ...terms))
              .to.throw('INSERT DATA requires bound subject, predicate, and object');
          });
        }
      }
    }

    it('escapes all specified forbidden IRI characters exactly', () => {
      expect(SparqlBuilder.escapeIri('urn: <>{}|^`\\'))
        .to.equal('<urn:%20%3C%3E%7B%7D%7C%5E%60%5C>');
    });

    it('preserves percent encoding and legal URI punctuation exactly', () => {
      expect(SparqlBuilder.escapeIri('https://example.org/a%20b?q=x&n=1#part'))
        .to.equal('<https://example.org/a%20b?q=x&n=1#part>');
    });

    for (const [position, variable] of [['subject', '?s'], ['predicate', '?p'], ['object', '?o']]) {
      it(`formats undefined ${position}`, () => {
        expect(SparqlBuilder.formatTerm(undefined, position)).to.equal(variable);
      });
    }
  });

  describe('buildSelect', () => {
    it('all terms bound generates SELECT with concrete terms', () => {
      const query = SparqlBuilder.buildSelect('', '<http://example.org/s>', '<http://example.org/p>', '<http://example.org/o>');
      expect(query).to.include('SELECT ?s ?p ?o WHERE');
      expect(query).to.include('<http://example.org/s> <http://example.org/p> <http://example.org/o>');
    });

    it('subject wildcard generates ?s variable', () => {
      const query = SparqlBuilder.buildSelect('', null, '<http://example.org/p>', '<http://example.org/o>');
      expect(query).to.include('?s <http://example.org/p> <http://example.org/o>');
    });

    it('predicate wildcard generates ?p variable', () => {
      const query = SparqlBuilder.buildSelect('', '<http://example.org/s>', null, '<http://example.org/o>');
      expect(query).to.include('<http://example.org/s> ?p <http://example.org/o>');
    });

    it('object wildcard generates ?o variable', () => {
      const query = SparqlBuilder.buildSelect('', '<http://example.org/s>', '<http://example.org/p>', null);
      expect(query).to.include('<http://example.org/s> <http://example.org/p> ?o');
    });

    it('multiple wildcards generates multiple variables', () => {
      const query = SparqlBuilder.buildSelect('', null, null, '<http://example.org/o>');
      expect(query).to.include('?s ?p <http://example.org/o>');
    });

    it('all wildcards generates all three variables', () => {
      const query = SparqlBuilder.buildSelect('', null, null, null);
      expect(query).to.include('?s ?p ?o');
    });

    it('named graph wraps pattern in GRAPH clause', () => {
      const query = SparqlBuilder.buildSelect('<http://example.org/graph>', '<http://example.org/s>', '<http://example.org/p>', '<http://example.org/o>');
      expect(query).to.include('GRAPH <http://example.org/graph>');
      expect(query).to.include('<http://example.org/s> <http://example.org/p> <http://example.org/o>');
    });

    it('default graph (empty string) has no GRAPH wrapping', () => {
      const query = SparqlBuilder.buildSelect('', '<http://example.org/s>', '<http://example.org/p>', '<http://example.org/o>');
      expect(query).to.not.include('GRAPH');
      expect(query).to.include('WHERE');
    });

    it('undefined graphName treated as default graph', () => {
      const query = SparqlBuilder.buildSelect(undefined, '<http://example.org/s>', '<http://example.org/p>', '<http://example.org/o>');
      expect(query).to.not.include('GRAPH');
    });
  });

  describe('buildAsk', () => {
    it('all terms bound generates ASK with concrete terms', () => {
      const query = SparqlBuilder.buildAsk('', '<http://example.org/s>', '<http://example.org/p>', '<http://example.org/o>');
      expect(query).to.include('ASK');
      expect(query).to.include('<http://example.org/s> <http://example.org/p> <http://example.org/o>');
    });

    it('named graph wraps ASK pattern in GRAPH clause', () => {
      const query = SparqlBuilder.buildAsk('<http://example.org/graph>', '<http://example.org/s>', '<http://example.org/p>', '<http://example.org/o>');
      expect(query).to.include('ASK');
      expect(query).to.include('GRAPH <http://example.org/graph>');
    });

    it('default graph has no GRAPH wrapping', () => {
      const query = SparqlBuilder.buildAsk('', '<http://example.org/s>', '<http://example.org/p>', '<http://example.org/o>');
      expect(query).to.not.include('GRAPH');
    });

    it('wildcards generate variables in ASK', () => {
      const query = SparqlBuilder.buildAsk('', null, '<http://example.org/p>', null);
      expect(query).to.include('?s <http://example.org/p> ?o');
    });
  });

  describe('buildCount', () => {
    it('generates COUNT query with concrete terms', () => {
      const query = SparqlBuilder.buildCount('', '<http://example.org/s>', '<http://example.org/p>', '<http://example.org/o>');
      expect(query).to.include('SELECT (COUNT(*) AS ?count) WHERE');
      expect(query).to.include('<http://example.org/s> <http://example.org/p> <http://example.org/o>');
    });

    it('with wildcards generates COUNT query with variables', () => {
      const query = SparqlBuilder.buildCount('', null, '<http://example.org/p>', null);
      expect(query).to.include('SELECT (COUNT(*) AS ?count) WHERE');
      expect(query).to.include('?s <http://example.org/p> ?o');
    });

    it('named graph wraps COUNT pattern in GRAPH clause', () => {
      const query = SparqlBuilder.buildCount('<http://example.org/graph>', '<http://example.org/s>', '<http://example.org/p>', '<http://example.org/o>');
      expect(query).to.include('GRAPH <http://example.org/graph>');
      expect(query).to.include('COUNT(*)');
    });

    it('default graph has no GRAPH wrapping', () => {
      const query = SparqlBuilder.buildCount('', '<http://example.org/s>', '<http://example.org/p>', '<http://example.org/o>');
      expect(query).to.not.include('GRAPH');
    });
  });

  describe('buildInsertData', () => {
    it('all terms bound generates INSERT DATA', () => {
      const query = SparqlBuilder.buildInsertData('', '<http://example.org/s>', '<http://example.org/p>', '<http://example.org/o>');
      expect(query).to.include('INSERT DATA');
      expect(query).to.include('<http://example.org/s> <http://example.org/p> <http://example.org/o>');
    });

    it('named graph wraps INSERT DATA in GRAPH clause', () => {
      const query = SparqlBuilder.buildInsertData('<http://example.org/graph>', '<http://example.org/s>', '<http://example.org/p>', '<http://example.org/o>');
      expect(query).to.include('INSERT DATA');
      expect(query).to.include('GRAPH <http://example.org/graph>');
    });

    it('default graph has no GRAPH wrapping', () => {
      const query = SparqlBuilder.buildInsertData('', '<http://example.org/s>', '<http://example.org/p>', '<http://example.org/o>');
      expect(query).to.not.include('GRAPH');
    });

    it('with literal object', () => {
      const query = SparqlBuilder.buildInsertData('', '<http://example.org/s>', '<http://example.org/p>', '"value"');
      expect(query).to.include('"value"');
    });

    it('with blank node subject', () => {
      const query = SparqlBuilder.buildInsertData('', '_:b1', '<http://example.org/p>', '<http://example.org/o>');
      expect(query).to.include('_:b1');
    });
  });

  describe('buildDelete', () => {
    it('all terms bound generates DELETE DATA', () => {
      const query = SparqlBuilder.buildDelete('', '<http://example.org/s>', '<http://example.org/p>', '<http://example.org/o>');
      expect(query).to.include('DELETE DATA');
      expect(query).to.include('<http://example.org/s> <http://example.org/p> <http://example.org/o>');
    });

    it('with wildcards generates DELETE/WHERE', () => {
      const query = SparqlBuilder.buildDelete('', null, '<http://example.org/p>', '<http://example.org/o>');
      expect(query).to.include('DELETE');
      expect(query).to.include('WHERE');
      expect(query).to.include('?s <http://example.org/p> <http://example.org/o>');
    });

    it('named graph wraps DELETE DATA in GRAPH clause', () => {
      const query = SparqlBuilder.buildDelete('<http://example.org/graph>', '<http://example.org/s>', '<http://example.org/p>', '<http://example.org/o>');
      expect(query).to.include('DELETE DATA');
      expect(query).to.include('GRAPH <http://example.org/graph>');
    });

    it('named graph wraps DELETE/WHERE pattern in GRAPH clause', () => {
      const query = SparqlBuilder.buildDelete('<http://example.org/graph>', null, '<http://example.org/p>', '<http://example.org/o>');
      expect(query).to.include('DELETE');
      expect(query).to.include('WHERE');
      expect(query).to.include('GRAPH <http://example.org/graph>');
    });

    it('default graph has no GRAPH wrapping for DELETE DATA', () => {
      const query = SparqlBuilder.buildDelete('', '<http://example.org/s>', '<http://example.org/p>', '<http://example.org/o>');
      expect(query).to.not.include('GRAPH');
    });

    it('subject wildcard triggers DELETE/WHERE', () => {
      const query = SparqlBuilder.buildDelete('', null, '<http://example.org/p>', '<http://example.org/o>');
      expect(query).to.include('DELETE {\n');
      expect(query).to.include('WHERE {\n');
    });

    it('predicate wildcard triggers DELETE/WHERE', () => {
      const query = SparqlBuilder.buildDelete('', '<http://example.org/s>', null, '<http://example.org/o>');
      expect(query).to.include('DELETE {\n');
      expect(query).to.include('WHERE {\n');
    });

    it('object wildcard triggers DELETE/WHERE', () => {
      const query = SparqlBuilder.buildDelete('', '<http://example.org/s>', '<http://example.org/p>', null);
      expect(query).to.include('DELETE {\n');
      expect(query).to.include('WHERE {\n');
    });
  });

  describe('buildClear', () => {
    it('empty string graphName generates CLEAR DEFAULT', () => {
      const query = SparqlBuilder.buildClear('');
      expect(query).to.equal('CLEAR DEFAULT');
    });

    it('undefined graphName generates CLEAR DEFAULT', () => {
      const query = SparqlBuilder.buildClear(undefined);
      expect(query).to.equal('CLEAR DEFAULT');
    });

    it('named graph uses a scoped wildcard DELETE, safe for absent graphs', () => {
      const query = SparqlBuilder.buildClear('<http://example.org/graph>');
      expect(query).to.equal('DELETE {\n  GRAPH <http://example.org/graph> {\n    ?s ?p ?o .\n  }\n}\nWHERE {\n  GRAPH <http://example.org/graph> {\n    ?s ?p ?o .\n  }\n}');
      expect(SparqlBuilder.buildClear('http://example.org/graph')).to.equal(query);
    });

    it('bare named graph string is escaped and wrapped', () => {
      const query = SparqlBuilder.buildClear('http://example.org/graph');
      expect(query).to.include('GRAPH <http://example.org/graph>');
      expect(query).not.to.include('CLEAR');
    });
  });

  describe('formatTerm', () => {
    it('null returns subject variable', () => {
      const term = SparqlBuilder.formatTerm(null, 'subject');
      expect(term).to.equal('?s');
    });

    it('undefined returns subject variable', () => {
      const term = SparqlBuilder.formatTerm(undefined, 'subject');
      expect(term).to.equal('?s');
    });

    it('null returns predicate variable', () => {
      const term = SparqlBuilder.formatTerm(null, 'predicate');
      expect(term).to.equal('?p');
    });

    it('null returns object variable', () => {
      const term = SparqlBuilder.formatTerm(null, 'object');
      expect(term).to.equal('?o');
    });

    it('already wrapped IRI passes through', () => {
      const term = SparqlBuilder.formatTerm('<http://example.org/resource>', 'subject');
      expect(term).to.equal('<http://example.org/resource>');
    });

    it('blank node passes through', () => {
      const term = SparqlBuilder.formatTerm('_:b1', 'subject');
      expect(term).to.equal('_:b1');
    });

    it('literal passes through', () => {
      const term = SparqlBuilder.formatTerm('"value"', 'object');
      expect(term).to.equal('"value"');
    });

    it('literal with datatype passes through', () => {
      const term = SparqlBuilder.formatTerm('"42"^^<xsd:integer>', 'object');
      expect(term).to.equal('"42"^^<xsd:integer>');
    });

    it('literal with language tag passes through', () => {
      const term = SparqlBuilder.formatTerm('"hello"@en', 'object');
      expect(term).to.equal('"hello"@en');
    });

    it('bare URI string is escaped and wrapped', () => {
      const term = SparqlBuilder.formatTerm('http://example.org/resource', 'subject');
      expect(term).to.equal('<http://example.org/resource>');
    });

    it('unknown position returns ?x variable', () => {
      const term = SparqlBuilder.formatTerm(null, 'unknown');
      expect(term).to.equal('?x');
    });
  });

  describe('escapeIri', () => {
    it('already wrapped IRI passes through', () => {
      const escaped = SparqlBuilder.escapeIri('<http://example.org/resource>');
      expect(escaped).to.equal('<http://example.org/resource>');
    });

    it('bare URI gets wrapped in angle brackets', () => {
      const escaped = SparqlBuilder.escapeIri('http://example.org/resource');
      expect(escaped).to.equal('<http://example.org/resource>');
    });

    it('IRI with space is percent-encoded', () => {
      const escaped = SparqlBuilder.escapeIri('http://example.org/my resource');
      expect(escaped).to.include('%20');
      expect(escaped).to.include('<');
      expect(escaped).to.include('>');
    });

    it('IRI with less-than sign is percent-encoded', () => {
      const escaped = SparqlBuilder.escapeIri('http://example.org/resource<id>');
      expect(escaped).to.include('%3C');
      expect(escaped).to.include('%3E');
    });

    it('IRI with greater-than sign is percent-encoded', () => {
      const escaped = SparqlBuilder.escapeIri('http://example.org/resource>');
      expect(escaped).to.include('%3E');
    });

    it('IRI with curly braces is percent-encoded', () => {
      const escaped = SparqlBuilder.escapeIri('http://example.org/resource{id}');
      expect(escaped).to.include('%7B');
      expect(escaped).to.include('%7D');
    });

    it('IRI with pipe character is percent-encoded', () => {
      const escaped = SparqlBuilder.escapeIri('http://example.org/resource|id');
      expect(escaped).to.include('%7C');
    });

    it('IRI with caret character is percent-encoded', () => {
      const escaped = SparqlBuilder.escapeIri('http://example.org/resource^id');
      expect(escaped).to.include('%5E');
    });

    it('IRI with backtick is percent-encoded', () => {
      const escaped = SparqlBuilder.escapeIri('http://example.org/resource`id');
      expect(escaped).to.include('%60');
    });

    it('IRI with backslash is percent-encoded', () => {
      const escaped = SparqlBuilder.escapeIri('http://example.org/resource\\id');
      expect(escaped).to.include('%5C');
    });

    it('multiple disallowed characters all encoded', () => {
      const escaped = SparqlBuilder.escapeIri('http://example.org/my <resource>');
      expect(escaped).to.include('%20');
      expect(escaped).to.include('%3C');
      expect(escaped).to.include('%3E');
    });
  });

  describe('buildTriplePattern', () => {
    it('generates triple pattern with concrete terms', () => {
      const pattern = SparqlBuilder.buildTriplePattern('', '<http://example.org/s>', '<http://example.org/p>', '<http://example.org/o>');
      expect(pattern).to.include('<http://example.org/s> <http://example.org/p> <http://example.org/o> .');
    });

    it('generates triple pattern with variables', () => {
      const pattern = SparqlBuilder.buildTriplePattern('', null, null, null);
      expect(pattern).to.equal('?s ?p ?o .');
    });

    it('mixed bound and wildcard terms', () => {
      const pattern = SparqlBuilder.buildTriplePattern('', '<http://example.org/s>', null, '<http://example.org/o>');
      expect(pattern).to.include('<http://example.org/s> ?p <http://example.org/o> .');
    });
  });

  describe('Integration - full query generation', () => {
    it('SELECT query with named graph and mixed wildcards', () => {
      const query = SparqlBuilder.buildSelect('<http://example.org/data>', null, '<http://example.org/knows>', null);
      expect(query).to.include('SELECT ?s ?p ?o WHERE');
      expect(query).to.include('GRAPH <http://example.org/data>');
      expect(query).to.include('?s <http://example.org/knows> ?o');
    });

    it('INSERT/DELETE round-trip for triple', () => {
      const insert = SparqlBuilder.buildInsertData('', '<http://example.org/s>', '<http://example.org/p>', '"value"');
      const del = SparqlBuilder.buildDelete('', '<http://example.org/s>', '<http://example.org/p>', '"value"');

      expect(insert).to.include('INSERT DATA');
      expect(del).to.include('DELETE DATA');
      expect(insert).to.include('<http://example.org/s> <http://example.org/p> "value"');
      expect(del).to.include('<http://example.org/s> <http://example.org/p> "value"');
    });

    it('DELETE with pattern matching across named graph', () => {
      const query = SparqlBuilder.buildDelete('<http://example.org/data>', '<http://example.org/s>', null, null);
      expect(query).to.include('DELETE');
      expect(query).to.include('WHERE');
      expect(query).to.include('GRAPH <http://example.org/data>');
      expect(query).to.match(/DELETE[\s\S]*GRAPH[\s\S]*?WHERE[\s\S]*GRAPH/);
    });

    it('COUNT query to validate triples before delete', () => {
      const countQuery = SparqlBuilder.buildCount('', '<http://example.org/s>', null, null);
      const deleteQuery = SparqlBuilder.buildDelete('', '<http://example.org/s>', null, null);

      expect(countQuery).to.include('COUNT(*)');
      expect(deleteQuery).to.include('DELETE');
    });
  });

  describe('Edge cases and boundary conditions', () => {
    it('rejects empty string terms', () => {
      expect(() => SparqlBuilder.formatTerm('', 'subject')).to.throw(TypeError);
    });

    it('rejects numeric values rather than coercing lexical identity', () => {
      expect(() => SparqlBuilder.formatTerm(123, 'object')).to.throw(TypeError);
    });

    it('complex URI with query parameters', () => {
      const escaped = SparqlBuilder.escapeIri('http://example.org/search?q=hello world');
      expect(escaped).to.include('<');
      expect(escaped).to.include('>');
      expect(escaped).to.include('%20');
    });

    it('IRI encoding preserves already-encoded sequences', () => {
      const escaped = SparqlBuilder.escapeIri('http://example.org/resource%20encoded');
      expect(escaped).to.include('<');
      expect(escaped).to.include('>');
    });

    it('formatTerm with empty string graphName', () => {
      const query = SparqlBuilder.buildSelect('', '<http://example.org/s>', '<http://example.org/p>', '<http://example.org/o>');
      expect(query).to.not.include('GRAPH');
    });

    it('buildDelete with all wildcards and named graph', () => {
      const query = SparqlBuilder.buildDelete('<http://example.org/graph>', null, null, null);
      expect(query).to.include('DELETE');
      expect(query).to.include('WHERE');
      expect(query).to.include('GRAPH <http://example.org/graph>');
      expect(query).to.include('?s ?p ?o');
    });
  });
});
