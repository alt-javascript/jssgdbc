import { snapshotTerm, defaultGraph, createQuad } from '@alt-javascript/jssgdbc-core';
export const n = value => snapshotTerm({ termType: 'NamedNode', value });
export const b = value => snapshotTerm({ termType: 'BlankNode', value });
export const l = (value, language = '', datatype = language ? 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString' : 'http://www.w3.org/2001/XMLSchema#string') => snapshotTerm({ termType: 'Literal', value, language, datatype: { termType: 'NamedNode', value: datatype } });
export const d = defaultGraph;
export const q = createQuad;
