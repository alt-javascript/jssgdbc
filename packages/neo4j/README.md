# @alt-javascript/jssgdbc-neo4j

Neo4j storage for the jssgdbc subject/predicate/object graph API. No arbitrary
Cypher or SPARQL execution is exposed by the public graph API.

## Local development and connection

Experimental, pre-publication workspace package. Run `npm ci` from the repository
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
connect verifies connectivity and installs the idempotent `jssgdbc_term_identity`
constraint. Existing conflicting data or insufficient privileges fail connection.

## Executable examples

These ES modules export callable functions. Pass your full jssgdbc URL and
properties explicitly. Each call owns and awaits closure of its client, including
on failure. They write demo data: use a disposable database. Unique subjects and
graph names isolate runs; interrupted operations can leave data behind.

### Default graph CRUD and buffered cursor

<!-- example:default-crud -->
```javascript
import { DriverManager } from '@alt-javascript/jssgdbc-neo4j';
import { randomUUID } from 'node:crypto';

export async function defaultExample(url, properties = {}) {
  const client = await DriverManager.getClient(url, properties);
  const graph = client.getGraph();
  const subject = `urn:demo:${randomUUID()}`;
  const predicate = 'urn:label';
  const object = '"Hello"@en';
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
      cursor.close();
    }
    await graph.remove(subject, predicate, object);
    const afterRemove = await graph.has(subject);
    return { subject, rows, present, count, afterRemove };
  } finally {
    try { await graph.remove(subject); }
    finally {
      graph.close();
      await client.close();
    }
  }
}
```

### Named graph isolation

<!-- example:named-isolation -->
```javascript
import { DriverManager } from '@alt-javascript/jssgdbc-neo4j';
import { randomUUID } from 'node:crypto';

export async function namedExample(url, properties = {}) {
  const client = await DriverManager.getClient(url, properties);
  const name = `urn:demo:${randomUUID()}`;
  const left = client.getGraph(`${name}:left`);
  const right = client.getGraph(`${name}:right`);
  const def = client.getGraph();
  const triple = [name, 'urn:label', '"Named"'];
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
        left.close();
        right.close();
        def.close();
        await client.close();
      }
    }
  }
}
```

`getGraph()`, `getGraph(null)` and `getGraph('')` refer to the default graph.
Named graphs are exact strings. Omitted/null/undefined pattern positions are
wildcards; empty strings are concrete terms. Mutations return `undefined`.

## Storage and operational limits

See [SCHEMA.md](SCHEMA.md) for the precise mapping and transaction contract.
`JssgdbcTerm` nodes have graph-scoped identity `(graph, kind, value)`.
`JSSGDBC_TRIPLE` is the fixed relationship type; its `predicate` property stores
the predicate, never a dynamic relationship type or label. Terms retain their exact
spellings: `urn:x` and `<urn:x>` differ. Leading single/double quotes classify a
literal, `_:` a blank node, everything else an IRI. This is not RDF parsing or
normalization. Subjects cannot be literals; predicates must be IRIs; objects allow
all three kinds. Language tags, datatype suffixes, escapes and whitespace persist
unchanged. Identical blank identifiers in different graphs are distinct nodes.

Adds have set semantics, using graph-scoped uniqueness and a transactional subject
write lock. Do not bypass this write protocol or use `_jssgdbcLock` for application
data. Existing duplicate relationships are not repaired. Remove/clear delete
relationships only: orphan term nodes accumulate until separately reclaimed.

Each operation owns its session and managed transaction; there is no caller-owned
multi-operation transaction. Native retries may repeat work. Reads are fully
buffered, not streamed; cursor iteration does not provide backpressure, pagination
or a result-size cap. Closing a cursor disables its API but does not free its
retained array while it is referenced. Release references to reclaim memory.
At 10x read volume, heap/GC can saturate first; at 10x concurrency, hot-subject locks
or the native pool (100 connections per server) can saturate. Limit query breadth
and caller concurrency. Timeouts bound individual waits/work, not memory or a
strict overall deadline across retries. Opposite-endpoint writes can deadlock and
retry. Bounded correctness tests are not throughput or production-hardening proof.

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

Default tests are offline and Docker-independent. The live runner requires Docker
with Compose, starts `neo4j:5.26.0-community`, waits for health, executes node:test
smoke and both marked README examples, then shared Mocha compliance in a separate
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
