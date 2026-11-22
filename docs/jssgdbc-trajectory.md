# JSSGDBC trajectory: ecosystem scan and proposed GSD milestones

Date: 21 November 2026. Inspected implementation baseline: `84d5f2e`.
Status: historical research and proposed roadmap, with a current implementation update below. The original scan and proposed milestone breakdown are preserved as history, not authoritative execution state.

## Current experimental baseline (M006 implementation)

The original scan below describes `84d5f2e`, not the current checkout. M006 replaces
the M005 string API with structural RDF/JS terms across memory, file, SPARQL and
Neo4j, explicit selected Dataset load/save, and immutable version-1 capabilities.
The optional full synchronous Dataset factory provides detached local editing;
persistence requires an explicit async save. Awaited lifecycle and lexical identity
remain part of the contract. Final integrated acceptance must be established by
current-source verification, not inferred from this status update.

Use the [breaking-change guide](breaking-changes.md) for migration, measured
capabilities and recovery; [CONFORMANCE.md](../packages/core/test/CONFORMANCE.md)
for backend versions, deadlines and ownership; and the [root README](../README.md)
for executable examples. STRING-TERMS is superseded historical material. File
storage requires a trusted directory and single-writer coordination, buffers and
rewrites graphs, has no fsync guarantee, and does not migrate legacy files; see
[file compatibility](../packages/file/README.md#storage-and-compatibility).
Cursors and storage workflows remain buffered, not streaming or memory-bounded.

Root and all six workspaces are now private experimental `0.0.0` packages. Offline safeguards test owned lock metadata, registration through public imports, side-effect declarations and rejecting publication hooks. These prevent accidents, not deliberate bypass: scripts can be disabled. No registry release, deployment or additional backend is delivered here.

### Current verification workflow

From the repository root with installed workspace dependencies, run these checks serially:

```sh
npm run test:packaging
npm run test:docs
node test/verify-quickstart.js
node test/verify-file-quickstart.js
npm test
node --test scripts/conformance-runner.test.js scripts/documentation-contract.test.js
node test/verify-dataset-memory.js
node test/verify-dataset-file.js
npm run test:conformance
npm run test:integration --workspace=packages/sparql
```

The aggregate executes memory/file shared compliance and public Dataset executables,
then disposable real Neo4j/Fuseki suites, including the same independent Dataset
fixture and Neo4j's unchanged marked README examples. The standalone SPARQL command exercises its independent runner. Docker and Compose readiness are mandatory: unavailable infrastructure is failure, not a skip. Offline HTTP/native fixtures are not live backend proof. Use each run's reported runtime versions, phase outcomes and exact Compose project label to verify cleanup of containers, networks and volumes; never prune unrelated resources. Generated execution logs are evidence for that run, not source artifacts or a claim of vendor-wide compatibility.

Use the installed **Open GSD** workflow and its database-backed state tools to inspect progress and reconcile requirements at closeout. Do not register M005 again from the historical proposal, edit generated projections, or infer milestone completion from this document. Requirement reconciliation and slice/milestone acceptance remain closeout prerequisites. The [original next-session prompt](../handoff/jssgdbc-next-session-prompt.md) and earlier handoff transcripts are historical context, not current execution instructions. Later milestone proposals below remain proposals, not shipped features.

## Historical scan (baseline `84d5f2e`)

Sections 1–5, including their present-tense findings, test counts, metadata and proposed slice assignments, refer to the original scan. Resolved defects remain recorded to explain why M005 was undertaken; current contracts above supersede those descriptions.

## Recommendation

Develop JSSGDBC as a small, capability-aware semantic graph connectivity library. First make data meaning, lifecycle and conformance reliable across existing drivers; then expose richer queries and efficient dataset movement; then validate selected additional backends. Keep extraction, temporal claims, review policy and agent memory above this library.

The user is not ready to publish. A public repository and `1.0.0` manifest fields do not imply a stable release. This scan does not propose publication, deployment, release tagging or changing the project into the airline knowledge service.

Apache Jena is deliberately not the organizing dependency for this roadmap. Generic RDF/SPARQL interoperability remains relevant, regardless of vendor.

## Evidence and limits

- Inspected core API, memory implementation, file graph normalization/parser/serializer/path handling, SPARQL builder/transport, Neo4j initialization and mapping, package manifests, READMEs and GSD records.
- Ran the root test suite: core 38, memory 9, file 59, SPARQL 296, Neo4j unit tests 330; total 732 passing. The first sandboxed run hit localhost `EPERM`; rerunning with permission passed.
- Ran targeted local probes described below. These findings show gaps beyond the passing suite.
- Read upstream project documentation and selected design material. Did not install, benchmark or run upstream databases/projects. Their advertised features are not independently certified here.
- Did not rerun live Neo4j Docker integration or establish live vendor SPARQL compatibility. GSD records report earlier Neo4j validation; distinguish that history from today's test evidence.
- Andromeda cannot be uniquely identified from its name. A URL has been requested; no Andromeda capability or adapter recommendation is asserted.

## 1. What currently exists

The core exposes a registry/factory and `Client → Graph → Cursor`. Graph methods implement add, remove, find, has, count and clear. The cursor stores an array; async iteration does not make it streaming.

| Adapter | Actual role | Important boundary |
|---|---|---|
| Memory | Per-client string-triple store with named containers | Not RDF semantic validation; stores do not automatically span clients |
| File | Load per-graph N-Triples into memory; rewrite on mutation | Serialization conventions differ from memory; no locking; graph names are file paths |
| SPARQL | Generate queries/updates for one triple pattern over HTTP | One configured endpoint; GET query and raw POST update; no public arbitrary query API |
| Neo4j | Encode triples as graph-scoped term nodes and fixed triple relationships | Dedicated storage schema, not access to arbitrary property graphs |

No public ontology lifecycle, entailment selection, SHACL, provenance service, transaction session, bulk import/export, native query or capability discovery interface exists yet.

## 2. Findings that should drive the next milestone

### Confirmed behaviour from local probes

| Probe | Observed result | Consequence |
|---|---|---|
| File serializer receives bare `Alice` | Throws unknown term type | Low-level serializer requires lexical terms; public FileGraph wraps bare strings as IRIs |
| SPARQL builder receives bare `Alice` as object | Generates `<Alice>` | Bare string does not mean the same thing as a plain literal |
| FileGraph reads back a quoted plain literal | Returns the bare literal content, while IRIs also return bare strings | Result values lose the IRI/plain-literal distinction; round-trip identity is unsafe |
| File serializer receives quoted `alice@example.org` | Splits literal content at `@`, produces malformed output | Content and RDF suffix syntax are conflated |
| File serializer receives quoted `a^^b` | Splits content as a datatype suffix | Typed-literal parsing is not safe for arbitrary content |
| File serializer receives quoted emoji | Emits separate surrogate escapes | Unicode handling needs standards-based fixtures |
| Parser receives four RDF terms before the dot | Returns only the first three | Malformed input is silently accepted |
| Retained memory graph used after client close | Still accepts writes | Lifecycle differs from remote adapters |

### Inspection findings to verify and resolve

- `FileClient` interpolates graph names into paths. Arbitrary IRIs do not map safely to portable filenames; containment, encoding, collision handling and migration need a defined contract.
- The shared compliance generator uses values like `subject1`/`graph1`. Those fixtures do not establish standards-valid RDF interoperability and the file package does not run the same generator directly.
- SPARQL term formatting passes strings beginning with `<`, `_:` or `"` through. A validated term boundary is needed before treating caller values as data-safe inputs. This is an inspection finding, not an exploit demonstration.
- Core caches graph handles even after a graph is closed. Decide whether reacquiring it returns a new handle or a documented error; test across drivers.
- SPARQL and Neo4j have buffered results without response-size limits. Timeout does not bound memory use.
- SPARQL's `sideEffects: false` conflicts with its registration side effect; memory/file metadata points at driver modules although registration is in the entrypoint. Verify bundler behaviour before fixing metadata.
- Workspace packages contain public publishing configuration despite the root being private. Review intentional pre-publication guardrails in M005; do not mistake documentation changes for a publishing lock.

### Documentation reconciliation in this session

- Root README now lists all implemented packages and schemes and states experimental status.
- Removed unverified npm-release badges and registry-first installation instructions from package READMEs; local workspace use is documented.
- Removed the root CI badge: no `.github` workflow is present in this checkout.
- Corrected the core README's compliance helper import/name/calling convention.
- Clarified file README examples with explicit literal/IRI forms; documented known codec/path limitations.
- Preserved executable SPARQL/Neo4j example blocks and recorded their verification boundary.

GSD state also has drift: `STATE.md` reports M004 complete while `PROJECT.md` still says closeout pending. `.gsd` is a symlink to external Open GSD state. Reconcile through the actual state mechanism in the next session; do not manually fabricate completion receipts or overwrite generated projections.

## 3. Ecosystem comparison

These candidates occupy different layers. A framework that stores knowledge in a database is not itself an interchangeable database driver.

| Candidate | Documented role | Fit and recommendation |
|---|---|---|
| Graphiti | Python temporal-context graph framework with episodes, provenance, entity/edge types and hybrid retrieval; uses underlying graph databases | Study as a higher-level consumer/reference. Do not implement `GraphitiDriver` as though its episode/search API were SPO CRUD. Shared Neo4j storage does not make its schema compatible with ours. [Project](https://github.com/getzep/graphiti) |
| Stardog | RDF/SPARQL platform with graph-scoped reasoning schemas and extended HTTP facilities | Closest semantic backend target in the supplied list. Start with generic SPARQL transport interoperability; add explicit provider options for reasoning/schema and transactions only when required. [HTTP API](https://docs.stardog.com/developing/http-api), [inference](https://docs.stardog.com/inference-engine/) |
| FalkorDB | Property graph with openCypher, parameterized graph queries and documented RESP/Bolt access | Candidate dedicated adapter after capability/conformance work. Prefer the maintained JS client or a verified protocol route. Pin a version and prove graph isolation, constraints and concurrent deduplication. Cypher or Bolt support alone is insufficient. [Overview](https://docs.falkordb.com/), [query protocol](https://docs.falkordb.com/commands/graph.query) |
| Memgraph | Cypher/Bolt database with documented differences from Neo4j | Useful first property-graph compatibility spike because the current implementation already uses Neo4j's JS driver. Verify exact DDL, transaction/retry semantics, database selection and locking. Do not simply alias its URL to Neo4j. [Client compatibility](https://memgraph.com/docs/client-libraries/python), [Cypher differences](https://memgraph.com/docs/querying/differences-in-cypher-implementations) |
| Andromeda | Ambiguous name | Await exact product/repository URL. Do not substitute ArangoDB or one of the unrelated Andromeda harnesses. |
| `open-gsd/gsd-graph` | Local graph engineering toolkit: extraction, normalization, canonical JSON storage, cited retrieval, review, CLI/MCP | The closest application-layer reference in this list. Its ontology packs are not evidence of OWL entailment support. Evaluate an import/export bridge or storage integration separately from core. [README](https://github.com/open-gsd/gsd-graph), [design](https://github.com/open-gsd/gsd-graph/blob/main/docs/DESIGN.md) |
| `robert-mcdermott/ai-knowledge-graph` | Python text-to-triples generator and visualization/chat tooling; sentence evidence, exports and optional inferred edges | Useful input-format and UX reference. Its LLM-generated and lexical inferred edges are not formal entailments. Use source/inference-aware imports as proposals, not accepted truth. [Project](https://github.com/robert-mcdermott/ai-knowledge-graph) |

The two smaller OSS projects should be evaluated against their stated scope rather than dismissed by appearance. The scan establishes feature direction, not operational maturity. `gsd-graph` explicitly distinguishes canonical storage from projections and has provenance/review concepts worth learning from. Neither project has been proven here to provide the complete shared coordination service from the earlier discussion.

### The most relevant additional comparison: RDF/JS

Before inventing term and query interfaces, compare with [RDF/JS data model](https://rdf.js.org/data-model-spec/) and [query interfaces](https://rdf.js.org/query-spec/). They provide typed terms/quads and distinct query result forms. JSSGDBC can contribute connection lifecycle, driver selection, capability reporting and compliance while interoperating with established JavaScript RDF tools. Align a documented subset first; do not claim full RDF/JS or RDF 1.2 conformance merely by adding similarly named objects.

## 4. Architectural direction

### Portable core

Terms, graph identifiers, CRUD, lifecycle, errors and capability introspection. Prefer explicit NamedNode/BlankNode/Literal representations over heuristic string interpretation. Define lexical identity versus RDF term identity, and a migration path for existing strings and stored data.

### Optional interfaces

General query result types, dataset import/export, batch writes, transactions, reasoning selection and validation adapters. Unsupported capabilities must fail explicitly. Do not simulate atomic transactions by sequential writes or conceal partial imports.

### Provider-specific extensions

Endpoint routing, authentication, native query dialects, reasoning schemas, transaction tokens and operational options. Name these honestly rather than claiming all backends offer identical behaviour.

### Separate consumers

Claims, citations, source revisions, ontology pack selection, acceptance policy, temporal baselines, LLM extraction and agent/MCP workflows belong in a higher-level library/service. Store those structures through JSSGDBC; do not bake airline or GSD workflow policy into `Graph`.

Backend expansion order: semantic interoperability first (Stardog-compatible HTTP path when an instance is available), Memgraph compatibility spike second, FalkorDB when justified by the spike/use case. No implementation commitment for Andromeda without identification. Graphiti remains a separate integration experiment.

## 5. Proposed GSD milestone set

### M005 — Establish a trustworthy experimental baseline

Outcome: documented behaviours and real correctness gaps are reconciled before adding features.

- S01: reproduce baseline; register requirements; verify README corrections and package metadata; reconcile GSD projections using the real state tools.
- S02: fix N-Triples correctness with targeted regression fixtures for literal delimiters, escapes, Unicode, arity and invalid positions; choose a maintained parser or a clearly bounded implementation.
- S03: define and implement graph/client closure behaviour and safe graph-to-file mapping, including compatibility/migration and path containment tests.
- S04: replace misleading common fixtures with a standards-valid portable subset, exercise it across applicable drivers, and document true differences. Check entrypoint registration and pre-publication settings.

Exit: current tests plus gap-specific regressions pass; common fixtures preserve meaning; known unsupported inputs are rejected explicitly; docs name the verified boundary. No backend additions or publication.

### M006 — Explicit RDF terms and capabilities

Outcome: callers know what a value means and what a backend can do.

- Decide the supported RDF/JS-aligned term subset and semantic equality rules.
- Introduce typed inputs/results with an explicit legacy-string compatibility policy; avoid silent conversion of existing literal/IRI distinctions.
- Define graph identifier semantics and blank-node scope across datasets/imports.
- Expose immutable, versioned capability information for queries, formats, transactions, reasoning and result delivery. Distinguish supported, configured and unavailable features.
- Extend compliance tests across typed values and semantic round trips; document persisted-data migration.

Exit: same typed fixture has the same meaning on the supported adapters; unsupported operations are discoverable and fail consistently. Memory's dependency-free objective remains unless consciously superseded.

### M007 — Useful query and bounded ingestion surfaces

Outcome: consumers can query relationships and move datasets without one HTTP request per triple or unlimited buffering.

- Public SELECT bindings, ASK boolean and graph-result query forms, with update separated from read operations; define language and dataset scope.
- SPARQL query/update endpoint separation and POST support; configurable limits and cancellation.
- Batch operations and N-Triples/N-Quads import/export with explicit partial-failure and blank-node handling.
- Bounded result handling or real streaming with backpressure and cleanup; do not call array iteration streaming.
- Native Cypher escape hatch only if a concrete consumer requires it; no universal SPARQL-to-Cypher compiler.

Exit: an evidence-link join and named-graph export work with correct result types; oversized/cancelled operations have tested behaviour; batch failure semantics are explicit. Backend-neutral transaction orchestration is not implied.

### M008 — Prove backend portability selectively

Outcome: evidence-based compatibility profiles rather than a list of advertised databases.

- S01: live RDF endpoint fixture independent of Jena; use an accessible standards endpoint and add Stardog profile tests when a suitable instance/license is available. Record unavailable vendor testing as unavailable.
- S02: pinned Memgraph spike for the exact SPO model: constraints, repeated startup, concurrent set semantics, deletion, closure and transaction behaviour. Either deliver a distinct adapter or a documented incompatibility result.
- S03: gated FalkorDB spike/adapter with explicit transport choice, graph scope and result decoding. Reuse only proven common mapping logic.

Each profile records backend/server/driver versions and which capabilities were exercised. Never declare a vendor supported solely because a fixture or another vendor passes. Resolve package/licensing availability when selecting images; do not make all optional vendors mandatory for the offline suite.

### M009 — Optional semantic services and consumer proof

Outcome: demonstrate library utility to a provenance-aware application without becoming that application.

- Load versioned ontology artifacts as RDF datasets; distinguish loading from entailment.
- Model reasoning/validation as explicit capabilities/providers with selected graph scope and defined result contracts. Unsupported backends remain explicit.
- Build one synthetic source/claim/revision example with asserted versus derived data and a retraction check.
- Explore one `gsd-graph` or generator import bridge preserving citations, confidence and inference labels. Keep framework adapters outside core.

Exit: a reproducible example cites its sources, preserves revisions and reports inference/validation support honestly. No implicit acceptance of LLM-generated facts, production knowledge service or full OWL engine.

### Deferred

Full property-graph abstraction, vector-search standardization, a bespoke query planner, autonomous ontology generation, Graphiti replacement, remote team coordination, EKS and publication. These need their own evidence and scope decisions.

At the time of this scan, M005 was ready for detailed planning. M006–M009 expressed direction rather than a frozen plan; reassess them using delivered baseline findings and actual Open GSD state.

## 6. Practical next-session boundary

Follow the current verification workflow above and inspect the installed Open GSD state for the next action. Preserve [the historical next-session prompt](../handoff/jssgdbc-next-session-prompt.md) and earlier airline-pilot handoff files without rewriting their transcripts. Do not treat this research roadmap as existing GSD state or import a different GSD workflow solely because it has similar command names.
