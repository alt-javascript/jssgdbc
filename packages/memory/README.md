# @alt-javascript/jssgdbc-memory

![npm @alt-javascript/jssgdbc-memory](https://img.shields.io/npm/v/%40alt-javascript%2Fjssgdbc-memory?style=flat-square)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)

## Install

```bash
npm install @alt-javascript/jssgdbc-memory @alt-javascript/jssgdbc-core
```

## Usage

Importing this package auto-registers the in-memory driver. Then use `DriverManager.getClient()` to get a client:

```javascript
import '@alt-javascript/jssgdbc-memory';
import { DriverManager } from '@alt-javascript/jssgdbc-core';

// Get a client for the in-memory triple store
const client = await DriverManager.getClient('jssgdbc:memory:');

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

Wildcard parameters (pass `null`) match any value:

```javascript
// Find all triples with this subject
const cursor = await graph.find('http://example.org/alice', null, null);

// Find all triples (any subject, any predicate, any object)
const cursor = await graph.find(null, null, null);
```

## License

MIT License — see LICENSE file for details.
