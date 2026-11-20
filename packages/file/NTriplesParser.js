export class NTriplesParser {
  static parse(text) {
    const lines = text.split(/\r?\n/);
    const triples = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd();

      if (!line || /^\s*#/.test(line)) {
        continue;
      }

      try {
        const triple = this.parseLine(line);
        triples.push(triple);
      } catch (err) {
        throw new Error(`Parse error at line ${i + 1}: ${err.message}`);
      }
    }

    return triples;
  }

  static parseLine(line) {
    const trimmed = line.trim();

    if (!trimmed.endsWith('.')) {
      throw new Error('Missing dot terminator');
    }

    const withoutDot = trimmed.slice(0, -1).trim();
    const tokens = this.tokenize(withoutDot);

    if (tokens.length < 3) {
      throw new Error('Triple must have subject, predicate, and object');
    }

    return {
      subject: tokens[0],
      predicate: tokens[1],
      object: tokens[2]
    };
  }

  static tokenize(text) {
    const tokens = [];
    let i = 0;

    while (i < text.length) {
      const char = text[i];

      if (/\s/.test(char)) {
        i++;
        continue;
      }

      if (char === '<') {
        tokens.push(this.parseIRI(text, i));
        i = this.iriEndIndex;
      } else if (char === '_' && text[i + 1] === ':') {
        tokens.push(this.parseBlankNode(text, i));
        i = this.blankNodeEndIndex;
      } else if (char === '"') {
        tokens.push(this.parseLiteral(text, i));
        i = this.literalEndIndex;
      } else {
        throw new Error(`Unexpected character '${char}' at position ${i}`);
      }
    }

    return tokens;
  }

  static parseIRI(text, start) {
    if (text[start] !== '<') {
      throw new Error('IRI must start with <');
    }

    let i = start + 1;
    let iri = '<';

    while (i < text.length) {
      const char = text[i];

      if (char === '>') {
        iri += '>';
        this.iriEndIndex = i + 1;
        return iri;
      }

      if (char === '\\') {
        throw new Error('Escape sequences not allowed in IRIs');
      }

      if (char === '\n' || char === '\r') {
        throw new Error('Unterminated IRI');
      }

      iri += char;
      i++;
    }

    throw new Error('Unterminated IRI');
  }

  static parseBlankNode(text, start) {
    if (text[start] !== '_' || text[start + 1] !== ':') {
      throw new Error('Blank node must start with _:');
    }

    let i = start + 2;
    let label = '_:';

    while (i < text.length) {
      const char = text[i];

      if (/\s/.test(char) || char === '.' || char === '>') {
        this.blankNodeEndIndex = i;
        return label;
      }

      if (/[A-Za-z0-9._-]/.test(char)) {
        label += char;
        i++;
      } else {
        throw new Error(`Invalid character in blank node label: ${char}`);
      }
    }

    this.blankNodeEndIndex = i;
    return label;
  }

  static parseLiteral(text, start) {
    if (text[start] !== '"') {
      throw new Error('Literal must start with "');
    }

    let i = start + 1;
    let value = '';
    let datatype = null;
    let lang = null;

    while (i < text.length) {
      const char = text[i];

      if (char === '\\') {
        const escaped = this.parseEscape(text, i);
        value += escaped.char;
        i = escaped.nextIndex;
      } else if (char === '"') {
        i++;

        if (text[i] === '^' && text[i + 1] === '^') {
          i += 2;
          if (text[i] !== '<') {
            throw new Error('Datatype must start with <');
          }
          const iriResult = this.parseIRI(text, i);
          datatype = iriResult;
          i = this.iriEndIndex;
        } else if (text[i] === '@') {
          i++;
          let langTag = '';
          while (i < text.length && /[A-Za-z0-9-]/.test(text[i])) {
            langTag += text[i];
            i++;
          }
          if (!langTag) {
            throw new Error('Language tag cannot be empty');
          }
          lang = langTag;
        }

        this.literalEndIndex = i;

        if (datatype) {
          return `"${value}"^^${datatype}`;
        } else if (lang) {
          return `"${value}"@${lang}`;
        } else {
          return `"${value}"`;
        }
      } else if (char === '\n' || char === '\r') {
        throw new Error('Unterminated string literal');
      } else {
        value += char;
        i++;
      }
    }

    throw new Error('Unterminated string literal');
  }

  static parseEscape(text, start) {
    if (text[start] !== '\\') {
      throw new Error('Expected backslash');
    }

    const next = text[start + 1];

    if (next === 't') {
      return { char: '\t', nextIndex: start + 2 };
    } else if (next === 'n') {
      return { char: '\n', nextIndex: start + 2 };
    } else if (next === 'r') {
      return { char: '\r', nextIndex: start + 2 };
    } else if (next === '"') {
      return { char: '"', nextIndex: start + 2 };
    } else if (next === '\\') {
      return { char: '\\', nextIndex: start + 2 };
    } else if (next === 'u') {
      const hex = text.slice(start + 2, start + 6);
      if (!/^[0-9A-Fa-f]{4}$/.test(hex)) {
        throw new Error(`Invalid \\u escape: ${hex}`);
      }
      const codePoint = parseInt(hex, 16);
      return { char: String.fromCharCode(codePoint), nextIndex: start + 6 };
    } else if (next === 'U') {
      const hex = text.slice(start + 2, start + 10);
      if (!/^[0-9A-Fa-f]{8}$/.test(hex)) {
        throw new Error(`Invalid \\U escape: ${hex}`);
      }
      const codePoint = parseInt(hex, 16);
      return { char: String.fromCodePoint(codePoint), nextIndex: start + 10 };
    } else {
      throw new Error(`Unknown escape sequence: \\${next}`);
    }
  }
}
