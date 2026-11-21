# Cypher statement contract

This package exports the dependency-free `CypherBuilder`. It builds statements;
no connection, driver registration, filesystem access or database execution occurs.
All public methods are static and return fresh `{query, params}` objects:

- `buildAdd(graphName, subject, predicate, object)`
- `buildFind(graphName, subject, predicate, object)`
- `buildHas(graphName, subject, predicate, object)`
- `buildCount(graphName, subject, predicate, object)`
- `buildRemove(graphName, subject, predicate, object)`
- `buildClear(graphName)`

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

## Pattern operations and result aliases

For `buildFind`, `buildHas`, `buildCount` and `buildRemove`, null, undefined and
omitted SPO arguments are wildcards independently in each position. Empty strings
remain concrete filters. Concrete values reuse insertion's classification and
validation, with the invoked method name in each error. Graph validation is the
same for every method, including `buildClear`.

Every pattern statement starts with this connected, fixed-label/type match:

```cypher
MATCH (s:JssgdbcTerm {graph: $graph})-[r:JSSGDBC_TRIPLE]->(o:JssgdbcTerm {graph: $graph})
```

Concrete subjects append `s.kind = $subjectKind AND s.value = $subject`;
predicates append `r.predicate = $predicate`; objects append
`o.kind = $objectKind AND o.value = $object`. Filters appear in SPO order in one
`WHERE` clause joined by `AND`; a fully wildcard pattern has no `WHERE` clause.
Only concrete filters contribute parameters; `graph` is always present.

The final clause is fixed by method:

| Method | Final clause | Row contract |
| --- | --- | --- |
| `buildFind` | `RETURN s.value AS subject, r.predicate AS predicate, o.value AS object` | Exact strings, no internal entities; no ordering guarantee |
| `buildHas` | `RETURN count(r) > 0 AS exists` | One boolean, including false for no matches |
| `buildCount` | `RETURN count(r) AS count` | One aggregate count, including zero for no matches |
| `buildRemove` | `DELETE r` | No return-row contract |
| `buildClear` | `DELETE r` | Same statement as fully wildcard remove |

Neo4j integer conversion of `count` belongs to the S02 adapter. Aggregations have
no grouping keys so the intended contract includes a row for zero matches; this
still needs live execution verification in S02.

For example, `CypherBuilder.buildFind('named', null, 'urn:p', '"hello"@en')`
returns:

```js
{
  query: 'MATCH (s:JssgdbcTerm {graph: $graph})-[r:JSSGDBC_TRIPLE]->(o:JssgdbcTerm {graph: $graph})\n'
    + 'WHERE r.predicate = $predicate AND o.kind = $objectKind AND o.value = $object\n'
    + 'RETURN s.value AS subject, r.predicate AS predicate, o.value AS object',
  params: { graph: 'named', predicate: 'urn:p', objectKind: 'literal', object: '"hello"@en' }
}
```

`CypherBuilder.buildClear()` returns the connected match followed by `DELETE r`
with `{graph: ''}`. Remove and clear delete only matched `JSSGDBC_TRIPLE`
relationships whose endpoints both belong to the requested graph. They never
use `DETACH DELETE`, delete nodes, traverse variable-length paths, or target
unrelated application labels/types. Orphan terms are intentionally retained;
node cleanup is outside this contract.

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
