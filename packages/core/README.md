# @alt-javascript/jssgdbc-core

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)

## Local development

Experimental, pre-publication workspace package. Run `npm ci` from the repository
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

1. Install a driver package alongside this one
2. Import the driver (which auto-registers itself)
3. Use `DriverManager.getClient()` to get a client

```javascript
import '@alt-javascript/jssgdbc-memory';  // Auto-registers
import { DriverManager } from '@alt-javascript/jssgdbc-core';

const client = await DriverManager.getClient('jssgdbc:memory:');
const graph = client.getGraph();
// ... use graph
```

## String terms

Use absolute IRI strings (`urn:s`, `https://example.org/s`) or bracketed
N-Triples IRIs (`<urn:s>`). Results return unbracketed IRIs. Literal objects
must be double-quoted N-Triples strings, e.g. `'"text"'`, `'"hello"@en'`, or
`'"001"^^<http://www.w3.org/2001/XMLSchema#integer>'`. Never pass bare text
as a literal. `urn:o` and `"urn:o"` remain distinct RDF terms.

Subjects allow IRIs or `_:label` blank nodes; predicates require IRIs; objects
also allow literals. Malformed terms and invalid positions reject with a
position-bearing TypeError before adapter I/O. Add requires three bound terms;
null/undefined are wildcards only in find/has/count/remove patterns.

Results canonicalize equivalent escapes, language tags to lowercase, and
xsd:string literals to plain quoted literals. Typed lexical content (including
leading zeroes) is never coerced to JavaScript numbers or booleans. This is a
string API, not a public RDF/JS term-object API. Use maintained Node.js 22+.

Blank labels are scoped to a graph/dataset, not global identifiers. Local file
round trips preserve labels, but separate imports and remote requests do not
promise stable labels or portable blank-node lookup/removal. In SPARQL a blank
label in a query pattern is existential, not a persistent node identifier.
Use IRIs when identity must survive independent remote operations.

## Compliance Testing

Implement the `Driver` interface and validate it against the jssgdbc compliance harness:

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
