# Breaking changes: explicit RDF terms and Dataset persistence

This is the current experimental M006 contract, superseding the M005 string API.
All six workspaces remain private `0.0.0`; no release or automatic data migration
is implied. Later query, streaming and backend roadmap proposals are not delivered.

## Replace strings with RDF/JS terms

Use an external RDF/JS DataFactory, for example `@rdfjs/data-model`:
`rdf.namedNode('urn:alice')` replaces the IRI string `'urn:alice'`, while
`rdf.literal('Alice')` replaces the old quoted literal syntax. Do not pass
N-Triples surface strings to Graph methods. Terms are accepted structurally,
not by constructor identity. Subjects are NamedNode/BlankNode, predicates
NamedNode, objects NamedNode/BlankNode/Literal. Literal lexical text, datatype
and normalized lowercase language are retained; integer `01` and `1` stay distinct.

`client.getGraph()` selects DefaultGraph. Explicit selectors are NamedNode or
DefaultGraph terms, never strings, null or blank-node graph names. Only matching
operations accept null/undefined SPO wildcards; add requires bound terms.
Cursors return detached immutable Quads, including graph identity, not strings.
Malformed terms reject before I/O; unsupported RDF features reject explicitly.
See the [typed profile](../packages/core/test/TYPED-TERMS.md) and the executable
[root quickstart](../README.md#memory-example).

## Local Dataset editing is not persistence

Core/memory have no external runtime dependencies. Supply your own DatasetFactory,
or opt into the [full synchronous Dataset factory](../packages/dataset/README.md).
Its local add/delete/map/filter/set operations never write to a backend. Its
standard stream import is asynchronous; that does not make storage streaming.

- `await client.loadDataset({ graphs, factory })` builds a detached local Dataset.
- `await client.saveDataset(dataset, { graphs, mode: 'merge' })` snapshots and
  validates the entire synchronous quad iterable before writing.
- Both require a **nonempty** array of NamedNode/DefaultGraph selectors. There is
  no implicit all-graphs selection. Duplicate selectors collapse; out-of-scope
  quads and invalid modes reject before writes.
- `merge` adds ground quads with set semantics; it cannot delete old data.
  `replace` clears every selected graph, including selected graphs with no input
  quads, and inserts the new contents. Unrelated graphs remain untouched.

Each Dataset import/save allocates a fresh blank scope shared across its selected
graphs. SPARQL loads have a fresh response scope; returned blank labels cannot be
used for cross-request identity queries/deletes. Local/file/Neo4j direct Graph
operations can preserve explicit blank identity, but this is not portable remote
identity. Compare round trips by isomorphism (`Dataset.equals`), not blank labels.
Repeated blank-node merges are **not idempotent**. Replacement cannot preserve
blank links to unselected graphs. Use application-owned IRIs for stable identities.

## Failure recovery and lifecycle

Successful saves return frozen ordered `{ graph, status: 'committed' }` outcomes.
Execution failures throw `DatasetSaveError` with `cause` and ordered `outcomes`:

- `committed`: acknowledged success, including a no-op;
- `unknown`: dispatched work may have written despite failure;
- `not-attempted`: no affecting work was dispatched.

Core preserves the adapter cause; remote adapters sanitize transport errors first.
Preflight and load/factory errors propagate directly, not as DatasetSaveError.
Inspect/reload affected graphs and reconcile desired versus actual state before
another write. Do not automatically retry an uncertain save, especially a blank
merge. A lost acknowledgement or cleanup failure is not proof of rollback.
Coordinate other writers during reconciliation. There is no cross-graph atomicity
promise or automatic rollback. See the [persistence contract](../packages/core/test/DATASET-PERSISTENCE.md).

Await client/graph close in finally blocks: close rejects new operations and drains
admitted work, rather than cancelling or deleting data. Detached cursors need their
own close. Cleanup failures remain observable; repeated close is not a cleanup retry.

## Measured capability profile

`client.getCapabilities()` returns deeply frozen `{ version: 1, features }`.
Statuses are `supported` (inherent), `configured` (enabled by configuration),
`unavailable` (known absent), and `unknown` (no guarantee). Unknown is not support.
The following table reflects declarations, not vendor advertising:

| Feature | Memory | File | SPARQL | Neo4j |
| --- | --- | --- | --- | --- |
| RDF 1.1 typed profile, named/default graphs | supported | supported | supported | supported |
| Persistence | unavailable (volatile per client) | supported | unknown (endpoint-dependent) | supported |
| Transactions | unavailable | unavailable | unavailable (no client transaction API) | supported (per-graph managed transaction) |
| Cross-graph atomicity | unavailable | unavailable | unknown (endpoint-dependent) | unavailable |
| Blank-node graph names, RDF-star, Variable storage | unavailable | unavailable | unavailable | unavailable |
| Streaming, duplicate quads | unavailable | unavailable | unavailable | unavailable |

The local optional Dataset permits blank graph names and factory Variable
construction; persistence rejects both as stored graph/quad features. No RDF 1.2,
inference or arbitrary query support is implied. SPARQL default graphs may be
endpoint union views; one HTTP update is not a transaction guarantee.

Declarations: [schema](../packages/core/Capabilities.js),
[memory](../packages/memory/MemoryClient.js), [file](../packages/file/FileClient.js),
[SPARQL](../packages/sparql/SparqlClient.js), [Neo4j](../packages/neo4j/Neo4jClient.js).
The shared [independent Dataset fixture](../packages/core/test/datasetCompliance.js)
measures frozen v1 facts, selection, lexical identity, local edits, merge/replacement
and blank sharing. Adapter tests cover [memory](../packages/memory/test/dataset.spec.js),
[file](../packages/file/test/dataset.spec.js), [SPARQL](../packages/sparql/test/dataset.spec.js)
and [Neo4j](../packages/neo4j/test/dataset.test.js); real runners are required below.
These are bounded semantic tests, not capacity or vendor-wide certification.

## Storage compatibility and sizing

File storage requires a trusted directory and single-writer coordination. It uses
version-2 keyed graph directories; no fsync/power-loss durability guarantee exists.
Follow [file compatibility procedures](../packages/file/README.md#storage-and-compatibility):
back up, stop writers, and choose a new trusted directory. Legacy/incompatible
storage rejects; there is no automatic migration or deletion.

Neo4j uses its dedicated typed schema, not arbitrary property graphs. Follow
[SCHEMA operator procedures](../packages/neo4j/SCHEMA.md): back up/export, coordinate
writers, and choose a separate database or operator-controlled reset of only owned
storage. Never stamp metadata onto old records or delete unrelated application data.
Per-graph transactions do not make a multi-graph save atomic.

Storage workflows are buffered O(quads + graphs), plus lexical payload bytes and
retained queued snapshots. At 10x size heap/GC and synchronous CPU, file rewrite
I/O, endpoint request limits or Neo4j transaction memory can saturate first.
Bound application input/query breadth and concurrency; await saves. There is no
storage backpressure, automatic chunking or memory cap. Dataset canonicalization
can hit its iteration guard; blank-node containment can be exponential without a
work budget. Use externally bounded workers for large/untrusted local computations.
The Dataset's snapshot streams do not remove these storage limits.

## Verification: offline versus mandatory real acceptance

After `npm ci`, use maintained Node.js 22+ and npm. Offline after installation:

```sh
npm test
npm run test:docs
npm run test:packaging
node --test scripts/conformance-runner.test.js scripts/documentation-contract.test.js
node test/verify-quickstart.js
node test/verify-file-quickstart.js
node test/verify-dataset-memory.js
node test/verify-dataset-file.js
```

Offline HTTP fixtures need loopback access; they are not real backend proof.
Mandatory real cross-adapter acceptance, run serially:

```sh
npm run test:conformance
```

The aggregate runs memory/file suites and public Dataset executables, then owned
real Neo4j and Fuseki runners, both reaching the same independent Dataset fixture.
Docker engine and Compose v2 with `up --wait`, image/archive download access and
free loopback ports 17687/13330 are required. Missing Docker/readiness is a failure,
never a skip or a reason to substitute mocks. Record Node/npm/Docker/server versions,
phase results, zero live skips and owned teardown/removal diagnostics for each run.
Only dispose of the reported fixture Compose project; never prune unrelated resources
or target production endpoints. See [conformance operations](../packages/core/test/CONFORMANCE.md).
Final integrated acceptance is a separate verification step, not established merely
by publishing this guide.
