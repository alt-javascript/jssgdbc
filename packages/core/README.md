# @alt-javascript/jssgdbc-core

The shared async API for JSSGDBC RDF storage drivers. Core provides driver
registration, Client and Graph base classes, typed result cursors, RDF term helpers
and capability descriptors. It does not provide a storage backend.

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)

## Installation

Experimental, local-workspace-only software with no supported registry release.
Use Node.js 22 or later and run `npm ci` from the repository root. The imports below
resolve through npm workspaces; see the [installation guide](../../README.md#installation).

## Interfaces

| Interface | Purpose |
|-----------|---------|
| **DriverManager** | Registers drivers and connects through the first driver that accepts a URL. |
| **Driver** | Base class defining `acceptsURL(url)` and `connect(url, properties)`. |
| **Client** | Owns Graph handles, exposes capabilities and loads/saves selected graphs as Datasets. |
| **ClientDataSource** | Creates Clients from a stored URL and connection properties. |
| **Graph** | Adds, removes and matches triples in one named or default graph. |
| **Cursor** | Reads buffered typed quads through `next()` or async iteration. |

## Quick start

<!-- example:core-quickstart -->
```js
import { DriverManager } from '@alt-javascript/jssgdbc-core';
import { MemoryDriver } from '@alt-javascript/jssgdbc-memory';
import { DataFactory } from 'n3';
const { namedNode, literal } = DataFactory;
DriverManager.registerDriver(new MemoryDriver());
const client = await DriverManager.getClient('jssgdbc:memory:');
try {
  const graph = client.getGraph(namedNode('http://example.org/people'));
  await graph.add(namedNode('http://example.org/alice'), namedNode('http://example.org/name'), literal('Alice', 'en'));
  const cursor = await graph.find(null, namedNode('http://example.org/name'), null);
  try {
    for await (const quad of cursor) console.log(quad.object.value); // Alice
  } finally { cursor.close(); }
} finally { await client.close(); }
```
<!-- /example:core-quickstart -->

## Driver registration

`DriverManager` has a process-wide ordered registry. Importing a built-in driver
package registers a driver; importing core alone does not. After `clear()`, register
a fresh driver explicitly: re-importing a cached module does not register it again.

| Static method | Behavior |
|---------------|----------|
| `registerDriver(driver)` | Appends a driver to the registry. |
| `deregisterDriver(driver)` | Removes the first occurrence of that driver instance. |
| `getDrivers()` | Returns a copy of the registry array. |
| `clear()` | Removes all registrations without closing existing clients. |
| `getClient(url, properties)` | Returns a Promise for a Client from the first accepting driver. Rejects if no driver accepts the URL. |

Connection properties are driver-specific. Construct a data source with
`new ClientDataSource(url, properties)`; each async `getClient()` call delegates to
`DriverManager.getClient()` without caching. Close each returned client when done.

## Typed terms and explicit Datasets

Public Graph operations accept RDF/JS terms from independent factories such as
`n3` or `@rdfjs/data-model`. Core validates and snapshots them into immutable terms;
callers do not need to construct core-specific classes.

| Position | Accepted typed terms |
|----------|----------------------|
| Subject | `NamedNode`, `BlankNode` |
| Predicate | `NamedNode` |
| Object | `NamedNode`, `BlankNode`, `Literal` |
| Graph name | `NamedNode`, `DefaultGraph` |

Named nodes and datatypes must use absolute IRIs. Literal lexical values and
datatypes are preserved; language tags must already be lowercase. Equality is
exact RDF term identity, not datatype value equivalence. Variables, RDF-star terms,
directional literals and blank-node graph names are unsupported by the persistence
API.

Public Graph methods and `snapshotTerm()` reject string inputs. Use typed terms
such as `namedNode('https://example.org/alice')` and `literal('Alice')` instead.
Cursor rows also contain typed terms.

## Graph operations

`client.getGraph(name)` synchronously returns a cached Graph handle for a typed
graph name. Omit the name to select `DefaultGraph`; it is not a union of named
graphs. Requesting the same graph after its handle is closed creates a new handle.
Graph selection alone does not guarantee that a backend graph has been created.

| Async method | Behavior |
|--------------|----------|
| `add(subject, predicate, object)` | Adds a triple; all three terms are required. Duplicate triples have set semantics in current drivers. |
| `remove(subject, predicate, object)` | Removes matching triples. |
| `find(subject, predicate, object)` | Returns a buffered `Cursor` of matching typed quads. Each row includes the selected graph term. |
| `count(subject, predicate, object)` | Returns the number of matching triples. |
| `has(subject, predicate, object)` | Returns whether any triple matches. |
| `clear()` | Removes all triples from this graph. |
| `close()` | Closes the handle without deleting stored data. |

For matching methods, `null` or an omitted argument is a wildcard. For example,
`count()` counts the whole graph and `remove()` removes all its triples.
`getName()` returns the immutable graph term; `isClosed()` reports handle state.

Blank-node behavior is backend-specific. SPARQL blank nodes are scoped to insert
requests and result responses; blank-node identity patterns for query/delete are
unsupported. Memory, file and Neo4j Dataset saves freshen blank labels across each saved
Dataset while retaining relationships within that save.

## Cursor results

`Graph.find()` returns rows with `subject`, `predicate`, `object` and `graph` terms.
Current drivers materialize results before returning the cursor: async iteration
is an access pattern, not a streaming or backpressure guarantee.

| Method | Behavior |
|--------|----------|
| `await next()` | Advances to the next row and returns whether one is available. |
| `getTriple()` | Returns the current row; throws before the first successful `next()` or after exhaustion. |
| `getTriples()` | Returns copies of all buffered rows, not only unread rows. |
| `close()` | Synchronously marks the cursor closed; safe to repeat. |
| `isClosed()` | Returns whether the cursor is closed. |

`for await...of` uses `next()` and `getTriple()`. Iteration does not automatically
close the cursor, including on early exit. Use `try/finally` as in the quick start.

## Dataset persistence

Core accepts a caller-supplied RDF/JS-compatible Dataset factory; it does not depend
on `@alt-javascript/jssgdbc-dataset`. Loading produces a detached local Dataset.
Edits affect storage only after an explicit save.

<!-- example:core-dataset-persistence -->
```js
import { DriverManager } from '@alt-javascript/jssgdbc-core';
import { MemoryDriver } from '@alt-javascript/jssgdbc-memory';
import rdf from '@rdfjs/data-model';
import datasetFactory from '@rdfjs/dataset';
DriverManager.registerDriver(new MemoryDriver());
const client = await DriverManager.getClient('jssgdbc:memory:');
try {
  const graphs = [rdf.defaultGraph(), rdf.namedNode('https://example.org/people')];
  const dataset = await client.loadDataset({ graphs, factory: datasetFactory });
  dataset.add(rdf.quad(rdf.namedNode('https://example.org/alice'), rdf.namedNode('https://example.org/name'),
    rdf.literal('Alice', 'en'), graphs[1]));
  await client.saveDataset(dataset, { graphs, mode: 'replace' });
  console.log(client.getCapabilities().version); // 1
} finally { await client.close(); }
```
<!-- /example:core-dataset-persistence -->

### `loadDataset({ graphs, factory })`

- `graphs` must be a non-empty array of typed `NamedNode` or `DefaultGraph`
  terms. Duplicate graph selections are collapsed.
- `factory` must have a `dataset(quads)` method. It receives an array of typed
  quads; its return value becomes the result of `loadDataset()`.
- Only selected graphs are loaded. The operation is buffered and does not promise
  a cross-graph snapshot under concurrent writes.

### `saveDataset(dataset, { graphs, mode })`

- `dataset` must be a synchronous iterable of RDF/JS quads.
- `graphs` has the same explicit selection rules as loading.
- `mode` defaults to `merge`, which adds quads; `replace` replaces every selected graph.
  A selected graph with no input quads is cleared in replace mode.
- Input terms, graph membership and mode are validated before writes begin. A
  quad outside the selection is rejected rather than silently ignored.

Successful saves return a frozen array of `{ graph, status: 'committed' }`
records. Here, `committed` means the graph operation completed, not that the
backend guarantees durable storage.

Memory, file and Neo4j write selected graphs sequentially. SPARQL sends the whole
selection in one update request, without guaranteeing endpoint atomicity.
On failure, `DatasetSaveError`
contains the original `cause` and an `outcomes` array with each graph's status:

| Status | Meaning |
|--------|---------|
| `committed` | The graph operation completed before the failure. |
| `unknown` | The failed graph may have been partially changed. |
| `not-attempted` | The graph was not reached. |

Neo4j uses a transaction per graph, not one transaction for the whole selection.
A SPARQL failure after request dispatch reports all selected graphs as `unknown`;
a failure before dispatch leaves them `not-attempted`.
Inspect the error and reload relevant graphs before deciding whether to retry. An automatic retry is not universally
safe: saves that freshen blank nodes can create new identities.

## Capabilities

`client.getCapabilities()` returns a frozen version-1 descriptor:
`{ version: 1, features }`. Each feature has a `status` and an optional `detail` string.

| Status | Meaning |
|--------|---------|
| `supported` | Inherent support. |
| `configured` | Enabled through configuration. |
| `unavailable` | Known to be absent. |
| `unknown` | No guarantee; do not assume support. |

Feature keys are `rdf11`, `namedGraphs`, `defaultGraph`, `blankNodeGraphs`,
`rdfStar`, `variables`, `persistence`, `transactions`, `crossGraphAtomicity`,
`streaming` and `duplicateQuads`. Read the detail text as well as the status:
`rdf11` support does not imply support for every possible graph name or extension.

`CAPABILITY_KEYS` exports the frozen key list. `createCapabilities(entries)`
validates entries and builds a frozen descriptor; omitted features default to
`unknown`. Base `Client` instances make no optimistic capability claims.

## Resource lifecycle

- Await `graph.close()` and `client.close()`. Closing is idempotent, and repeated
  calls return the same completion Promise.
- Closing marks the handle closed immediately, rejects new operations and waits
  for admitted work. Client closure also closes owned Graph handles and releases
  backend resources. It does not close cursors already returned to callers.
- Use `graph.clear()` to delete triples from an explicit graph. The Client API
  does not expose a store-wide `clear()` operation.
- `UnsupportedOperationError` indicates an unimplemented operation.
  `UnsupportedRdfFeatureError` extends it with `feature` and `position` fields.
- Invalid terms and Dataset options raise `TypeError`. Operations on closed
  handles reject with an error. Dataset write failures use `DatasetSaveError`
  as described above.

## RDF helpers

| Export | Purpose |
|--------|---------|
| `snapshotTerm(input, position = 'object')` | Validates and copies a typed term into an immutable RDF term. |
| `defaultGraph()` | Returns the immutable default-graph term. |
| `createQuad(subject, predicate, object, graph)` | Builds an immutable quad with positional validation; omitted graph defaults to `DefaultGraph`. |
| `termKey(term)` | Produces an exact-identity key from term type, value and literal metadata. |
| `XSD_STRING`, `RDF_LANG_STRING` | Export the string and language-string datatype IRIs. |

## Implementing a driver

Extend `Driver` with `acceptsURL()` and async `connect()`. Extend `Client` with
`_getGraph(name)`, and implement the Graph hooks needed by the backend:
`_add()`, `_remove()`, `_find()`, `_has()`, `_count()` and `_clear()`. The base
class does not supply fallback implementations for counting or existence checks.

Public Graph methods handle term validation and lifecycle checks before invoking
hooks. Unimplemented storage operations throw `UnsupportedOperationError`, rather
than silently succeeding. `_close()` is a no-op unless overridden.

The package exports a reusable driver compliance harness at
`@alt-javascript/jssgdbc-core/test/driverCompliance.js`. See the
[conformance guide](test/CONFORMANCE.md) for additional typed-term, lifecycle and
Dataset checks and execution instructions.
