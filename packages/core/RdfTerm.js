import { UnsupportedRdfFeatureError } from './errors.js';

export const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';
export const RDF_LANG_STRING = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString';
const positions = {
  subject: ['NamedNode', 'BlankNode'], predicate: ['NamedNode'],
  object: ['NamedNode', 'BlankNode', 'Literal'], graph: ['NamedNode', 'DefaultGraph']
};
const scalar = value => typeof value === 'string' && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const iri = value => scalar(value) && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) && !/[\x00-\x20<>"{}|^`\\]/u.test(value);

class Term {
  constructor(termType, value, extra = {}) {
    Object.assign(this, { termType, value }, extra);
    Object.freeze(this);
  }
  equals(other) {
    if (!other || other.termType !== this.termType || other.value !== this.value) return false;
    return this.termType !== 'Literal' || (other.language === this.language && this.datatype.equals(other.datatype));
  }
}
const DEFAULT = new Term('DefaultGraph', '');
export const defaultGraph = () => DEFAULT;

/** Validate and detach structural RDF/JS terms; never trust caller equals(). */
export function snapshotTerm(term, position = 'object', wildcard = false) {
  if (wildcard && term == null) return null;
  if (!term || typeof term !== 'object' || typeof term.termType !== 'string' || !scalar(term.value)) {
    throw new TypeError(`Expected RDF/JS term in ${position}`);
  }
  const { termType, value } = term;
  if (['Variable', 'Quad'].includes(termType) || (position === 'graph' && termType === 'BlankNode')) {
    throw new UnsupportedRdfFeatureError(`${termType} is unsupported in ${position}`, termType, position);
  }
  if (!positions[position]?.includes(termType)) throw new TypeError(`Invalid ${termType} in ${position}`);
  if (termType === 'NamedNode') {
    if (!iri(value)) throw new TypeError('NamedNode requires an absolute IRI');
    return new Term(termType, value);
  }
  if (termType === 'BlankNode') {
    if (!value) throw new TypeError('BlankNode requires a nonempty identifier');
    return new Term(termType, value);
  }
  if (termType === 'DefaultGraph') {
    if (value !== '') throw new TypeError('DefaultGraph value must be empty');
    return DEFAULT;
  }
  if (typeof term.language !== 'string' || (term.language && !/^[a-z]+(?:-[a-z0-9]+)*$/i.test(term.language))) {
    throw new TypeError('Literal requires a valid language string');
  }
  if (term.direction != null && term.direction !== '') {
    throw new UnsupportedRdfFeatureError('Directional literals are unsupported', 'direction', position);
  }
  const datatype = snapshotTerm(term.datatype, 'predicate');
  if (!!term.language !== (datatype.value === RDF_LANG_STRING)) throw new TypeError('Literal language/datatype mismatch');
  // RDF/JS language tags are lowercase. Reject nonconforming terms, do not silently rewrite input.
  if (term.language !== term.language.toLowerCase()) throw new TypeError('RDF/JS language tags must be lowercase');
  return new Term('Literal', value, { language: term.language, datatype });
}

export function termKey(term) {
  return JSON.stringify(term.termType === 'Literal'
    ? [term.termType, term.value, term.language, term.datatype.value]
    : [term.termType, term.value]);
}

class Quad {
  constructor(subject, predicate, object, graph) {
    Object.assign(this, { termType: 'Quad', value: '', subject, predicate, object, graph });
    Object.freeze(this);
  }
  equals(other) {
    return other?.termType === 'Quad' && ['subject', 'predicate', 'object', 'graph'].every(p => this[p].equals(other[p]));
  }
}
export function createQuad(subject, predicate, object, graph = DEFAULT) {
  return new Quad(snapshotTerm(subject, 'subject'), snapshotTerm(predicate, 'predicate'),
    snapshotTerm(object), snapshotTerm(graph, 'graph'));
}
