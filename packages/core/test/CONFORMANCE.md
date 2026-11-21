# Portable adapter conformance

Run from the repository root after installing workspace dependencies (`npm ci`). Requires Node.js with the built-in test runner and fetch, npm, a running Docker engine and Docker Compose v2 supporting `up --wait`. Allow image downloads/builds from Docker Hub and archive.apache.org. Ports 17687 and 13330 must be free. Run one acceptance command at a time; fixtures bind only to loopback and are unauthenticated disposable test services, not production servers.

## Commands

```sh
npm test
node --test scripts/conformance-runner.test.js
npm run test:conformance
npm run test:conformance
```

The repeated aggregate detects port, data and cleanup residue. Individual adapters:

```sh
npm test --workspace=packages/memory
npm test --workspace=packages/file
node packages/neo4j/test/run-integration.js
node packages/sparql/test/run-integration.js
```

Never point the shared suite at a production dataset: default-graph clear is deliberately tested. Use the owned runners rather than invoking live test files directly.

## Equivalence matrix

All four factories acquire clients through the public DriverManager API and run `driverCompliance.js` without weakening backend assertions.

| Contract | Memory | File | Neo4j | SPARQL / Fuseki |
| --- | --- | --- | --- | --- |
| Add/deduplicate/find/has/count/remove | Shared suite | Shared suite | Live shared suite | Live shared suite |
| All eight bound masks, null and undefined wildcards | Yes | Yes | Yes | Yes |
| Default and two named graphs isolated; graph-local clear | Yes | Yes | Yes | Yes |
| Lossless lexical identity and equivalent normalized terms | Yes | Yes | Yes | Yes |
| Graph close/reacquire retains data; client close terminal | Yes | Yes | Yes | Yes |
| Buffered cursor survives owner close | Yes | Yes | Yes | Yes |
| Storage lifetime | Client memory | Local N-Triples files | Disposable database | In-memory dataset |

Neo4j also runs its unchanged node:test smoke and marked README examples, including constraints, cross-client set semantics and unavailable endpoint diagnostics. Deterministic SPARQL HTTP fixtures and Neo4j injected drivers test error paths, not real backend equivalence. `npm test` alone is not live proof. Live Mocha uses `--forbid-pending --fail-zero`; infrastructure unavailability is failure, not a skip.

## Pinned backends and bounds

- Neo4j image: `neo4j:5.26.0-community`. Smoke tests report the runtime version from `dbms.components()`.
- Apache Jena/Fuseki: official 5.4.0 archive verified with the SHA-512 in `packages/sparql/test/fixtures/Dockerfile`; runtime base `eclipse-temurin:21.0.7_6-jre-jammy`. Live setup reads `/$/server`, reports and asserts version 5.4.0. Image tags are version pins, not immutable digest pins.
- Root sequential deadlines: memory 120s, file 120s, Neo4j 780s, Fuseki 900s (32 minutes total maximum subprocess budgets).
- Neo4j: startup 300s with 240s Compose readiness; node tests 180s; Mocha 180s; teardown 60s; removal check 15s.
- Fuseki: build/startup 600s with 180s Compose readiness; version/compliance 180s; teardown 60s; removal check 15s.
- Shared live cases have 30s Mocha deadlines and 10s operation timeouts. Fuseki version fetch has a 5s deadline. Removal queries have 10s deadlines inside 15s subprocess budgets.

Outer deadlines leave room for owned cleanup. This bounds local acceptance, not arbitrary OS hangs or forced host termination. No throughput guarantee is made. Results are buffered, not streamed or paginated: at larger datasets response/client memory and file rewrite I/O become limiting, and parallel acceptance runs collide on fixed ports. Shared cases use at most ten triples; timeout budgets are not memory caps.

## Ownership and diagnostics

Each runner reports a fresh UUID Compose project (`jssgdbc-test-…` or `jssgdbc-fuseki-…`) and phase elapsed time/outcome. It always attempts `down --volumes --remove-orphans` for that exact project, then queries `docker ps -aq --filter label=com.docker.compose.project=PROJECT` and requires empty output. This checks stopped as well as running containers. Fixture data uses tmpfs/in-memory storage; Compose removes its network. Build images/cache are intentionally retained.

Startup, test, teardown or removal-check failure returns nonzero; the aggregate continues to report all four adapters. Offline injected-spawn tests cover failures and exact project targeting but do not prove Docker removal. Successful live removal checks supply that proof. If interrupted externally or cleanup fails, use the reported project with its corresponding compose file to inspect resources; never prune globally or delete by a broad name prefix. Do not reset unrelated databases. Phase errors suppress arbitrary subprocess error objects; Docker/build output is inherited for local diagnosis.

## Semantic and lifecycle differences

See [STRING-TERMS.md](STRING-TERMS.md) for the exact term grammar. Absolute convenience IRIs and bracketed IRIs normalize together; quoted literals never become IRIs. Plain and xsd:string literals are equivalent, language tags normalize lowercase, and equivalent Unicode escape spellings normalize. Typed lexical `001` remains distinct from `1`: numeric value equality must not erase lexical identity. Literal content, language and datatype distinctions survive every operation.

Blank-node labels are dataset/result scoped. Local support does not establish remote cross-request identity; the portable suite uses absolute IRIs instead. SPARQL named graphs use RDF IRIs while local graph names can have broader adapter-specific syntax. Neo4j stores RDF-shaped terms in its property-graph representation, not an RDF inference engine. No inference or general SPARQL query equivalence is claimed.

Graph close releases a handle without deleting data; a fresh handle on an open client can read retained data. File persistence is local disk persistence, unlike the deliberately ephemeral lifetime of these backend fixtures. The suite proves handle reacquisition, not crash recovery or durable production backend configuration.

Client close is terminal and repeatable; retained graph handles reject further calls. Already buffered cursors remain usable. Closing is not a portable cancellation/rollback barrier for operations already in flight. There is no implicit client reopening or application-level reconnect/retry loop. Native Neo4j transport/managed transaction behavior is separate from that contract; do not assume identical network behavior across adapters. SPARQL uses bounded requests without automatic application retries. Dependency errors remain observable rather than being turned into empty results.
