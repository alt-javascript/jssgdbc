// Independent, mutable structural fixtures: deliberately no dependency on core constructors.
export const namedNode = value => ({ termType: 'NamedNode', value });
export const blankNode = value => ({ termType: 'BlankNode', value });
export const defaultGraph = () => ({ termType: 'DefaultGraph', value: '' });
export const literal = (value, language = '', datatype = language
  ? 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString'
  : 'http://www.w3.org/2001/XMLSchema#string') => ({
  termType: 'Literal', value, language, datatype: namedNode(datatype)
});
