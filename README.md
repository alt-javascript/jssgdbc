# JSSGDBC — JavaScript Semantic Graph Database Connectivity

![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![npm @alt-javascript/jssgdbc-core](https://img.shields.io/npm/v/%40alt-javascript%2Fjssgdbc-core?style=flat-square)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)
[![CI](https://img.shields.io/badge/CI-GitHub%20Actions-blue?style=flat-square)](https://github.com/alt-javascript/jssgdbc/actions)

## Why JSSGDBC?

JSSGDBC provides a uniform async API for triple-store backends. Write your SPO (Subject-Predicate-Object) code once, and swap backends by changing a URL. Connect to in-memory, file-based, or remote SPARQL/Neo4j instances without rewriting application logic.

```javascript
// Same code, different backends:
const client = await DriverManager.getClient('jssgdbc:memory:');      // In-memory
// const client = await DriverManager.getClient('jssgdbc:sparql:http://endpoint');  // Future
// const client = await DriverManager.getClient('jssgdbc:neo4j:bolt://localhost');  // Future
```

## Packages

| Package | Purpose |
|---------|---------|
| [@alt-javascript/jssgdbc-core](./packages/core) | Abstract interfaces for triple-store drivers: `Driver`, `DriverManager`, `Client`, `Graph`, `Cursor` |
| [@alt-javascript/jssgdbc-memory](./packages/memory) | In-memory triple-store driver implementation |

## Quick Start

```javascript
// Auto-registers the memory driver on import
import '@alt-javascript/jssgdbc-memory';
import { DriverManager } from '@alt-javascript/jssgdbc-core';

// Get a client for the in-memory triple store
const client = await DriverManager.getClient('jssgdbc:memory:');

// Get the default graph (or any named graph)
const graph = client.getGraph();

// Add triples (async)
await graph.add(
  'http://example.org/alice',
  'http://xmlns.com/foaf/0.1/name',
  'Alice'
);

// Query triples with wildcard find (async, returns a Cursor)
const cursor = await graph.find(null, null, null);

// Iterate with for-await-of
for await (const triple of cursor) {
  console.log(triple);
  // { subject: 'http://example.org/alice', predicate: 'http://xmlns.com/foaf/0.1/name', object: 'Alice' }
}

// Or iterate manually with while/next
const cursor2 = await graph.find('http://example.org/alice', null, null);
while (await cursor2.next()) {
  console.log(cursor2.getTriple());
}

// Remove triples (async)
await graph.remove(
  'http://example.org/alice',
  'http://xmlns.com/foaf/0.1/name',
  'Alice'
);

// Count remaining triples
const count = await graph.count(null, null, null);
console.log(count); // 0
```

## URL Schemes

| Scheme | Package | Backend |
|--------|---------|---------|
| `jssgdbc:memory:` | @alt-javascript/jssgdbc-memory | In-memory triple store |

## Contributing

Contributions are welcome! Please follow these guidelines:

- Write tests for new features
- Ensure all tests pass: `npm test`
- Follow the existing code style
- Include README updates for new drivers

## License

MIT License — see LICENSE file for details.
