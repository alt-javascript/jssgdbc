# Neo4j runtime and Cypher statement contract

The package exports `Neo4jDriver`, `Neo4jClient`, `Neo4jGraph`, `CypherBuilder`
and the core API. Importing the package registers a singleton driver with
`DriverManager`; connection occurs only on `DriverManager.getClient(...)`.
The builder itself performs no I/O. Its static methods return fresh
`{query, params}` objects:

- `buildAdd(graphName, subject, predicate, object)`
- `buildFind(graphName, subject, predicate, object)`
- `buildHas(graphName, subject, predicate, object)`
- `buildCount(graphName, subject, predicate, object)`
- `buildRemove(graphName, subject, predicate, object)`
- `buildClear(graphName)`

## Transport contract

The public `Neo4jDriver`/`Neo4jClient` transport accepts
`jssgdbc:neo4j:<native-uri>` with `bolt`, `bolt+s`, `bolt+ssc`, `neo4j`,
`neo4j+s`, or `neo4j+ssc`. Embedded userinfo, fragments and non-root paths
are rejected. Credentials belong only in properties, never in the URL.

Properties must be a plain object with only these optional keys:

| Property | Type / default |
| --- | --- |
| `username`, `password` | Nonempty strings, supplied together; omitted means native unauthenticated connection |
| `database` | Nonblank string; omitted uses the server default |
| `timeoutMs` | Integer 1–2147483647; default 30000; transaction timeout and native retry budget |
| `connectionTimeoutMs` | Integer 1–2147483647; default 10000; connection and pool acquisition timeout |

Connect verifies connectivity and installs the idempotent composite uniqueness
constraint `jssgdbc_term_identity` on `JssgdbcTerm(graph, kind, value)` before
returning. Initialization failure closes the owned driver. Constraint creation
requires appropriate server permissions and compatible existing data.

Each operation owns one session and uses a managed read/write transaction.
Sessions close in `finally`; the primary operation failure wins over cleanup
failure. Native retries can repeat callbacks; callbacks must have no external
side effects. Records are buffered before the transaction returns; decoding is
performed by the graph layer after session cleanup. There is no streaming,
backpressure, caller-owned transaction scope or result-size cap. Memory is
O(returned rows and their payloads); at 10x result volume heap/GC may saturate
before the server. Concurrent operations can saturate the pool (100 connections
per server) or server locks. Acquisition timeouts and native transaction timeouts
limit waiting/work, not result memory, nor a strict end-to-end wall-clock deadline
across retries. Callers must limit concurrent work and broad queries.

`close()` marks the client closed immediately and returns the same cleanup promise
on repeated calls, including when cleanup rejects. Await it. Errors expose only
operation and a recognized-format native driver code; native messages, causes,
credentials and parameters are not retained in the exposed error. No query or
credential logging is configured. Run `npm test --workspace=packages/neo4j` for
offline transport, graph decoding/lifecycle and mapper diagnostics. Live service
checks and fixture readiness/startup/teardown commands are documented below; no live
service or concurrency result is claimed by these offline tests.

`client.getGraph(null)`, `getGraph(undefined)` and `getGraph('')` share the same
cached default graph. Graph handles reject operations after graph or client close,
including handles retained before client close. Mutations resolve to `undefined`.
`find` returns a core `Cursor` of exact string triples, fully independent of the
closed session and subsequently closed client. Cursor close only releases its API
usability; it does not control server resources. Find aliases/types are validated;
`has` requires exactly one boolean `exists` row. Decode errors identify the
operation as `Neo4j <operation>: invalid result` and exclude row contents.

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

The graph passes query and params separately to transport; it never interpolates
params back into query text. The result has no return-row contract for mutations.
Calls do not mutate inputs or share mutable parameter objects.

Missing/null/undefined add terms, non-string concrete values (including boxed
strings), literal subjects and blank/literal predicates throw synchronous
`TypeError`s. Messages identify the operation, role and one-based argument
position without echoing input, e.g. `buildAdd: subject (argument 2) must be a string`.
Values are never coerced. Empty strings are concrete values, not missing terms.

### Transactional insertion lock

Before running the builder's add statement, `Neo4jGraph` executes this fixed
statement in the **same managed write transaction**:

```cypher
MERGE (s:JssgdbcTerm {graph: $graph, kind: $subjectKind, value: $subject})
SET s._jssgdbcLock = true
REMOVE s._jssgdbcLock
```

The composite uniqueness constraint provides one graph-scoped subject. Writing
its reserved temporary `_jssgdbcLock` property acquires a database-side node write
lock held until transaction end, even after the property is removed. The next
statement performs relationship MERGE only after that lock is acquired, serializing
identical-subject inserts across clients. No process-local mutex is used. This
metadata does not alter `(graph, kind, value)` identity or remain after commit.
Do not use `_jssgdbcLock` for application data or bypass this protocol for writes.
Self-loops reuse the same term; opposite-endpoint inserts may deadlock as they
acquire object locks, and the native managed transaction retries the entire
lock-plus-add callback for retryable failures. Exhausted retries fail safely.
Offline tests assert sequencing and retry-safe callbacks; T03 must prove real
concurrent set semantics. Existing duplicate relationships are not repaired.

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

The graph requires one native Neo4j Integer count, checks `inSafeRange()` before
`toNumber()`, and rejects negative, unsafe or malformed values without echoing
them. Zero and Number.MAX_SAFE_INTEGER are supported. Aggregations have no
grouping keys so the contract includes a row for zero matches; real execution
verification remains T03.

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

Offline tests assert generated strings/parameters, lock sequencing, buffered
decoding, connection/cleanup failures and API lifecycle, not executed Cypher.
T03 must verify real Neo4j parsing/execution and concurrent inserts. Node uniqueness
alone is not a relationship uniqueness guarantee. No live Neo4j proof is claimed
here, and streaming is not supported.

Building performs fixed prefix checks and allocates a bounded number of objects;
text handling and transport serialization are at most linear in input size.
The builder has no I/O, graph scan, cache, batch accumulation or interpolation.
At 10x caller volume, allocation/GC and retained parameter payloads are the local
resource concern; no artificial term-size limit is imposed. Runtime broad queries
buffer all matching rows; there is no pagination or backpressure. At 10x write
concurrency, hot-subject lock contention or connection pool acquisition can become
the first bottleneck. Timeouts/retry budgets bound individual waits, not memory.
Orphan nodes accumulate on remove/clear; storage reclamation is not implemented.

## Disposable live fixture

From the repository root, with Docker running:

```sh
docker compose -f packages/neo4j/compose.test.yml up -d --wait --wait-timeout 240
npm run test:integration --workspace=packages/neo4j
docker compose -f packages/neo4j/compose.test.yml down --volumes
```

Always run teardown, including after test or readiness failure. The pinned
`neo4j:5.26.0-community` fixture exposes only Bolt on `127.0.0.1:17687`;
HTTP is not published. Data and logs use ephemeral tmpfs, not production volumes.
Authentication is disabled **only for this disposable local fixture**. Do not
point this suite at a shared service or change a remote service's authentication.
The suite intentionally has no remote URL override: it uses
`jssgdbc:neo4j:bolt://127.0.0.1:17687`, database `neo4j`, no credentials,
2000ms connection/acquisition timeout and 10000ms transaction/retry budget.
Run on a trusted local machine; any local process can access this fixture.

Compose waits for a successful `cypher-shell RETURN 1` health check. Pull/startup
or readiness failure is a failure, not a skip. The integration command also fails
when the service is absent. It prints the actual server version from
`dbms.components()` only after a successful connection. Named tests cover CRUD,
all eight wildcard masks, exact string round trips, independent-client duplicate
inserts (including blank nodes and self-loops), opposite endpoints, constraints,
application-data isolation and lifecycle. Twelve concurrent writes per case are
bounded correctness checks, not throughput claims. Buffering and hot-subject
contention limits above still apply.

Cleanup in `finally` awaits driver closure and deletes only run-owned named
graphs/default subject and sentinel nodes. Fixture teardown reclaims remaining
orphan terms. The unavailable-endpoint case uses a freshly released loopback port
and asserts bounded, redacted failure context. Offline malformed-row/integer tests
remain necessary because normal servers do not produce those invalid records.

Verification note (2026-11-21): after initial image-pull timeouts, fixture startup
and health checks succeeded. The non-skipped integration suite passed both tests
against the observed Neo4j runtime **5.26.0**, including public CRUD and bounded
cross-client concurrency checks. This is correctness evidence, not a throughput
or broader server-version compatibility claim.

## Diagnostics

Inspect `{query, params}` locally or run `node --test test/cypher-builder.test.js`
from the package directory. Tests name fixtures and invalid argument positions.
Neither builder nor adapter logs query parameters, triple contents or credentials.
Graph tests in `test/neo4j-graph.test.js` name failures by alias, integer boundary,
transaction order and lifecycle. Transport tests localize native failure phases.
