# Typed Graph contract

The core Graph API accepts structural RDF/JS terms, not strings. Memory, file,
SPARQL and Neo4j implement this profile and run `typedGraphComplianceTests` from
`typedCompliance.js`. See [adapter conformance](CONFORMANCE.md) for the test
commands and backend-specific limits. The string-based `driverComplianceTests`
export is not a compatibility layer or evidence of typed conformance.

## Profile and API

The supported profile is RDF 1.1 / RDF/JS structural terms: subject NamedNode or
BlankNode, predicate NamedNode, object NamedNode/BlankNode/Literal; graph identity
NamedNode or DefaultGraph. Terms may come from any factory; no instanceof checks
or caller `equals` implementation is trusted. Core and memory have no external runtime
dependencies. NamedNode values must be absolute IRIs (scheme, no forbidden IRI
characters); relative IRIs are not resolved. Blank identifiers must be nonempty.
Literals require a language string and NamedNode datatype. Language tags must be
lowercase per RDF/JS and use rdf:langString iff language is nonempty. Lexical
values and datatype IRIs are never coerced to JS values or canonicalized.
Variables, embedded quads, blank-node graph names and directional literals are
explicitly unsupported (`UnsupportedRdfFeatureError`, extending
`UnsupportedOperationError`, with `feature` and `position`). Malformed terms or
illegal positions throw TypeError. Caller getter errors propagate unchanged.

- `client.getGraph()` selects DefaultGraph; `getGraph(graphTerm)` selects a graph.
  Strings (including empty string) and null are not graph names.
- `graph.getName()` returns a detached immutable graph term. Structural keys include
  termType, so external equal terms reuse the open handle without conflating graph
  kinds. Closed handles are evicted; reacquisition shares the retained memory store.
- `add(subject,predicate,object)` requires all three terms. Exact duplicate quads
  remain a no-op; lexical/datatype/language-distinct
  objects are distinct rows. Blank-node identity is adapter-specific; labels are
  not portable identifiers across imports or remote responses.
- `find/remove/has/count(subject?,predicate?,object?)`: only null or undefined
  are wildcards, independently in all three slots. Empty string and `*` are invalid.
- `clear()` affects only the selected graph.
- `find` returns a buffered Cursor. Existing `getTriple/getTriples` names are retained,
  but rows are immutable RDF/JS Quads with `termType: 'Quad'`, `value: ''`,
  subject/predicate/object/graph and structural `equals`. Terms have `equals` too.
  Snapshots survive graph
  mutations and client closure; returned values cannot mutate storage.
- Inputs are synchronously detached before adapter invocation. Accepted operations
  remain in Graph's drain set; graph/client close invalidate new work immediately,
  drain admitted work, and release all owned handles, including evicted handles.

## Capabilities v1

`client.getCapabilities()` returns recursively frozen
`{version: 1, features: {featureName: {status, detail?}}}`. Shared keys are exported
as `CAPABILITY_KEYS`; `createCapabilities` fills unspecified guarantees as unknown.
Status is one of `supported` (inherent), `configured` (enabled by configuration),
`unavailable` (known absent), `unknown` (no guarantee). Details are immutable strings.
The schema rejects unknown keys or statuses. Generic Client reports unknown, not
inferred support. Memory explicitly advertises volatile storage, no transactions,
no cross-graph atomicity, no streaming, and no duplicate quads. RDF 1.1 support is
qualified by the graph-kind restrictions above. The separate
[Dataset persistence API](DATASET-PERSISTENCE.md) requires explicit graph
selections; these capabilities do not imply additional persistence guarantees.

## Memory resource and failure limits

Memory has no filesystem, network, subprocess or API dependency. Validation and
adapter failures reject the operation unchanged and are drained by close; there
are no retries/timeouts or swallowed errors. Allocation failure is not recoverable.

Expected use is small local graphs (~1,000 quads). Stores are arrays: individual
lookups and duplicate checks are O(n), bulk insertion is O(n²), and find allocates
an O(matches) snapshot. At 10x (10,000 quads) CPU for repeated insertion/linear scans
and heap for concurrent buffered cursors are the first pressures. No hard size cap,
pagination, index or backpressure is promised. `has` short-circuits and `count`
does not allocate a filtered array. Callers should bound workloads and release
cursors; capabilities explicitly mark streaming unavailable. Do not use this driver
for unbounded ingestion.
