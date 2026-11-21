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

const client = await DriverManager.getClient('jssgdbc:memory:');
const graph = client.getGraph();
let cursor;
try {
  await graph.add('urn:alice', 'urn:name', '"Alice"');
  await graph.add('<urn:alice>', 'urn:name',
    '"Alice"^^<http://www.w3.org/2001/XMLSchema#string>');
  assert.equal(await graph.count(), 1); // Plain and xsd:string are equivalent.
  assert.equal(await graph.has('urn:alice', 'urn:name', 'urn:Alice'), false);
  cursor = await graph.find('urn:alice', null, null);
  await graph.close();
  await graph.close(); // Idempotent; does not delete data.
  await assert.rejects(() => graph.count(), /closed/i);
  const fresh = client.getGraph();
  assert.notEqual(fresh, graph);
  assert.equal(await fresh.has('urn:alice', 'urn:name', '"Alice"'), true);
  await client.close(); // Owns fresh too; drains admitted operations.
  assert.throws(() => client.getGraph(), /closed/i);
  assert.equal(await cursor.next(), true); // Detached buffered result survives.
  assert.deepEqual(cursor.getTriple(), {
    subject: 'urn:alice', predicate: 'urn:name', object: '"Alice"'
  });
  assert.equal(await cursor.next(), false);
} finally {
  try { await cursor?.close(); }
  finally { await client.close(); }
}
```

## String terms

Follow the [core string-term contract](../core/README.md#string-terms): absolute
IRIs, quoted literal objects, lowercase language tags and canonical plain
xsd:string literals. Results retain literal quotes and typed lexical values.
Blank-node labels are graph-scoped, not globally portable. Validation uses
dependency-free core code; memory depends only on the core workspace, with no
external runtime dependencies.

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
const cursor = await graph.find('http://example.org/alice', null, null);

// Alternative: find all triples (any subject, predicate, object)
const all = await graph.find(null, null, null);
```

## License

MIT License — see LICENSE file for details.
