# @alt-javascript/jssgdbc-core

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)

## Local development

Experimental `0.0.0`, local-workspace-only package. Private metadata and a
rejecting prepublish guard protect against accidental publication, not deliberate
bypass (scripts can be disabled). No registry release is supported. Run `npm ci` from the repository
root; package imports below resolve through npm workspaces. See the [root README](../../README.md).

## Interfaces

| Interface | Purpose |
|-----------|---------|
| **Driver** | Base class for triple-store drivers. Implements `acceptsURL(url)` to test if a URL scheme is supported, and `connect(url, properties)` to create a client connection. |
| **DriverManager** | Static registry and URL dispatcher. Call `registerDriver(driver)` to register implementations, and `getClient(url, properties)` to retrieve a client by URL scheme. |
| **Client** | Connection to a triple-store backend. Call `getGraph(name)` to access named graphs (default graph if name is omitted). |
| **Graph** | Async triple CRUD operations. Methods: `add(subject, predicate, object)`, `remove(subject, predicate, object)`, `find(subject, predicate, object)`, `has(subject, predicate, object)`, `count(subject, predicate, object)`, `clear()`. Wildcard parameters (null) in `find()` match any value. |
| **Cursor** | Forward-only async iterator over buffered triple results; not a streaming cursor. Call `next()` to advance, `getTriple()` to fetch the current triple. Implements async iteration: `for await (const triple of cursor) { ... }`. |
| **UnsupportedOperationError** | Thrown by hook methods that are not implemented in a driver. |
| **ClientDataSource** | Factory wrapper for creating clients from URLs and properties. |

## Usage

This package defines abstract interfaces. Concrete drivers are provided by separate packages (e.g., `@alt-javascript/jssgdbc-memory`). To use jssgdbc:

1. Set up this local workspace with a concrete driver package
2. Import the driver (which auto-registers itself)
3. Use `DriverManager.getClient()` to get a client

<!-- example:core-quickstart -->
```javascript
import assert from 'node:assert/strict';
import '@alt-javascript/jssgdbc-memory';  // Auto-registers
import { DriverManager } from '@alt-javascript/jssgdbc-core';

const client = await DriverManager.getClient('jssgdbc:memory:');
try {
  const graph = client.getGraph();
  assert.equal(await graph.count(), 0);
} finally {
  await client.close();
}
assert.throws(() => client.getGraph(), /closed/i);
```

## Typed terms and explicit Datasets

Core and memory accept structural RDF/JS terms, not strings. Use maintained
Node.js 22+. Subject: NamedNode/BlankNode; predicate: NamedNode; object:
NamedNode/BlankNode/Literal. `getGraph()` selects DefaultGraph;
`getGraph(graphTerm)` accepts NamedNode or DefaultGraph (not null/string).
Equal external terms select the same open handle. Literal lexical values,
lowercase language and datatype identity are preserved, without numeric coercion.
Variables, nested quads, directional literals and blank graph names raise
`UnsupportedRdfFeatureError` with `feature` and `position`; malformed terms raise
TypeError before I/O. See [full typed profile](test/TYPED-TERMS.md).

`add(s,p,o)` requires bound terms. `find/remove/has/count(s?,p?,o?)` accept only
null/undefined wildcards. Memory `find` returns a buffered Cursor whose
`getTriple/getTriples` and async iterator yield immutable RDF/JS Quads, including
`graph`, not string triples. Duplicate quads are no-ops. `clear()` is graph-local.

- `await client.loadDataset({graphs, factory})` returns `factory.dataset(quads)`.
- `await client.saveDataset(dataset, {graphs, mode = 'merge'})` accepts a synchronous
  quad iterable. Both require a nonempty graph-term array; duplicates collapse.
- Save snapshots and validates the entire input before writes, rejecting quads
  outside the selection. Replace clears even empty selected graphs, never others.
- Loaded Datasets are local: edits never persist implicitly. Each save scopes blanks
  freshly across selected graphs. Compare by isomorphism; blank merges are NOT
  idempotent and replacement cannot preserve links to unselected graphs.
- Success returns frozen `{graph, status: 'committed'}` records. Execution errors
  are `DatasetSaveError` with original `cause` and ordered `outcomes`: committed,
  unknown (invoked, may have written), or not-attempted. Preflight errors propagate
  directly. No automatic retries, rollback or cross-graph transaction guarantee.

`getCapabilities()` returns recursively frozen `{version: 1, features}`;
each feature has `status` supported/configured/unavailable/unknown and optional
`detail`. Unknown is not support. Memory is volatile, buffered and nontransactional.
See [persistence signatures, hooks, failure and load contract](test/DATASET-PERSISTENCE.md).
Core/memory have no external runtime dependencies; callers supply a Dataset factory.

## Resource lifecycle

Always await `graph.close()` and `client.close()`, including in `finally` blocks.
Closing marks a handle terminal immediately: new graph operations reject, and a
closed client rejects `getGraph()`. Client close owns and closes all its graphs.
Close drains already admitted operations, including adapter session cleanup,
before releasing resources; it does **not** cancel requests or transactions.

On an open client, await a graph's close before calling `getGraph(name)` again.
The returned handle is fresh and existing backend data is retained. Closing a
graph or client does not delete data; use explicit mutation operations for that.
A closed client cannot reconnect; acquire another client instead.

Repeated close calls return the same promise and the same success or failure.
Client shutdown attempts every owned graph cleanup and its own release even if
cleanup fails, surfacing failures in `AggregateError.errors`. Repeating close is
not a cleanup retry. Handle rejected close promises rather than ignoring them.

Cursors are detached, buffered results: they remain usable after graph/client
closure and do not reflect later mutations. Close cursors separately when done.
Buffering consumes memory proportional to result size; this is not a streaming
or cancellation guarantee.

## Compliance Testing

**Migration boundary:** file, SPARQL and Neo4j still need typed terms, graph
identity, Dataset hooks and capabilities migration. Their legacy tests are not
typed conformance evidence; no failures are skipped or reclassified here.
Run `npm run test:dataset-memory` for the independent-factory memory workflow.
`datasetCompliance(client, independentDataFactory, independentDatasetFactory,
fullDatasetFactory)` is an async destructive fixture exported from
`test/driverCompliance.js`; supply fresh disposable storage. It closes the client.
`typedGraphComplianceTests(name, clientFactory)` is the typed Graph Mocha seam.

The following **legacy string-only** API fragment is retained for migration
(requires your `MyDriver` implementation and a Mocha context):
implement the `Driver` interface and validate it against the compliance harness:

```javascript
import driverComplianceTests from '@alt-javascript/jssgdbc-core/test/driverCompliance.js';

const myDriver = new MyDriver();
const clientFactory = async () => {
  return await myDriver.connect('jssgdbc:my-driver:', {});
};

// Register tests inside a Mocha suite; this function is not an async runner.
driverComplianceTests('My driver', clientFactory);
```

## License

MIT License — see LICENSE file for details.
