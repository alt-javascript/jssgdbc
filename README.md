# JSSGDBC — JavaScript Semantic Graph Database Connectivity

**Experimental, pre-publication project.** The repository is public, but this is
not a stable release or a production-readiness claim. Package version fields do
not indicate a supported release. Use the local workspace while the API evolves.

JSSGDBC provides an async `DriverManager → Client → Graph → Cursor` API for
subject/predicate/object storage. It currently implements triple CRUD and wildcard
matching across four storage adapters. RDF term conventions still differ between
adapters; switching URLs does not yet guarantee semantic portability.

## Implemented packages

| Package | Purpose | Verification boundary |
| --- | --- | --- |
| [core](packages/core/README.md) | Interfaces, registry, cursor and shared compliance generator | Local tests |
| [memory](packages/memory/README.md) | In-process, per-client named graph storage | Local tests |
| [file](packages/file/README.md) | Per-graph N-Triples files, lazy load and eager rewrite | Local filesystem tests; single-writer use |
| [sparql](packages/sparql/README.md) | Triple patterns translated to SPARQL over HTTP | Loopback HTTP fixture; live vendor interoperability remains to be established |
| [neo4j](packages/neo4j/README.md) | SPO mapping into a dedicated Neo4j schema | Local unit tests; separate Docker integration command |

The existing M001–M004 implementation milestones are recorded complete in GSD.
The [trajectory scan](docs/jssgdbc-trajectory.md) proposes the next milestone set;
it does not mark that work implemented.

## Local development

From this checkout:

```sh
npm ci
npm test
```

`npm test` runs core, memory, file and SPARQL Mocha suites plus Neo4j unit tests.
SPARQL fixtures bind to localhost; restricted sandboxes may need permission for
that. This command does not start a live SPARQL database or a live Neo4j server.

With Docker available, the separate Neo4j integration runner uses a disposable
fixture and performs scoped cleanup:

```sh
npm run test:integration --workspace=packages/neo4j
```

## Memory example

Run from the repository root with Node.js ESM. The quoted object below represents
a literal; explicit RDF term objects are a proposed future improvement.

```javascript
import './packages/memory/index.js';
import { DriverManager } from './packages/core/index.js';

const client = await DriverManager.getClient('jssgdbc:memory:');
const graph = client.getGraph();
const subject = '<urn:example:alice>';
const predicate = '<urn:example:name>';
const object = '"Alice"';

try {
  await graph.add(subject, predicate, object);
  const cursor = await graph.find(subject, null, null);
  try {
    for await (const triple of cursor) console.log(triple);
  } finally {
    cursor.close();
  }
  await graph.remove(subject, predicate, object);
} finally {
  graph.close();
  await client.close();
}
```

## Connection schemes

| Scheme | Adapter |
| --- | --- |
| `jssgdbc:memory:` | Memory |
| `jssgdbc:file:<directory>` | File |
| `jssgdbc:sparql:<http(s)-endpoint>` | SPARQL |
| `jssgdbc:neo4j:<bolt-or-neo4j-URI>` | Neo4j |

Import the relevant adapter to register it. Consult each package README for
credentials, endpoint configuration and term conventions. Driver registration
alone does not establish a database connection.

## Current boundaries

- Public graph operations: `add`, `remove`, `find`, `has`, `count`, `clear`.
- Cursors are buffered. Async iteration does not imply streaming or bounded memory.
- No public general SPARQL/Cypher execution, ontology manager, inference engine,
  SHACL validator, temporal claims service or LLM extraction layer is implemented.
- Neo4j stores triples in a JSSGDBC-specific schema; it does not expose arbitrary
  existing property graphs or Graphiti graphs through the triple API.
- The file serializer and parser have known edge cases; see the trajectory scan.
  File graph names map directly to paths and require trusted, simple names.
- Client/graph lifecycle behaviour is not yet consistent across drivers.

The next priority is reliable terms, lifecycle and conformance, followed by
capability-aware queries and selective backend validation. The wider knowledge
service remains a separate consumer of this library.

## Planning and contribution

- [Backend/project comparison and proposed milestones](docs/jssgdbc-trajectory.md)
- [Prompt for the next GSD session](handoff/jssgdbc-next-session-prompt.md)

Use local development and verification. Publication, release tagging and deployment
are outside the current scope. The package manifests still contain publishing
metadata; the root workspace's `private` flag is not a substitute for a future
review of individual package publishing settings.

## License

[MIT](LICENSE).
