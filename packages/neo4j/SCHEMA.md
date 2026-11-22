# Typed Neo4j storage contract

## Version and admission

Storage version `1`, profile `rdfjs-structural-v1` is centralized in
`RdfStorage.js`. It is deliberately incompatible with legacy string storage.
Connection verifies native connectivity, inspects owned records before DDL, creates
identity constraints and converges on one transactional schema marker. A second
inspection validates repeat opens. Unrelated application labels are permitted.

The marker is `(:JssgdbcRdfSchema {id: 'jssgdbc-rdf', version: '1',
profile: 'rdfjs-structural-v1'})`. Constraints uniquely identify marker `id`,
graph `key`, and term `(graph, key)`. Legacy `JssgdbcTerm` or `JSSGDBC_TRIPLE`,
mixed old/new, unmarked owned records, multiple or incompatible markers reject
admission. Compatibility errors are sanitized and provide operator-controlled
reset guidance, never query, credentials or stored payloads. Admission is not an
exhaustive integrity scan; malformed term/triple records reject buffered decoding.

There is no automatic migration or destructive repair. Back up/export first,
coordinate writers, then choose a separate database or explicitly reset only
adapter-owned storage under operator control. Never relabel legacy data or invent
a marker to bypass validation. Preserve unrelated labels and relationships.

## Physical representation and identity

- `JssgdbcRdfGraph`: `key` is the core structural graph key. DefaultGraph and
  NamedNode graph identifiers cannot collide. Blank graph names are unsupported.
- `JssgdbcRdfTerm`: `graph` is the graph key, `key` the core structural term key,
  with `termType`, `value` and literal-only `language` and `datatype` strings.
- `(subject)-[:JSSGDBC_RDF_TRIPLE {predicate: iri}]->(object)` represents a triple
  within one physical graph. Predicates are NamedNodes; literal subjects reject.

Keys are unambiguous JSON encodings, not delimiter concatenations. Literal lexical
forms are not coerced to native numbers/booleans. Datatype and language participate
in identity; typed `01` differs from `1`. Stable blank identifiers span physical
graph partitions. A new Dataset save maps each input blank label to a UUID-based
identity once across the entire input, before managed retries. Repeating an
independent merge save therefore allocates new blanks. Graph.add uses explicit
blank identity directly. Independent RDF/JS implementations work structurally.

## Query and transaction contract

`CypherBuilder` returns `{ query, params }` for buildAdd, buildFind, buildHas,
buildCount, buildRemove, buildClear and buildLock. Every RDF value is a parameter;
labels and query structure are fixed. Pattern null/undefined positions are
wildcards. Reads buffer records and strictly validate before creating detached
quads. Unknown/corrupt records or malformed counts reject, never empty success.

Graph add/remove/clear acquire the graph serialization lock before mutation.
The lock uses a graph-node write before term/relationship MERGE, suppressing
concurrent duplicate relationships across clients. Dataset replacement uses that
same lock, clear and insertion in one managed transaction per graph. Empty
replacement still clears transactionally. Merge also locks. Fixed parameters and
blank scopes are reused by native managed retries. Remove/clear retain orphan term
and graph nodes, so reclamation is a separate operator concern.

Dataset input and selectors undergo full preflight before any write. Graphs are
explicit and unique; foreign quads, strings, Variables, RDF-star and blank graph
selectors reject. Selected graphs execute sequentially. There is no whole-save
atomicity, no cross-graph read snapshot and no promise of streaming. Replace racing
with add has either complete serialized order, not interleaved clear/insertion.

A save reports per-graph committed/unknown/not-attempted outcomes. Hook rejection,
including lost acknowledgement or session-close failure, is conservatively unknown
rather than proof of rollback. Reconnect and load/reconcile affected graphs before
retrying, coordinating other writers. Blind merge retry with blanks is not
idempotent. Tests separately prove a known server-aborted transaction rolls back;
that does not resolve transport uncertainty.

## Runtime, lifecycle and limits

The public URL is `jssgdbc:neo4j:<native-uri>` (bolt/neo4j and their +s/+ssc forms).
No arbitrary query API is exposed. See README for connection properties and
executable examples. Credentials come from properties, not URL userinfo.
Connection returns only after compatibility admission. Failed initialization
closes the native driver. Public close rejects new admissions, drains previously
admitted Dataset and Graph operations and then closes native resources. Cursors
already returned are detached buffered snapshots and must be closed by callers.

`getCapabilities()` returns deeply immutable, versioned facts: persistent blank
identity, RDF 1.1, explicit named/default graphs, merge/replace, buffered delivery,
per-graph save transactions; no cross-graph atomicity, streaming, RDF-star, Variables
or blank-node graph names. Consult the capability object, not inference from
method presence.

Preflight, scoped parameters and buffered reads require O(quads plus lexical
payload bytes) memory. No pagination, result cap, automatic chunking or backpressure
is supplied. At 10x input size heap/GC or Neo4j transaction memory can saturate;
at 10x concurrency hot graph locks and native pool capacity can saturate first.
Bound caller concurrency/input/query breadth; splitting saves changes atomicity and
blank scope. Native pool maximum is 100 per server. `timeoutMs` bounds transaction
and connection acquisition waits; `connectionTimeoutMs` bounds establishment;
managed retries can outlast a single timeout. No throughput SLA is claimed.

## Verification and diagnostics

`npm test --workspace=packages/neo4j` covers schema admission, parameterization,
strict decoding, retry stability, close drain, lost acknowledgement and session-close
uncertainty. `npm run test:integration --workspace=packages/neo4j` is mandatory real
proof: a random project-owned Compose fixture, serialized node:test live suites
(including independent Dataset compliance), then typed Mocha graph compliance.
It tests close/reopen, concurrent first opens, duplicate insertion, replace/add
serialization, injection, malformed input, rollback and unchanged incompatible
storage sentinels. README examples are executed unchanged. Runner phase timings and
owned project ID provide diagnostics. Missing Docker, unhealthy service, timeout or
failed suite produce nonzero status; bounded project-only teardown always runs.
Never run fixture cleanup against an external database or unrelated Docker project.
