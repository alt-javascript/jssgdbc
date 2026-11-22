# Strings and RDF terms

The Graph API accepts structural RDF/JS terms, not string shorthand. This applies
to memory, file, SPARQL and Neo4j. See the [typed Graph contract](TYPED-TERMS.md)
for validation rules and [adapter conformance](CONFORMANCE.md) for shared tests.

## Graph inputs

- Pass a NamedNode with an absolute IRI value, not a bare IRI string or bracketed
  N-Triples text. Relative IRIs are not resolved.
- Pass a Literal with its lexical value, language and NamedNode datatype. Quotes
  and escape sequences from N-Triples are serialization syntax, not a Graph input
  format. A NamedNode and a Literal containing the same text are different terms.
- Pass a BlankNode, not `_:label`. Labels are not globally portable identities;
  imports and remote responses can assign different labels to equivalent graphs.
- Use a NamedNode or DefaultGraph to select a graph. `client.getGraph()` selects
  DefaultGraph; string selectors, including the empty string, are invalid.
- Only `null` and `undefined` are wildcards in `find`, `has`, `count` and `remove`.
  Empty strings and `*` are not wildcards. `add` requires three bound terms.

Malformed inputs reject with TypeError. Supported term kinds in illegal positions
also reject: a literal cannot be a subject, and a blank node cannot be a predicate.
Valid but unsupported RDF features have the errors described in the typed contract.

## Lexical identity

Literal lexical values are not coerced to JavaScript values or normalized as
numbers: integer literals with values `001` and `1` remain distinct. Plain literals
use `xsd:string`; language literals require lowercase tags and `rdf:langString`.
Escaped text must be decoded by a parser before it becomes a term value.

The file driver parses and serializes N-Triples at the storage boundary. That does
not make N-Triples strings valid public Graph inputs. Storage encoding, including
blank-node label encoding, is separate from the typed API.

## Test coverage

`typedGraphComplianceTests` in `typedCompliance.js` checks structural terms,
lexical distinctions, graph isolation and all eight bound/wildcard combinations
with both null and undefined. The string-based `driverComplianceTests` export in
`driverCompliance.js` does not describe the current public input contract and is
not evidence of typed adapter conformance.
