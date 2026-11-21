# @alt-javascript/jssgdbc-file

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)

## Local development

Experimental, pre-publication workspace package. Run `npm ci` from the repository
root; package imports below resolve through npm workspaces. See the [root README](../../README.md).

## Usage

Importing this package auto-registers the file-based driver. Then use `DriverManager.getClient()` to get a client:

```javascript
import '@alt-javascript/jssgdbc-file';
import { DriverManager } from '@alt-javascript/jssgdbc-core';

// Get a client for the file-based triple store
const client = await DriverManager.getClient('jssgdbc:file:/tmp/mytriples');

// Get the default graph
const graph = client.getGraph();

// Add a triple (async)
await graph.add(
  '<http://example.org/alice>',
  '<http://xmlns.com/foaf/0.1/name>',
  '"Alice"'
);

// Find triples (async, returns a Cursor)
const cursor = await graph.find(null, null, null);
for await (const triple of cursor) {
  console.log(triple);
}

// Remove a triple (async)
await graph.remove(
  '<http://example.org/alice>',
  '<http://xmlns.com/foaf/0.1/name>',
  '"Alice"'
);
```

## String terms and persistence

Graph methods follow the [core string-term contract](../core/README.md#string-terms).
Both `urn:s` and `<urn:s>` identify the same IRI; graph results use `urn:s`.
Literal results retain double quotes and supported language/datatype suffixes.
Escapes canonicalize without changing lexical content; language tags lowercase
and xsd:string becomes a plain quoted literal. Blank labels survive a local
close/reopen but are not identifiers portable across separate imports/datasets.

The standalone NTriplesParser/Serializer utilities retain N-Triples surface
syntax, including IRI brackets. N3 is confined to this file workspace; malformed
N-Triples rejects with line or triple/position context. File I/O errors propagate.
Files are eagerly rewritten on mutation using atomic replacement. Failed
serialization, writes or replacement leave the previous payload and in-memory
state intact; this is not a multi-operation transaction.

## URL Scheme

This driver accepts the `jssgdbc:file:<directory>` URL scheme, where `<directory>` is the path to a directory where N-Triples files will be stored:

```javascript
const client = await DriverManager.getClient('jssgdbc:file:/tmp/mytriples');
```

The directory will be created automatically if it does not exist. Triple data is persisted as `.nt` files within this directory.

## API Reference

All graph operations are **asynchronous**:

- `await graph.add(subject, predicate, object)` — Insert a triple
- `await graph.remove(subject, predicate, object)` — Delete a triple
- `await graph.find(subject, predicate, object)` — Query triples (returns `Cursor`)
- `await graph.has(subject, predicate, object)` — Check if a triple exists (returns boolean)
- `await graph.count(subject, predicate, object)` — Count matching triples
- `await graph.clear()` — Clear all triples

Wildcard parameters (pass `null`) match any value:

```javascript
// Find all triples with this subject
const cursor = await graph.find('<http://example.org/alice>', null, null);

// Find all triples (any subject, any predicate, any object)
const cursor = await graph.find(null, null, null);
```

## Persistence Behavior

- **Bounded identities**: Each string graph name maps to a directory named
  `v1-` plus the SHA-256 hex digest of `JSON.stringify(name)`. Names never become
  path components. Empty/default (`''`) and `'default'`, case variants, Unicode
  normalization variants and lone surrogates remain distinct identities.
- **Exact validation**: Each keyed directory contains `identity.json` with
  `{ "version": 1, "name": <exact name> }` and, once persisted, `graph.nt`.
  Metadata is checked before reading or replacing payloads. Malformed/missing
  metadata in existing entries and mismatched identities fail closed.
- **Lazy load, eager flush**: First access loads the whole N-Triples document.
  Mutations serialize the whole graph to an exclusively created owned temporary
  file, then atomically rename it over `graph.nt`. In-memory changes are published
  only after persistence succeeds. Operations are serialized per handle.
- **Safe paths**: Configured root components, keyed directories and metadata/
  payload leaves reject symlinks and invalid types. No-follow file opens are used
  where supported, and regular files are verified. Root creation checks each
  component rather than recursively traversing unchecked paths.
- **Retained data**: Await graph/client close to drain admitted work; close never
  deletes data. An open client can reacquire a fresh handle after awaited graph
  close, reloading persisted data. Clients themselves are terminal after close.
- **No migration**: Legacy `default.nt` / `{name}.nt` files are neither loaded nor
  migrated. There is no legacy-path fallback. Back up and explicitly migrate old
  data before adopting this layout.

Storage errors include a safe operation and bounded key, not graph content or
native filesystem paths. Failed temporary-file cleanup retains the original
failure and the cleanup failure in `AggregateError.errors`.

## Known Limitations

- **Conformance scope**: deterministic tests cover delimiters, escaping, Unicode and malformed inputs, but are not a claim of exhaustive N-Triples conformance.
- **Trusted directory ownership required**: The root and its ancestors must be
  controlled by trusted owners. Portable Node.js checks cannot eliminate races
  with concurrent hostile directory/ancestor replacement. Symlink rejection is
  not a sandbox against an attacker who can rename those directories.
- **Whole-document buffering**: Loading, serialization and rewrites are O(n) in
  graph size and consume memory/disk bandwidth accordingly. Buffered query
  cursors add result-size memory. No streaming or cancellation is provided.
- **No writer coordination**: Per-handle serialization does not coordinate
  multiple clients, processes or overlapping handles. Use one writer or external
  synchronization; concurrent writers can lose updates.
- **No fsync crash-durability guarantee**: Atomic replacement protects the old
  payload from failed writes/renames, but does not promise survival across power
  loss, filesystem failure or OS crashes.

## License

MIT License — see LICENSE file for details.
