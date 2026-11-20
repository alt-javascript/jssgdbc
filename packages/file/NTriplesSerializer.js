export class NTriplesSerializer {
  static serialize(triples) {
    return triples.map(triple => this.serializeLine(triple)).join('\n') + '\n';
  }

  static serializeLine(triple) {
    const subject = this.serializeTerm(triple.subject);
    const predicate = this.serializeTerm(triple.predicate);
    const object = this.serializeTerm(triple.object);

    return `${subject} ${predicate} ${object} .`;
  }

  static serializeTerm(term) {
    if (term.startsWith('<') && term.endsWith('>')) {
      return term;
    }

    if (term.startsWith('_:')) {
      return term;
    }

    if (term.startsWith('"')) {
      return this.serializeLiteral(term);
    }

    throw new Error(`Unknown term type: ${term}`);
  }

  static serializeLiteral(literal) {
    let content = literal.slice(1);
    let datatype = null;
    let lang = null;

    if (content.includes('^^')) {
      const parts = content.split('^^');
      content = parts[0];
      datatype = parts[1];
    } else if (content.includes('@')) {
      const parts = content.split('@');
      content = parts[0];
      lang = parts[1];
    }

    const stringValue = content.slice(0, -1);
    const escaped = this.escapeLiteralValue(stringValue);

    let result = `"${escaped}"`;

    if (datatype) {
      result += `^^${datatype}`;
    } else if (lang) {
      result += `@${lang}`;
    }

    return result;
  }

  static escapeLiteralValue(value) {
    let escaped = '';

    for (let i = 0; i < value.length; i++) {
      const char = value[i];
      const code = char.charCodeAt(0);

      if (char === '\\') {
        escaped += '\\\\';
      } else if (char === '"') {
        escaped += '\\"';
      } else if (char === '\t') {
        escaped += '\\t';
      } else if (char === '\n') {
        escaped += '\\n';
      } else if (char === '\r') {
        escaped += '\\r';
      } else if (code < 0x0020 || code > 0x007E) {
        const codePoint = char.codePointAt(0);
        if (codePoint > 0xFFFF) {
          escaped += '\\U' + codePoint.toString(16).padStart(8, '0');
        } else {
          escaped += '\\u' + codePoint.toString(16).padStart(4, '0');
        }
      } else {
        escaped += char;
      }
    }

    return escaped;
  }
}
