# @alt-javascript/jsgdbc-core

![npm @alt-javascript/jsgdbc-core](https://img.shields.io/npm/v/%40alt-javascript%2Fjsgdbc-core?style=flat-square)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)

## Install

```bash
npm install @alt-javascript/jsgdbc-core
```

## Interfaces

| Interface | Purpose |
|-----------|---------|
| **Driver** | Base class for triple-store drivers. Implements `acceptsURL(url)` to test if a URL scheme is supported, and `connect(url, properties)` to create a client connection. |
| **DriverManager** | Static registry and URL dispatcher. Call `registerDriver(driver)` to register implementations, and `getClient(url, properties)` to retrieve a client by URL scheme. |
| **Client** | Connection to a triple-store backend. Call `getGraph(name)` to access named graphs (default graph if name is omitted). |
| **Graph** | Async triple CRUD operations. Methods: `add(subject, predicate, object)`, `remove(subject, predicate, object)`, `find(subject, predicate, object)`, `has(subject, predicate, object)`, `count(subject, predicate, object)`, `clear()`. Wildcard parameters (null) in `find()` match any value. |
| **Cursor** | Forward-only async iterator over triple results. Call `next()` to advance, `getTriple()` to fetch the current triple. Implements async iteration: `for await (const triple of cursor) { ... }`. |
| **UnsupportedOperationError** | Thrown by hook methods that are not implemented in a driver. |
| **ClientDataSource** | Factory wrapper for creating clients from URLs and properties. |

## Usage

This package defines abstract interfaces. Concrete drivers are provided by separate packages (e.g., `@alt-javascript/jsgdbc-memory`). To use jsgdbc:

1. Install a driver package alongside this one
2. Import the driver (which auto-registers itself)
3. Use `DriverManager.getClient()` to get a client

```javascript
import '@alt-javascript/jsgdbc-memory';  // Auto-registers
import { DriverManager } from '@alt-javascript/jsgdbc-core';

const client = await DriverManager.getClient('jsgdbc:memory:');
const graph = client.getGraph();
// ... use graph
```

## Compliance Testing

Implement the `Driver` interface and validate it against the jsgdbc compliance harness:

```javascript
import { testDriverCompliance } from '@alt-javascript/jsgdbc-core/test/driverCompliance.js';

const myDriver = new MyDriver();
const clientFactory = async (url) => {
  return await myDriver.connect(url, {});
};

await testDriverCompliance(myDriver, clientFactory);
```

## License

MIT License — see LICENSE file for details.
