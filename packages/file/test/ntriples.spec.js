import { expect } from 'chai';
import { NTriplesParser } from '../NTriplesParser.js';
import { NTriplesSerializer } from '../NTriplesSerializer.js';

describe('NTriplesParser', () => {
  describe('IRI parsing', () => {
    it('should parse a simple triple with IRIs', () => {
      const line = '<http://example.org/subject> <http://example.org/predicate> <http://example.org/object> .';
      const triple = NTriplesParser.parseLine(line);

      expect(triple.subject).to.equal('<http://example.org/subject>');
      expect(triple.predicate).to.equal('<http://example.org/predicate>');
      expect(triple.object).to.equal('<http://example.org/object>');
    });
  });

  describe('Blank node parsing', () => {
    it('should parse blank nodes as subject and object', () => {
      const line = '_:b1 <http://example.org/predicate> _:b2 .';
      const triple = NTriplesParser.parseLine(line);

      expect(triple.subject).to.equal('_:b1');
      expect(triple.predicate).to.equal('<http://example.org/predicate>');
      expect(triple.object).to.equal('_:b2');
    });

    it('should parse blank nodes with complex labels', () => {
      const line = '_:blank-node_123 <http://example.org/p> _:another-node .';
      const triple = NTriplesParser.parseLine(line);

      expect(triple.subject).to.equal('_:blank-node_123');
      expect(triple.object).to.equal('_:another-node');
    });
  });

  describe('String literal parsing', () => {
    it('should parse plain string literals', () => {
      const line = '<http://example.org/s> <http://example.org/p> "hello" .';
      const triple = NTriplesParser.parseLine(line);

      expect(triple.object).to.equal('"hello"');
    });

    it('should parse empty string literals', () => {
      const line = '<http://example.org/s> <http://example.org/p> "" .';
      const triple = NTriplesParser.parseLine(line);

      expect(triple.object).to.equal('""');
    });

    it('should parse string literals with spaces', () => {
      const line = '<http://example.org/s> <http://example.org/p> "hello world" .';
      const triple = NTriplesParser.parseLine(line);

      expect(triple.object).to.equal('"hello world"');
    });
  });

  describe('Typed literal parsing', () => {
    it('should parse typed literals', () => {
      const line = '<http://example.org/s> <http://example.org/p> "42"^^<http://www.w3.org/2001/XMLSchema#integer> .';
      const triple = NTriplesParser.parseLine(line);

      expect(triple.object).to.equal('"42"^^<http://www.w3.org/2001/XMLSchema#integer>');
    });

    it('should parse boolean typed literals', () => {
      const line = '<http://example.org/s> <http://example.org/p> "true"^^<http://www.w3.org/2001/XMLSchema#boolean> .';
      const triple = NTriplesParser.parseLine(line);

      expect(triple.object).to.equal('"true"^^<http://www.w3.org/2001/XMLSchema#boolean>');
    });
  });

  describe('Language-tagged literal parsing', () => {
    it('should parse language-tagged literals', () => {
      const line = '<http://example.org/s> <http://example.org/p> "bonjour"@fr .';
      const triple = NTriplesParser.parseLine(line);

      expect(triple.object).to.equal('"bonjour"@fr');
    });

    it('should parse language tags with region', () => {
      const line = '<http://example.org/s> <http://example.org/p> "hello"@en-US .';
      const triple = NTriplesParser.parseLine(line);

      expect(triple.object).to.equal('"hello"@en-US');
    });
  });

  describe('Escape sequences in literals', () => {
    it('should parse escaped tab', () => {
      const line = '<http://example.org/s> <http://example.org/p> "hello\\tworld" .';
      const triple = NTriplesParser.parseLine(line);

      expect(triple.object).to.equal('"hello\tworld"');
    });

    it('should parse escaped newline', () => {
      const line = '<http://example.org/s> <http://example.org/p> "hello\\nworld" .';
      const triple = NTriplesParser.parseLine(line);

      expect(triple.object).to.equal('"hello\nworld"');
    });

    it('should parse escaped carriage return', () => {
      const line = '<http://example.org/s> <http://example.org/p> "hello\\rworld" .';
      const triple = NTriplesParser.parseLine(line);

      expect(triple.object).to.equal('"hello\rworld"');
    });

    it('should parse escaped quote', () => {
      const line = '<http://example.org/s> <http://example.org/p> "say \\"hello\\"" .';
      const triple = NTriplesParser.parseLine(line);

      expect(triple.object).to.equal('"say "hello""');
    });

    it('should parse escaped backslash', () => {
      const line = '<http://example.org/s> <http://example.org/p> "path\\\\to\\\\file" .';
      const triple = NTriplesParser.parseLine(line);

      expect(triple.object).to.equal('"path\\to\\file"');
    });

    it('should parse 4-digit Unicode escape', () => {
      const line = '<http://example.org/s> <http://example.org/p> "caf\\u00e9" .';
      const triple = NTriplesParser.parseLine(line);

      expect(triple.object).to.equal('"café"');
    });

    it('should parse 8-digit Unicode escape', () => {
      const line = '<http://example.org/s> <http://example.org/p> "emoji\\U0001F600" .';
      const triple = NTriplesParser.parseLine(line);

      expect(triple.object).to.equal('"emoji😀"');
    });
  });

  describe('Comment and empty line handling', () => {
    it('should skip comment lines', () => {
      const text = `# This is a comment
<http://example.org/s> <http://example.org/p> <http://example.org/o> .
# Another comment
`;
      const triples = NTriplesParser.parse(text);

      expect(triples).to.have.lengthOf(1);
    });

    it('should skip empty lines', () => {
      const text = `<http://example.org/s1> <http://example.org/p> <http://example.org/o1> .

<http://example.org/s2> <http://example.org/p> <http://example.org/o2> .
`;
      const triples = NTriplesParser.parse(text);

      expect(triples).to.have.lengthOf(2);
    });

    it('should handle whitespace-only lines', () => {
      const text = `<http://example.org/s> <http://example.org/p> <http://example.org/o> .

<http://example.org/s2> <http://example.org/p> <http://example.org/o2> .`;
      const triples = NTriplesParser.parse(text);

      expect(triples).to.have.lengthOf(2);
    });
  });

  describe('Multi-line documents', () => {
    it('should parse a document with multiple triples', () => {
      const text = `<http://example.org/s1> <http://example.org/p1> <http://example.org/o1> .
<http://example.org/s2> <http://example.org/p2> "object2" .
_:b1 <http://example.org/p3> "object3"@en .
`;
      const triples = NTriplesParser.parse(text);

      expect(triples).to.have.lengthOf(3);
      expect(triples[0].subject).to.equal('<http://example.org/s1>');
      expect(triples[1].object).to.equal('"object2"');
      expect(triples[2].predicate).to.equal('<http://example.org/p3>');
    });
  });

  describe('Malformed input errors', () => {
    it('should throw on missing dot terminator', () => {
      const line = '<http://example.org/s> <http://example.org/p> <http://example.org/o>';

      expect(() => NTriplesParser.parseLine(line)).to.throw('Missing dot terminator');
    });

    it('should throw on unterminated IRI', () => {
      const line = '<http://example.org/s <http://example.org/p> <http://example.org/o> .';

      expect(() => NTriplesParser.parseLine(line)).to.throw();
    });

    it('should throw on unterminated string literal', () => {
      const line = '<http://example.org/s> <http://example.org/p> "unterminated .';

      expect(() => NTriplesParser.parseLine(line)).to.throw('Unterminated string literal');
    });

    it('should throw on invalid escape sequence', () => {
      const line = '<http://example.org/s> <http://example.org/p> "invalid\\x escape" .';

      expect(() => NTriplesParser.parseLine(line)).to.throw();
    });

    it('should throw on too few terms', () => {
      const line = '<http://example.org/s> <http://example.org/p> .';

      expect(() => NTriplesParser.parseLine(line)).to.throw('Triple must have subject, predicate, and object');
    });
  });
});

describe('NTriplesSerializer', () => {
  describe('Basic serialization', () => {
    it('should serialize a simple triple with IRIs', () => {
      const triple = {
        subject: '<http://example.org/subject>',
        predicate: '<http://example.org/predicate>',
        object: '<http://example.org/object>'
      };
      const line = NTriplesSerializer.serializeLine(triple);

      expect(line).to.equal('<http://example.org/subject> <http://example.org/predicate> <http://example.org/object> .');
    });

    it('should serialize with blank nodes', () => {
      const triple = {
        subject: '_:b1',
        predicate: '<http://example.org/predicate>',
        object: '_:b2'
      };
      const line = NTriplesSerializer.serializeLine(triple);

      expect(line).to.equal('_:b1 <http://example.org/predicate> _:b2 .');
    });

    it('should serialize with plain literals', () => {
      const triple = {
        subject: '<http://example.org/s>',
        predicate: '<http://example.org/p>',
        object: '"hello"'
      };
      const line = NTriplesSerializer.serializeLine(triple);

      expect(line).to.equal('<http://example.org/s> <http://example.org/p> "hello" .');
    });
  });

  describe('Escape sequences in serialization', () => {
    it('should escape special characters in literals', () => {
      const triple = {
        subject: '<http://example.org/s>',
        predicate: '<http://example.org/p>',
        object: '"contains\ttab"'
      };
      const line = NTriplesSerializer.serializeLine(triple);

      expect(line).to.equal('<http://example.org/s> <http://example.org/p> "contains\\ttab" .');
    });

    it('should escape newlines', () => {
      const triple = {
        subject: '<http://example.org/s>',
        predicate: '<http://example.org/p>',
        object: '"line1\nline2"'
      };
      const line = NTriplesSerializer.serializeLine(triple);

      expect(line).to.equal('<http://example.org/s> <http://example.org/p> "line1\\nline2" .');
    });

    it('should escape quotes', () => {
      const triple = {
        subject: '<http://example.org/s>',
        predicate: '<http://example.org/p>',
        object: '"say "hello""'
      };
      const line = NTriplesSerializer.serializeLine(triple);

      expect(line).to.equal('<http://example.org/s> <http://example.org/p> "say \\"hello\\"" .');
    });

    it('should escape backslashes', () => {
      const triple = {
        subject: '<http://example.org/s>',
        predicate: '<http://example.org/p>',
        object: '"path\\to\\file"'
      };
      const line = NTriplesSerializer.serializeLine(triple);

      expect(line).to.equal('<http://example.org/s> <http://example.org/p> "path\\\\to\\\\file" .');
    });

    it('should escape Unicode characters', () => {
      const triple = {
        subject: '<http://example.org/s>',
        predicate: '<http://example.org/p>',
        object: '"café"'
      };
      const line = NTriplesSerializer.serializeLine(triple);

      expect(line).to.include('\\u');
    });
  });

  describe('Multiple triples serialization', () => {
    it('should serialize an array of triples', () => {
      const triples = [
        {
          subject: '<http://example.org/s1>',
          predicate: '<http://example.org/p>',
          object: '<http://example.org/o1>'
        },
        {
          subject: '<http://example.org/s2>',
          predicate: '<http://example.org/p>',
          object: '"object2"'
        }
      ];
      const result = NTriplesSerializer.serialize(triples);

      expect(result).to.include('<http://example.org/s1> <http://example.org/p> <http://example.org/o1> .\n');
      expect(result).to.include('<http://example.org/s2> <http://example.org/p> "object2" .\n');
    });
  });

  describe('Typed and language-tagged literals', () => {
    it('should serialize typed literals', () => {
      const triple = {
        subject: '<http://example.org/s>',
        predicate: '<http://example.org/p>',
        object: '"42"^^<http://www.w3.org/2001/XMLSchema#integer>'
      };
      const line = NTriplesSerializer.serializeLine(triple);

      expect(line).to.include('^^<http://www.w3.org/2001/XMLSchema#integer>');
    });

    it('should serialize language-tagged literals', () => {
      const triple = {
        subject: '<http://example.org/s>',
        predicate: '<http://example.org/p>',
        object: '"bonjour"@fr'
      };
      const line = NTriplesSerializer.serializeLine(triple);

      expect(line).to.include('@fr');
    });
  });
});

describe('Round-trip fidelity', () => {
  it('should round-trip IRIs correctly', () => {
    const original = {
      subject: '<http://example.org/subject>',
      predicate: '<http://example.org/predicate>',
      object: '<http://example.org/object>'
    };

    const serialized = NTriplesSerializer.serializeLine(original);
    const parsed = NTriplesParser.parseLine(serialized);

    expect(parsed).to.deep.equal(original);
  });

  it('should round-trip blank nodes correctly', () => {
    const original = {
      subject: '_:b1',
      predicate: '<http://example.org/p>',
      object: '_:b2'
    };

    const serialized = NTriplesSerializer.serializeLine(original);
    const parsed = NTriplesParser.parseLine(serialized);

    expect(parsed).to.deep.equal(original);
  });

  it('should round-trip plain literals correctly', () => {
    const original = {
      subject: '<http://example.org/s>',
      predicate: '<http://example.org/p>',
      object: '"hello"'
    };

    const serialized = NTriplesSerializer.serializeLine(original);
    const parsed = NTriplesParser.parseLine(serialized);

    expect(parsed).to.deep.equal(original);
  });

  it('should round-trip typed literals correctly', () => {
    const original = {
      subject: '<http://example.org/s>',
      predicate: '<http://example.org/p>',
      object: '"42"^^<http://www.w3.org/2001/XMLSchema#integer>'
    };

    const serialized = NTriplesSerializer.serializeLine(original);
    const parsed = NTriplesParser.parseLine(serialized);

    expect(parsed).to.deep.equal(original);
  });

  it('should round-trip language-tagged literals correctly', () => {
    const original = {
      subject: '<http://example.org/s>',
      predicate: '<http://example.org/p>',
      object: '"bonjour"@fr'
    };

    const serialized = NTriplesSerializer.serializeLine(original);
    const parsed = NTriplesParser.parseLine(serialized);

    expect(parsed).to.deep.equal(original);
  });

  it('should round-trip literals with escaped characters', () => {
    const original = {
      subject: '<http://example.org/s>',
      predicate: '<http://example.org/p>',
      object: '"line1\nline2\ttabbed"'
    };

    const serialized = NTriplesSerializer.serializeLine(original);
    const parsed = NTriplesParser.parseLine(serialized);

    expect(parsed).to.deep.equal(original);
  });

  it('should round-trip multiple triples without losing data', () => {
    const original = [
      {
        subject: '<http://example.org/s1>',
        predicate: '<http://example.org/p>',
        object: '<http://example.org/o1>'
      },
      {
        subject: '_:b1',
        predicate: '<http://example.org/p>',
        object: '"literal"@en'
      },
      {
        subject: '<http://example.org/s3>',
        predicate: '<http://example.org/p>',
        object: '"42"^^<http://www.w3.org/2001/XMLSchema#integer>'
      }
    ];

    const serialized = NTriplesSerializer.serialize(original);
    const parsed = NTriplesParser.parse(serialized);

    expect(parsed).to.deep.equal(original);
  });
});
