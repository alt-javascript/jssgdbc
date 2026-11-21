# Cypher statement contract

This package exports the dependency-free `CypherBuilder`. It builds statements;
no connection, driver registration, filesystem access or database execution occurs.
The current implementation provides `static buildAdd(graphName, subject, predicate, object)`.

## Term and triple identity

Nodes have the fixed label `JssgdbcTerm` and string properties `graph`, `kind`,
`value`. Identity is the complete tuple `(graph, kind, value)`, not just value.
Relationships have the fixed type `JSSGDBC_TRIPLE` and string property `predicate`.
A triple's identity is its subject endpoint, exact predicate, and object endpoint.
Predicates are never labels or relationship types.

Both endpoints bind the same graph parameter. Null or undefined graph names
normalize to `''` (the default graph); all other graph names must be strings.
`''` is the default, not a distinct named graph. Named graphs use exact strings;
identical terms and blank-node identifiers in different graphs are separate nodes.

The shared classification rule is deliberately not an RDF parser:

- Strings starting with either a double quote (`"`) or single quote (`'`) have kind `literal`.
- Strings starting with `_:` have kind `blank`.
- All other strings have kind `iri`, including bare tokens, bracketed IRIs and `''`.

Every string is kept exactly, including quotes, escapes, language/datatype suffixes,
whitespace and incomplete literal spellings. Bare `urn:x` and `<urn:x>` differ.
Subjects allow `iri` and `blank`; predicates only `iri`; objects allow all kinds.
Literal spelling does not undergo language, datatype or Unicode normalization.

## Insertion

`buildAdd` returns a fresh `{query, params}` with deterministic statement text:

```cypher
MERGE (s:JssgdbcTerm {graph: $graph, kind: $subjectKind, value: $subject})
MERGE (o:JssgdbcTerm {graph: $graph, kind: $objectKind, value: $object})
MERGE (s)-[r:JSSGDBC_TRIPLE {predicate: $predicate}]->(o)
```

For `CypherBuilder.buildAdd(null, '_:s', 'urn:p', '"hello"@en')`, params are:

```js
{
  graph: '', subjectKind: 'blank', subject: '_:s',
  predicate: 'urn:p', objectKind: 'literal', object: '"hello"@en'
}
```

Pass query and params separately to the eventual transport; never interpolate
params back into query text. The result has no return-row contract for mutations.
Calls do not mutate inputs or share mutable parameter objects.

Missing/null/undefined add terms, non-string concrete values (including boxed
strings), literal subjects and blank/literal predicates throw synchronous
`TypeError`s. Messages identify the operation, role and one-based argument
position without echoing input, e.g. `buildAdd: subject (argument 2) must be a string`.
Values are never coerced. Empty strings are concrete values, not missing terms.

## Reserved read contract for S02 composition

T02 will add `buildFind`, `buildHas`, `buildCount`, `buildRemove` with the same
four arguments, plus `buildClear(graphName)`. Null/undefined SPO values will be
wildcards for those pattern operations only. Every query must scope both endpoints.
Fixed result aliases are `subject`, `predicate`, `object` for exact string values
from find; `exists` for one boolean from has; and `count` for one aggregate count,
including zero matches. Neo4j integer conversion belongs to the S02 adapter.
No ordering guarantee is planned. Removal/clear will delete only matching
relationships, intentionally retaining orphan term nodes.

## Limits of this proof

MERGE expresses sequential set semantics on a valid, non-duplicated store. These
contract tests assert generated strings and parameters, not executed Cypher.
S02 must verify real Neo4j parsing/execution, transactional and concurrent inserts
with appropriate constraints/locking, result decoding, streaming, and connection,
timeout and server errors. Node uniqueness alone must not be assumed to prove
concurrent relationship uniqueness. No live Neo4j proof is claimed here.

Building performs fixed prefix checks and allocates a bounded number of objects;
text handling is at most linear in input size (serialization by a future transport
is linear). There is no I/O, graph scan, cache, batch accumulation or interpolation.
At 10x caller volume, allocation/GC and retained parameter payloads are the local
resource concern; no artificial term-size limit is imposed. Runtime query cost,
unbounded result streams and backpressure are adapter concerns.

## Diagnostics

Inspect `{query, params}` locally or run `node --test test/cypher-builder.test.js`
from the package directory. Tests name fixtures and invalid argument positions.
The builder emits no logs; avoid logging sensitive params in the future adapter.
