# JSSGDBC — JavaScript Semantic Graph Database Connectivity

**Experimental, pre-publication project.** The repository is public, but this is
not a stable release or a production-readiness claim. Package version fields do
not indicate a supported release. Use the local workspace while the API evolves.

JSSGDBC provides an async `DriverManager → Client → Graph → Cursor` API for
subject/predicate/object storage. It currently implements triple CRUD and wildcard
matching across four storage adapters. The current typed-term and explicit Dataset contracts are described in
[TYPED-TERMS.md](packages/core/test/TYPED-TERMS.md) and
[DATASET-PERSISTENCE.md](packages/core/test/DATASET-PERSISTENCE.md). Backend operational
semantics, blank-node identity and durability are not interchangeable.

See the [breaking-change and capability guide](docs/breaking-changes.md) for
migration from strings, explicit Dataset saves and uncertain-write recovery.

## Implemented packages

| Package | Purpose | Verification boundary |
| --- | --- | --- |
| [core](packages/core/README.md) | Interfaces, registry, cursor and shared compliance generator | Local tests |
| [memory](packages/memory/README.md) | In-process, per-client named graph storage | Local tests |
| [file](packages/file/README.md) | Per-graph N-Triples files, lazy load and eager rewrite | Local filesystem tests; single-writer use |
| [sparql](packages/sparql/README.md) | Triple patterns translated to SPARQL over HTTP | Loopback fixture and separate live Fuseki conformance |
| [neo4j](packages/neo4j/README.md) | SPO mapping into a dedicated Neo4j schema | Local unit tests; separate Docker integration command |
| [dataset](packages/dataset/README.md) | Optional full synchronous RDF/JS Dataset and factory | Local tests and executable explicit persistence example |

The [trajectory scan](docs/jssgdbc-trajectory.md) contains historical findings
and longer-term proposals; current contracts and acceptance commands are linked above.

## Local development

From this checkout:

```sh
npm ci
npm test
```

`npm test` runs packaging safeguards, executable local README examples, core,
memory, file and SPARQL Mocha suites plus Neo4j and optional Dataset unit tests.
Run `npm run test:docs`, `node test/verify-quickstart.js` or
`node test/verify-file-quickstart.js` for focused documentation checks.
SPARQL fixtures bind to localhost; restricted sandboxes may need permission for
that. This command does not start a live SPARQL database or a live Neo4j server.

With Docker available, the aggregate and independent live runners use disposable
fixtures and perform scoped cleanup (run serially):

```sh
npm run test:conformance
npm run test:integration --workspace=packages/neo4j
npm run test:integration --workspace=packages/sparql
```

## Memory example

Run from the repository root with Node.js 22+ ESM. Independent RDF/JS terms
distinguish literals from IRIs; strings are not accepted as Graph terms.
This small buffered example is executed unchanged by `test:docs`.

<!-- example:memory-quickstart -->
```javascript
import assert from 'node:assert/strict';
import '@alt-javascript/jssgdbc-memory';
import { DriverManager } from '@alt-javascript/jssgdbc-core';
import rdf from '@rdfjs/data-model'; // Independent RDF/JS factory
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
- File graph identities use validated keyed directories, not graph names as paths.
  See the [file boundaries](packages/file/README.md#limits-and-capabilities): trusted
  directory ownership, single-writer coordination and no fsync guarantee.
- Await idempotent graph/client closure to drain admitted operations, not cancel
  them. Closed clients are terminal; open clients can reacquire fresh graph handles.
  Detached buffered cursors remain usable and must be closed separately.

Plain and xsd:string literals are equivalent; language tags canonicalize to
lowercase. Typed lexical values (such as `001`) retain their identity. Blank
labels are dataset-scoped, not portable remote identifiers. Wildcards are valid
only in find/has/count/remove patterns, never add. The wider knowledge service
remains a separate consumer of this library.

## Planning and contribution

- [Backend/project comparison and proposed milestones](docs/jssgdbc-trajectory.md)
- [Prompt for the next GSD session](handoff/jssgdbc-next-session-prompt.md)

Use local development and verification. Publication, release tagging and deployment
are outside the current scope. Root and all six workspace versions are `0.0.0` and private. Each workspace
also rejects its prepublish lifecycle offline. These accidental-publication
safeguards are not a security boundary: scripts can be disabled and manifests
can be changed. No registry release is supported.

## License

[MIT](LICENSE).
