# Explicit Dataset persistence contract

`await client.loadDataset({ graphs, factory })` returns `factory.dataset(quads)`.
`factory` is a caller-supplied RDF/JS DatasetFactory; core imports no optional
Dataset implementation. The optional `packages/dataset` factory provides the full
synchronous Dataset API. Factory method identity is captured at admission; the
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

Each save allocates a fresh client-local blank-node scope shared across all selected
graphs. Memory scans existing stores to avoid existing labels and uses a monotonically
increasing allocator across saves. Input terms are never relabeled in place. Compare
round trips by isomorphism, not labels. Repeated merges containing blank nodes are
**not idempotent**; they add fresh nodes, including when saving a previously loaded
dataset. Replace selected graphs for a structural replacement; this does not preserve
blank-node identity with unselected graphs. Labels are client-local, not global IDs.

## Outcomes and failures

Successful save resolves to a frozen array of frozen `{ graph, status: 'committed' }`
records, ordered by the deduplicated selection. Execution failure rejects with
exported `DatasetSaveError`, preserving the original `cause` and frozen `outcomes`:

- `committed`: that graph's hook resolved successfully;
- `unknown`: that graph's hook was invoked but failed; it may have changed storage;
- `not-attempted`: that graph's hook has not been invoked.

Scope preparation failure leaves all outcomes not-attempted. No automatic retries,
rollback, cross-graph atomicity or transaction isolation are promised. Never blindly
retry an unknown blank-node merge. Inspect/reload affected graphs first. Load adapter
and factory errors propagate directly. Preflight errors are not DatasetSaveError.

## Adapter and lifecycle seams

Adapters implement `_loadDatasetGraph(graph)` (iterable or promise of iterable),
`_scopeDataset(quads)` (synchronous fresh-scope preparation), and
`_saveDatasetGraph(graph, quads, mode)` (sync or async). Resolve the save hook only
once that graph is committed; a rejection is conservatively unknown. Default hooks
reject unsupported operations. Hooks consume admitted detached immutable terms and
must not reenter public methods during client close or await their client's close.

Dataset operations are serialized per client in admission order. Graph operations
are not serialized with Dataset operations: callers must coordinate concurrent
Graph edits themselves. Loads are buffered, not transactional cross-graph snapshots.
Close immediately rejects new work and drains admitted Dataset operations before
owned-handle cleanup and adapter release, even after failure. Failed work does not
poison the queue or turn an operation failure into a cleanup failure.

## Load profile and limits

This is a small/medium, in-process buffered API. Admission, scoping, graph grouping
and factory construction retain multiple O(N) copies; each queued save retains its
snapshot. Memory scoping scans stored quads O(S), and merge uses temporary identity
sets O(S + N) instead of quadratic repeated Graph.add scans. The first scaling
limits are heap and event-loop blocking, not network throughput. Serial execution
limits active writes to one Dataset operation, **not** queued snapshot memory.
There is no size cap, backpressure, cancellation, timeout, or streaming guarantee;
callers must bound datasets and await writes instead of unbounded concurrent admission.
An adapter hook that never settles also prevents close from settling.

`packages/memory/test/dataset.spec.js` exercises 1,000 and 10,000 ground quads with
two saves and one load and prints elapsed time/process heap as diagnostics, not an
SLA or a proven capacity ceiling. Core tests cover unsupported adapters, rejected
async writes and cleanup ordering; memory tests cover round trips, validation,
scoping, partial failures, pending mutation and no implicit persistence.
