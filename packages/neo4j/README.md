# @alt-javascript/jssgdbc-neo4j

See the [breaking-change and capability guide](../../docs/breaking-changes.md)
for typed-term migration, explicit Dataset persistence and recovery.

Neo4j storage for the jssgdbc subject/predicate/object graph API. No arbitrary
Cypher or SPARQL execution is exposed by the public graph API.

## Local development and connection

Experimental `0.0.0`, local-workspace-only package. Private metadata and a
rejecting prepublish guard protect against accidental publication, not deliberate
bypass (scripts can be disabled). No registry release is supported. Run `npm ci` from the repository
root. Package imports below resolve through workspaces.

Importing the public package registers a driver once, without opening a connection.
It also re-exports `DriverManager` and the core API. If you explicitly clear the
registry, register a fresh `Neo4jDriver`; re-importing a cached module will not do so.

The URL is exactly `jssgdbc:neo4j:<native-uri>`, for example
`jssgdbc:neo4j:neo4j+s://db.example.org:7687`. Supported native schemes are
`bolt`, `bolt+s`, `bolt+ssc`, `neo4j`, `neo4j+s`, and `neo4j+ssc`.
Userinfo/embedded credentials, fragments and non-root paths are rejected.

Properties must be a plain object containing only these keys (no accessors):

| Property | Meaning |
| --- | --- |
| `username`, `password` | Nonempty strings, supplied together; omission means unauthenticated |
| `database` | Nonblank string; omitted uses server default |
| `timeoutMs` | Safe integer 1–2147483647, default 30000; transaction timeout and retry budget |
| `connectionTimeoutMs` | Same integer range, default 10000; connection and pool acquisition timeout |

For deployment use server authentication and certificate-validated TLS (`bolt+s`
or `neo4j+s`), with credentials supplied from your secret provider in properties,
not URLs or logs. `+ssc` permits self-signed certificates and is not equivalent to
validated trust. Provision database access and constraint-creation privileges:
connect verifies connectivity, inspects storage compatibility non-destructively, and
installs three idempotent typed identity constraints. Incompatible storage or
insufficient privileges fail connection; no automatic reset or migration occurs.

## Executable examples

These ES modules export callable functions. Pass your full jssgdbc URL and
properties explicitly. Each call owns and awaits closure of its client, including
on failure. They write demo data: use a disposable database. Unique subjects and
graph names isolate runs; interrupted operations can leave data behind.

### Default graph CRUD and buffered cursor

<!-- example:default-crud -->
```javascript
import { DriverManager } from '@alt-javascript/jssgdbc-neo4j';
import { factory } from '@alt-javascript/jssgdbc-dataset';
const { namedNode, literal } = factory;
import { randomUUID } from 'node:crypto';

export async function defaultExample(url, properties = {}) {
  const client = await DriverManager.getClient(url, properties);
  const graph = client.getGraph();
  const subject = namedNode(`urn:demo:${randomUUID()}`);
  const predicate = namedNode('urn:label');
  const object = literal('Hello', 'en');
  try {
    await graph.add(subject, predicate, object);
    await graph.add(subject, predicate, object); // Set semantics: still one triple.
    const present = await graph.has(subject, predicate, object);
    const count = await graph.count(subject);
    const cursor = await graph.find(subject);
    const rows = [];
    try {
      while (await cursor.next()) rows.push(cursor.getTriple());
    } finally {
      await cursor.close();
    }
    await graph.remove(subject, predicate, object);
    const afterRemove = await graph.has(subject);
    return { subject, rows, present, count, afterRemove };
  } finally {
    try { await graph.remove(subject); }
    finally {
      await client.close(); // Owns and drains graph cleanup.
    }
  }
}
```

### Named graph isolation

<!-- example:named-isolation -->
```javascript
import { DriverManager } from '@alt-javascript/jssgdbc-neo4j';
import { factory } from '@alt-javascript/jssgdbc-dataset';
const { namedNode, literal } = factory;
import { randomUUID } from 'node:crypto';

export async function namedExample(url, properties = {}) {
  const client = await DriverManager.getClient(url, properties);
  const name = `urn:demo:${randomUUID()}`;
  const left = client.getGraph(namedNode(`${name}:left`));
  const right = client.getGraph(namedNode(`${name}:right`));
  const def = client.getGraph();
  const triple = [namedNode(name), namedNode('urn:label'), literal('Named')];
  try {
    await left.add(...triple);
    const rightBefore = await right.has(...triple);
    const defaultBefore = await def.has(...triple);
    await right.add(...triple);
    await left.clear();
    const leftAfter = await left.count();
    const rightPreserved = await right.has(...triple);
    await right.clear();
    return { name, rightBefore, defaultBefore, leftAfter, rightPreserved,
      rightAfter: await right.count() };
  } finally {
    try { await left.clear(); }
    finally {
      try { await right.clear(); }
      finally {
        await client.close(); // Attempts cleanup of all three graphs.
      }
    }
  }
}
```

`getGraph()`, `getGraph(undefined)` and `getGraph(defaultGraph())` select the default
graph. Named graphs require RDF/JS NamedNodes, not strings. Concrete SPO values
are structural RDF/JS terms; null/undefined pattern positions are wildcards.
Strings, Variables, RDF-star and blank-node graph names are rejected.

## Explicit Dataset workflow

An independent RDF/JS Dataset is accepted as an iterable of quads. Select every
graph explicitly; the adapter does not enumerate graphs or guess replacement scope.
Use a Dataset factory for detached reads (including isomorphic equality).

<!-- example:dataset -->
```javascript
import { DriverManager, createQuad } from '@alt-javascript/jssgdbc-neo4j';
import { factory } from '@alt-javascript/jssgdbc-dataset';
import { randomUUID } from 'node:crypto';

const { namedNode, blankNode, literal } = factory;

export async function datasetExample(url, properties = {}) {
  const client = await DriverManager.getClient(url, properties);
  const graph = namedNode(`urn:demo:${randomUUID()}`);
  const input = factory.dataset([createQuad(blankNode('shared'), namedNode('urn:label'), literal('Hello', 'en'), graph)]);
  try {
    const outcomes = await client.saveDataset(input, { graphs: [graph], mode: 'replace' });
    const loaded = await client.loadDataset({ graphs: [graph], factory });
    return { graph, equal: loaded.equals(input), outcomes: outcomes.map(o => o.status) };
  } finally {
    try { await client.saveDataset([], { graphs: [graph], mode: 'replace' }); }
    finally { await client.close(); }
  }
}
```

## Storage and operational limits

See [SCHEMA.md](SCHEMA.md). Storage version **1**, profile **rdfjs-structural-v1**,
uses `JssgdbcRdfSchema`, `JssgdbcRdfGraph`, `JssgdbcRdfTerm` and
`JSSGDBC_RDF_TRIPLE`. Structural keys distinguish default/named graphs and term
kinds. Literal lexical value, datatype and language are retained without numeric
coercion: typed `01` and `1` remain distinct. Blank identity persists across graph
partitions and close/reopen. Each Dataset save allocates a fresh blank scope once,
shared across all its graphs and reused on managed retries. Input is not mutated.

All-input preflight precedes writes. Saves default to merge; replacement clears
and inserts in **one managed transaction per selected graph**, even when empty.
Graph mutations share a graph lock with Dataset replacement. Independent graphs
commit sequentially; there is **no whole-save atomicity** or whole-Dataset load
snapshot. `getCapabilities()` returns immutable versioned feature facts, including
unsupported streaming, cross-graph atomicity, RDF-star and blank-node graphs.

`DatasetSaveError.outcomes` distinguishes committed, unknown and not-attempted
graphs. Lost acknowledgement or session-close failure can mean a commit happened:
unknown is not rollback. Reconnect, load the affected graphs and reconcile desired
state before retrying. Blindly merging the same blank labels creates fresh blanks;
it is not an idempotent retry. Coordinate writers before reconciling/replacing.

Legacy `JssgdbcTerm`/`JSSGDBC_TRIPLE`, mixed, unmarked or incompatible metadata is
rejected without destructive cleanup. Use a separate database, or explicitly back
up/export and reset adapter-owned storage under operator control. Do not merely
stamp new metadata on legacy records. Preserve unrelated application data and
coordinate all writers; the adapter supplies no automatic migration/reset command.

Reads, preflight and parameters are buffered **O(quads plus payload bytes)**.
There is no streaming, pagination, result cap or backpressure. At 10x dataset size,
heap/GC or server transaction memory can saturate first; at 10x concurrency,
graph locks or the native pool (100 connections per server) can saturate. Bound
Dataset size, query breadth and caller concurrency. Splitting saves changes atomicity
and blank scope. Timeouts bound individual work/waits, not memory or an overall
retry deadline. Remove/clear retain orphan term and graph nodes; storage reclamation
is operator-controlled. Release cursor/Dataset references to reclaim local memory.
Bounded tests prove correctness on the pinned fixture, not production throughput.

Always await `client.close()`. It is idempotent and marks the client closed
immediately; existing graph handles then reject operations. Buffered cursors remain
independent. Connection, query and cleanup failures propagate as redacted errors:
operation plus a recognized native code, never native messages, causes, credentials
or query parameters. Validation errors also avoid echoing inputs. Cleanup failures
in these examples propagate (and can supersede an earlier operation failure).

## Tests and disposable local setup

From the repository root:

```sh
npm test --workspace=packages/neo4j
npm run test:integration --workspace=packages/neo4j
npm test
```

Default tests are offline and Docker-independent. Deterministic adapter tests are not backend proof; use the live runner or
`npm run test:conformance` for current-source backend evidence. The live runner requires Docker
with Compose, starts `neo4j:5.26.0-community`, waits for health, executes node:test
typed smoke, Dataset durability/schema tests and all marked README examples, then shared typed Mocha compliance in a separate
process. It prints the actual server version; tests must pass without skips.
The supported/tested fixture is Neo4j **5.26.0**, not a claim about other versions.

The runner owns a uniquely named Compose project and always attempts bounded
teardown; startup, suite and teardown failures separately produce nonzero status.
It uses only `jssgdbc:neo4j:bolt://127.0.0.1:17687`, database `neo4j`,
`timeoutMs: 10000`, `connectionTimeoutMs: 2000`, and no credentials. There is no
remote endpoint override. Compliance destructively resets fixture storage.
Never point this suite at shared or production data.

`compose.test.yml` disables authentication **only on the disposable loopback
fixture**. Bolt is published on `127.0.0.1:17687`; HTTP is not published; data/logs
are ephemeral tmpfs. Any local process can access it: use a trusted machine.
Do not copy this auth-disabled configuration into a deployment or expose its port.

For readiness failures check Docker/Compose availability, image-pull access and
whether port 17687 is occupied. Concurrent fixture runs are unsupported. The health
check runs `cypher-shell RETURN 1`; startup waits up to 240 seconds within a bounded
subprocess. Failures are errors, not skips. Do not troubleshoot by disabling remote
authentication or printing credentials/native error bodies. Run the offline suite
to distinguish mapping/lifecycle failures from local service availability.

## Handle lifecycle

Await idempotent closure: closing drains admitted work, not cancellation or rollback.
An open client can reacquire a fresh graph after awaited graph close without
deleting backend data; a closed client is terminal. Detached buffered cursors
survive owner closure. See the [core lifecycle contract](../core/README.md#resource-lifecycle).
