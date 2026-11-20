# @alt-javascript/jssgdbc-file

![npm @alt-javascript/jssgdbc-file](https://img.shields.io/npm/v/%40alt-javascript%2Fjssgdbc-file?style=flat-square)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)

## Install

```bash
npm install @alt-javascript/jssgdbc-file @alt-javascript/jssgdbc-core
```

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
  'http://example.org/alice',
  'http://xmlns.com/foaf/0.1/name',
  'Alice'
);

// Find triples (async, returns a Cursor)
const cursor = await graph.find(null, null, null);
for await (const triple of cursor) {
  console.log(triple);
}

// Remove a triple (async)
await graph.remove(
  'http://example.org/alice',
  'http://xmlns.com/foaf/0.1/name',
  'Alice'
);
```

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
const cursor = await graph.find('http://example.org/alice', null, null);

// Find all triples (any subject, any predicate, any object)
const cursor = await graph.find(null, null, null);
```

## Persistence Behavior

The file driver persists triples to N-Triples (.nt) files:

- **Lazy-load on first access**: The driver reads from disk only when a graph operation is first called. If the .nt file does not exist, an empty graph is created.
- **Eager-flush on mutation**: After any add, remove, or clear operation, the entire graph is serialized back to disk immediately.
- **One file per graph**: Each named graph is stored in its own .nt file. The default graph (unnamed) is stored as `default.nt`, and named graphs are stored as `{name}.nt` within the configured directory.

For example, with URL `jssgdbc:file:/tmp/mytriples`:
- Default graph → `/tmp/mytriples/default.nt`
- Named graph `events` → `/tmp/mytriples/events.nt`

## Known Limitations

- **In-memory loading**: The entire contents of an .nt file are read into memory on first access. This means very large triple stores (millions of triples) may consume significant memory. No streaming mode is available.
- **No file-locking**: This driver does not implement file-level locking. If multiple Node.js processes write to the same directory concurrently, file corruption may occur. Use a single writer or coordinate external synchronization.

## License

MIT License — see LICENSE file for details.
