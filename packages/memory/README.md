# @alt-javascript/jssgdbc-memory

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)

## Local development

Experimental `0.0.0`, local-workspace-only package. Private metadata and a
rejecting prepublish guard protect against accidental publication, not deliberate
bypass (scripts can be disabled). No registry release is supported. Run `npm ci` from the repository
root; package imports below resolve through npm workspaces. See the [root README](../../README.md).

## Usage

Importing this package auto-registers the in-memory driver. Then use `DriverManager.getClient()` to get a client:

<!-- example:memory-quickstart -->
```javascript
import assert from 'node:assert/strict';
import '@alt-javascript/jssgdbc-memory';
import { DriverManager } from '@alt-javascript/jssgdbc-core';
import rdf from '@alt-javascript/jssgdbc-dataset'; // Optional factory
const s = rdf.namedNode('urn:alice'), p = rdf.namedNode('urn:name');
const name = rdf.literal('Alice');

const client = await DriverManager.getClient('jssgdbc:memory:');
const graph = client.getGraph();
let cursor;
try {
  await graph.add(s, p, name);
  await graph.add(s, p, rdf.literal('Alice',
    rdf.namedNode('http://www.w3.org/2001/XMLSchema#string')));
  assert.equal(await graph.count(), 1); // Plain and xsd:string are equivalent.
  assert.equal(await graph.has(s, p, rdf.namedNode('urn:Alice')), false);
  cursor = await graph.find(s, null, null);
  await graph.close();
  await graph.close(); // Idempotent; does not delete data.
  await assert.rejects(() => graph.count(), /closed/i);
  const fresh = client.getGraph();
  assert.notEqual(fresh, graph);
  assert.equal(await fresh.has(s, p, name), true);
  await client.close(); // Owns fresh too; drains admitted operations.
  assert.throws(() => client.getGraph(), /closed/i);
  assert.equal(await cursor.next(), true); // Detached buffered result survives.
  assert(cursor.getTriple().equals(rdf.quad(s, p, name)));
  assert.equal(await cursor.next(), false);
} finally {
  try { await cursor?.close(); }
  finally { await client.close(); }
}
```

## Typed terms and Dataset persistence

Follow the [core typed contract](../core/README.md#typed-terms-and-explicit-datasets).
Memory accepts structural RDF/JS terms from independent factories and returns
immutable Quads. It depends only on core, with no external runtime dependencies.
The optional full Dataset is a caller choice, not an implicit storage binding.

Run `npm run test:dataset-memory` for the [executable workflow](../../test/verify-dataset-memory.js):
independent `@rdfjs/data-model` terms and `@rdfjs/dataset` input, full Dataset
load, lexical distinctions, graph identity, cross-graph blank isomorphism,
explicit saves, empty replacement, preflight and partial-failure outcomes.

Run `npm run test:memory-contract` for S01 acceptance: package safeguards, all
core/memory/Dataset tests, the interoperability workflow, and the unchanged
marked core/memory README examples. This is not repository-wide acceptance.
`npm test` remains unchanged and currently exposes unmigrated root and file
examples; file and remote adapter migrations remain later-slice work. The focused
command does not establish that those adapters pass.

`loadDataset({graphs, factory})` and `saveDataset(dataset, {graphs, mode = 'merge'})`
require explicit nonempty NamedNode/DefaultGraph selections. Replace clears empty
selected graphs. Edits to loaded datasets never persist without save. Every save
freshly scopes blanks across its selected graphs, so blank merges are not idempotent.
Save returns per-graph committed outcomes; `DatasetSaveError.cause/outcomes`
identify committed, unknown and not-attempted graphs. Never blindly retry unknown
writes. See [complete contract and adapter hooks](../core/test/DATASET-PERSISTENCE.md).

Capabilities v1 are recursively immutable: memory is volatile, buffered, and has
no transactions or cross-graph atomicity. Small/medium workloads are intended;
1,000/10,000-quad test diagnostics are not capacity promises. Heap and synchronous
CPU are the first scaling limits; bound inputs and await writes. No backpressure,
timeout or cancellation is provided. A hung adapter hook also blocks close.
File, SPARQL and Neo4j remain migration work, not typed-conformant adapters.

## Resource lifecycle

Await idempotent graph/client closure, including in finally blocks. Close drains
admitted work; it does not cancel it or delete data. An open client can reacquire
a fresh graph handle after awaited close; closed clients are terminal. Cursors
are detached buffered results, remain usable after owner close, and need their
own close. Query results consume O(n) memory; there is no streaming guarantee.
See the [core lifecycle contract](../core/README.md#resource-lifecycle).

## URL Scheme

This driver accepts the `jssgdbc:memory:` URL scheme:

```javascript
const client = await DriverManager.getClient('jssgdbc:memory:');
```

## API Reference

All graph operations are **asynchronous**:

- `await graph.add(subject, predicate, object)` — Insert a triple
- `await graph.remove(subject, predicate, object)` — Delete a triple
- `await graph.find(subject, predicate, object)` — Query triples (returns `Cursor`)
- `await graph.has(subject, predicate, object)` — Check if a triple exists (returns boolean)
- `await graph.count(subject, predicate, object)` — Count matching triples
- `await graph.clear()` — Clear all triples

The following API fragments assume an open `graph` (not standalone programs).
`null`/`undefined` wildcards match any value only in find/has/count/remove, not add:

```javascript
// Find all triples with this subject
const cursor = await graph.find(rdf.namedNode('http://example.org/alice'), null, null);

// Alternative: find all triples (any subject, predicate, object)
const all = await graph.find(null, null, null);
```

## License

MIT License — see LICENSE file for details.
