# JSSGDBC — JavaScript Semantic Graph Database Connectivity

A uniform, async API for RDF triple storage in JavaScript. Write code against
`DriverManager → Client → Graph → Cursor`, then choose an in-memory, file,
SPARQL HTTP or Neo4j Bolt driver.

**Experimental, pre-publication software.** There is no supported registry release.
Use the local workspace; package versions do not imply API stability or production
readiness.

## Features

- **One Graph API** — add, remove, find, count and test triples, with wildcard matching.
- **Typed RDF terms** — accept RDF/JS terms and return typed quads, preserving literal
  lexical values, language tags and datatypes.
- **Named and default graphs** — select graphs with RDF/JS `NamedNode` or
  `DefaultGraph` terms.
- **Async cursors** — iterate query results with `for await...of` or `next()`.
  Current drivers buffer results; async iteration does not imply streaming I/O.
- **Explicit Dataset persistence** — load selected graphs into a caller-supplied
  Dataset and save them with merge or replace semantics.
- **Capability discovery** — inspect each client's supported features and limitations.
- **Optional local Dataset operations** — use `@alt-javascript/jssgdbc-dataset` for
  matching, set operations, blank-node-aware equality and canonical N-Quads.

The Graph API is an RDF storage facade, not a general SPARQL or Cypher query API.
Backend durability, transaction guarantees and blank-node identity differ.

## Installation

Use Node.js **22 or later**. Clone this repository and install its npm workspaces:

```bash
git clone https://github.com/alt-javascript/jssgdbc.git
cd jssgdbc
npm ci
```

Run the examples from the repository root so package imports resolve through the
local workspaces. No `npm install @alt-javascript/jssgdbc-*` registry workflow is
supported. Packages are private and have a rejecting prepublish guard; these are
accidental-publication safeguards, not a security boundary against bypassing scripts.

## Quick start

<!-- example:memory-quickstart -->
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
    for await (const quad of cursor) {
      console.log(quad.object.value, quad.object.language); // Alice en
    }
  } finally {
    cursor.close();
  }
  console.log(await graph.count()); // 1
} finally {
  await client.close();
}
```
<!-- /example:memory-quickstart -->

Each memory client owns an isolated store. `getGraph()` without a name selects the
RDF default graph; it does not combine named graphs. Closing a client closes its
Graph handles, but callers must close their cursors separately.

## Drivers

Importing a built-in driver package registers it. You can also register a driver
explicitly with `DriverManager.registerDriver()`, including after clearing the
registry. `DriverManager.getClient(url, properties)` uses the first registered
driver whose `acceptsURL(url)` returns `true`.

| Driver | URL | Storage and limitations |
|--------|-----|-------------------------|
| [Memory](packages/memory/README.md) | `jssgdbc:memory:` | Client-local volatile storage; no transactions or cross-graph atomicity. |
| [File](packages/file/README.md) | `jssgdbc:file:./data` | One N-Triples file per graph; whole-graph buffered I/O; no multiwriter isolation, fsync or cross-graph atomicity guarantee. |
| [SPARQL](packages/sparql/README.md) | `jssgdbc:sparql:https://host/sparql` | SPARQL HTTP query/update; blank-node identity is request/response-local; persistence and transaction behavior depend on the endpoint. |
| [Neo4j](packages/neo4j/README.md) | `jssgdbc:neo4j:bolt://localhost:7687` | Versioned RDF storage over Bolt; a transaction per selected graph during Dataset saves; blank-node labels are freshened on each save. |

See each driver guide for connection properties, storage behavior and error handling.
All four drivers support typed Graph CRUD and selected Dataset load/save. None
supports RDF-star, variable terms or blank-node graph names through the persistence
API. Check `client.getCapabilities()` rather than assuming identical behavior.

## Working with RDF terms

Graph methods accept RDF/JS terms, including terms created by `n3` or
`@rdfjs/data-model`. Subjects can be named or blank nodes, predicates must be named
nodes, and objects can also be literals. Graph names must be named nodes or the
default graph.

`find()`, `count()`, `has()` and `remove()` accept `null` or omitted arguments as
wildcards. Matching uses exact term identity, not datatype value equivalence:
`"01"^^xsd:integer` and `"1"^^xsd:integer` remain distinct.

Public Graph methods require typed terms, not string tokens. Create IRIs with
`namedNode()` and literal values with `literal()`. Language tags must be lowercase;
nonconforming terms are rejected rather than silently rewritten.

See the [core API reference](packages/core/README.md) for method signatures,
capabilities and lifecycle behavior.

## Load, edit and save a Dataset

Dataset loading and saving is explicit. Editing a loaded Dataset does not update
storage until you call `saveDataset()`.

<!-- example:root-dataset-persistence -->
```js
import { DriverManager } from '@alt-javascript/jssgdbc-core';
import { MemoryDriver } from '@alt-javascript/jssgdbc-memory';
import datasetFactory from '@rdfjs/dataset';
import { DataFactory } from 'n3';
const { namedNode, defaultGraph, literal, quad } = DataFactory;
DriverManager.registerDriver(new MemoryDriver());
const client = await DriverManager.getClient('jssgdbc:memory:');
try {
  const selection = [defaultGraph(), namedNode('https://example.org/people')];
  const local = await client.loadDataset({ graphs: selection, factory: datasetFactory });
  local.add(quad(namedNode('https://example.org/alice'), namedNode('https://example.org/name'),
    literal('Alice'), selection[1]));
  await client.saveDataset(local, { graphs: selection, mode: 'replace' });
  console.log(client.getCapabilities().features.crossGraphAtomicity.status); // unavailable
} finally { await client.close(); }
```
<!-- /example:root-dataset-persistence -->

Both operations require a non-empty `graphs` array. `merge` adds quads;
`replace` replaces every selected graph, including clearing selected graphs that
have no input quads. A quad outside the selection is rejected before writing.
Memory, file and Neo4j save graph by graph. SPARQL sends one update request for the
selection, but does not guarantee endpoint atomicity.
See the [core reference](packages/core/README.md#dataset-persistence) for save
results and partial-failure handling.

### Optional local Dataset operations

`@alt-javascript/jssgdbc-dataset` is an optional in-memory RDF/JS Dataset facade.
Core and driver packages do not depend on it. It supplies `union`, `intersection`,
`difference`, `contains`, `equals`, `toCanonical` and other local operations; these
do not translate into backend queries.

<!-- example:root-dataset -->
```js
import { dataset } from '@alt-javascript/jssgdbc-dataset';
import { DataFactory } from 'n3';
const { namedNode, literal, quad } = DataFactory;
const q = quad(namedNode('https://example.org/alice'), namedNode('https://example.org/name'), literal('Alice'));
const left = dataset([q]);
const right = dataset([q]);
console.log(left.union(right).size); // 1
console.log(left.equals(right)); // true (blank-node labels are compared isomorphically)
console.log(left.toCanonical()); // canonical N-Quads string
```
<!-- /example:root-dataset -->

See the [Dataset guide](packages/dataset/README.md) for its API and canonicalization
limits. Unlike the persistence API, the local facade accepts blank-node graph names.

## Verification

```bash
npm test                      # local tests and README checks; no remote servers
npm run test:docs              # executable README examples
npm run test:memory-contract   # focused memory, core and Dataset checks
npm run test:conformance       # all adapters, including real remote services
```

The conformance command requires Docker Compose to start disposable SPARQL and
Neo4j services, or explicitly configured external test services. A missing service
is a failure, not a skipped check. See the
[conformance guide](packages/core/test/CONFORMANCE.md) for configuration.

## License

[MIT](LICENSE)
