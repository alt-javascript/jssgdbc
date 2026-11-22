# Explicit Dataset persistence contract

Load selected graphs into a local Dataset, edit it in memory, and save explicitly.
Memory, file, SPARQL and Neo4j clients expose the same API; storage guarantees and
blank-node lookup support depend on the adapter. See
[adapter conformance](CONFORMANCE.md) for checks and limitations.

## Load and save

`await client.loadDataset({ graphs, factory })` returns `factory.dataset(quads)`.
`factory` is a caller-supplied RDF/JS DatasetFactory; core imports no optional
Dataset implementation. The optional
[`@alt-javascript/jssgdbc-dataset`](../../dataset/README.md) factory provides the
full synchronous Dataset API. Factory method identity is captured at admission; the
caller remains responsible for any mutable private state in its factory.

`await client.saveDataset(dataset, { graphs, mode = 'merge' })` accepts a
synchronously iterable RDF/JS Dataset (or iterable of quads). Both methods require
an explicit nonempty array of NamedNode/DefaultGraph terms. Equal graph identities
are deduplicated in first-occurrence order. No implicit all-graphs selection.

Save admission copies every quad, term, literal datatype and graph selection
before any write. Malformed terms, unsupported features, invalid modes and quads
outside the selection reject before writes; iterator/getter failures propagate.
A valid prefix is never persisted after a later validation failure. No string
terms, variables, nested quads or blank-node graph names are accepted.

Merge adds exact ground quads with set semantics. Replace clears **every** selected
graph, including those with no input quads; unrelated graphs are unchanged. Memory
retains store array identity, so existing graph handles observe the replacement.
Loaded datasets are detached local values: add/delete/edit never persist implicitly.

## Blank nodes

Each save allocates a fresh blank-node scope shared across all selected
graphs. Memory scans existing stores to avoid existing labels and uses a monotonically
increasing allocator across saves. Input terms are never relabeled in place. Compare
round trips by isomorphism, not labels. Repeated merges containing blank nodes are
**not idempotent**; they add fresh nodes, including when saving a previously loaded
dataset. Replace selected graphs for a structural replacement; this does not preserve
blank-node identity with unselected graphs. Labels are scoped identities, not global IDs.

## Outcomes and failures

Successful save resolves to a frozen array of frozen `{ graph, status: 'committed' }`
records, ordered by the deduplicated selection. Execution failure rejects with
exported `DatasetSaveError`, preserving the original `cause` and frozen `outcomes`:

- `committed`: acknowledged success (including a successful no-op);
- `unknown`: dispatched work may have changed that graph without acknowledged success;
- `not-attempted`: no work affecting that graph has been dispatched.

Scope preparation failure leaves all outcomes not-attempted. No automatic retries,
rollback, cross-graph atomicity or transaction isolation are promised. Never blindly
retry an unknown blank-node merge. Inspect/reload affected graphs first. Load adapter
and factory errors propagate directly. Preflight errors are not DatasetSaveError.

## Implementing an adapter

Adapters implement `_loadDatasetGraph(graph)` (iterable or promise of iterable),
`_scopeDataset(quads)` (synchronous fresh-scope preparation), and
`_saveDatasetGraph(graph, quads, mode)` (sync or async). Resolve the save hook only
once that graph is committed; a rejection is conservatively unknown. Default hooks
reject unsupported operations. Hooks consume admitted detached immutable terms and
must not reenter public methods during client close or await their client's close.

Batch adapters override `_loadSelectedDataset(graphs)` and
`_saveSelectedDataset(graphs, quads, mode, progress)`. The default implementations
orchestrate the per-graph hooks above, retaining partial fallback outcomes even if
an adapter throws its own DatasetSaveError. Core still owns admission, complete
preflight snapshots, selection deduplication, one `_scopeDataset` call per save,
queueing, outcome records and error wrapping. Selection and quad arrays are frozen;
terms are detached and immutable. Scope output and load output are validated for
quad shape, term positions and selected graph membership before use. The fallback
additionally requires each load result to match its individual requested graph.

A batch load returns an iterable (or promise thereof) covering only the selections.
Its adapter must preserve a single response-local blank map across graphs; core
validation preserves labels but does not infer identity across separate responses.
A batch save prepares/serializes before calling `progress.dispatched()` immediately
before the first potentially mutating dispatch. This marks all selections unknown;
pass an array subset to mark only possibly affected graphs. Failures before dispatch
leave selections not-attempted. Resolve only on acknowledged success: core then
marks all selections committed. For sequential acknowledged portions, use
`progress.committed(subset)` before proceeding. These callbacks update core-owned
records, reject unselected graphs and expire when the hook settles. Committed
records remain committed; do not redispatch already committed selections within
one operation. Adapters must sanitize transport causes before throwing them; core
preserves causes and never retries or claims atomicity.

Both modes reach the hook even with no quads. Empty merge may resolve without
transport; empty replace must clear every selected graph. Internal transport used
by these hooks must accept already-admitted work during close drain, rather than
performing another public closed check. Cleanup runs only after hooks settle.

## Queueing and close

Dataset operations are serialized per client in admission order. Graph operations
are not serialized with Dataset operations: callers must coordinate concurrent
Graph edits themselves. Loads are buffered, not transactional cross-graph snapshots.
Close immediately rejects new work and drains admitted Dataset operations before
owned-handle cleanup and adapter release, even after failure. Failed work does not
poison the queue or turn an operation failure into a cleanup failure.

## Load profile and limits

This API buffers selected datasets in process; it does not stream them. Admission, scoping, graph grouping
and factory construction retain multiple O(N + G) buffers for N quads and G selected
graphs; each queued save retains its
snapshot. Memory scoping scans stored quads O(S), and merge uses temporary identity
sets O(S + N) instead of quadratic repeated Graph.add scans. The first scaling
limits are heap and event-loop blocking, not network throughput. Serial execution
limits active writes to one Dataset operation, **not** queued snapshot memory.
There is no size cap, backpressure, cancellation, timeout, or streaming guarantee;
callers must bound datasets and await writes instead of unbounded concurrent admission.
An adapter hook that never settles also prevents close from settling.

The [memory Dataset tests](../../memory/test/dataset.spec.js) exercise 1,000 and 10,000 ground quads with
two saves and one load and prints elapsed time/process heap as diagnostics, not an
SLA or a proven capacity ceiling. Core tests cover unsupported adapters, rejected
async writes and cleanup ordering; memory tests cover round trips, validation,
scoping, partial failures, pending mutation and no implicit persistence.
