// Dependency-free validation of one API string term, not a document parser.
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';
const unicodeEscape = /\\(?:u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8}))/g;
function scalar(code) {
  if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new TypeError('invalid Unicode scalar');
  return String.fromCodePoint(code);
}
function unicode(text) {
  return text.replace(unicodeEscape, (_, short, long) => scalar(parseInt(short ?? long, 16)));
}
function iri(text) {
  const value = unicode(text);
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) || /[\x00-\x20<>"{}|^`\\]/u.test(value) || !value.isWellFormed()) {
    throw new TypeError('expected absolute IRI');
  }
  return value;
}
export function quoteLiteral(value) {
  if (!value.isWellFormed()) throw new TypeError('invalid Unicode scalar');
  return '"' + value.replace(/["\\\x00-\x1f\x7f-\x9f]/g, char => {
    const escapes = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
    return escapes[char] ?? `\\u${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
  }) + '"';
}
export function normalizeTerm(value, position = 'object', pattern = false) {
  try {
    if (value === null || value === undefined) {
      if (pattern) return value;
      throw new TypeError('requires a bound term');
    }
    if (typeof value !== 'string') throw new TypeError('must be a string');
    if (value.startsWith('"')) {
      if (position !== 'object') throw new TypeError('literal is only allowed in object position');
      const match = /^"((?:[^"\\\r\n]|\\(?:[tbnrf"'\\]|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}))*)"(?:@([a-zA-Z]+(?:-[a-zA-Z0-9]+)*)|\^\^<([^<>]*)>)?$/u.exec(value);
      if (!match || match[0] !== value) throw new TypeError('malformed quoted literal');
      const escapes = { t: '\t', b: '\b', n: '\n', r: '\r', f: '\f', '"': '"', "'": "'", '\\': '\\' };
      const lexical = match[1].replace(/\\(?:u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8})|([tbnrf"'\\]))/g,
        (_, short, long, escape) => escape ? escapes[escape] : scalar(parseInt(short ?? long, 16)));
      const datatype = match[3] === undefined ? undefined : iri(match[3]);
      return quoteLiteral(lexical) + (match[2] ? `@${match[2].toLowerCase()}` : datatype && datatype !== XSD_STRING ? `^^<${datatype}>` : '');
    }
    if (value.startsWith('_:')) {
      // RDF 1.1 PN_CHARS ranges, including non-ASCII labels.
      const base = 'A-Za-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}';
      const chars = base + '_0-9\\-\\u00B7\\u0300-\\u036F\\u203F-\\u2040';
      if (position === 'predicate' || /\s/u.test(value) || !new RegExp(`^_:[${base}_0-9](?:[${chars}.]*[${chars}])?$`, 'u').test(value)) throw new TypeError('invalid blank node or position');
      return value;
    }
    if (value.startsWith('<')) {
      if (!value.endsWith('>')) throw new TypeError('unterminated IRI');
      return iri(value.slice(1, -1));
    }
    return iri(value);
  } catch (error) {
    throw new TypeError(`${position}: ${error.message}`, { cause: error });
  }
}
