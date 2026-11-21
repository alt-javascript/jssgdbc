# Next agentic session — JSSGDBC / Open GSD

Paste the following into a new session opened at the JSSGDBC repository root.

---

Return to the local JSSGDBC library. The public repository is experimental and I am not ready to publish. Do not publish packages, create release tags, push, deploy, or initiate the airline knowledge service. Apache Jena is not the organizing dependency for this work.

Read `docs/jssgdbc-trajectory.md`, the current READMEs, and the actual `.gsd` project/state/requirements/decisions. The trajectory document is a proposal informed by a code and ecosystem scan, not an already registered milestone. The installed system is Open GSD; discover and use its real workflow/state tools. Do not replace it with a different GSD implementation or hand-edit generated projections/receipts to pretend progress occurred. `.gsd` may be an external symlink; respect its ownership and filesystem permissions.

## Intended direction

JSSGDBC remains a small, capability-aware semantic graph connectivity library. Its role is typed terms, reliable graph operations, lifecycle, query/result contracts and backend interoperability. Claims, citations, review policy, temporal knowledge, LLM extraction and distributed agent workflows belong above it.

Candidate milestone sequence, pending reconciliation with actual GSD numbering:

1. M005: trustworthy experimental baseline — codec correctness, lifecycle, graph/file safety, conformance, docs and package metadata.
2. M006: RDF/JS-aligned explicit terms and capability discovery, with a documented migration policy.
3. M007: richer queries, endpoint flexibility and bounded bulk/result handling.
4. M008: live interoperability and selective Memgraph/FalkorDB adapters; Stardog via proven SPARQL/provider capabilities.
5. M009: optional ontology/reasoning/validation providers and one provenance-aware consumer example.

Only plan and execute the first milestone in detail now. Keep later milestones provisional. Finish the authorized M005 work through implementation and verification; do not stop at a plan unless a concrete decision or external prerequisite truly blocks progress.

## Known baseline and findings

At inspected commit `84d5f2e`, M001–M004 are recorded complete in `.gsd/STATE.md`; `.gsd/PROJECT.md` has stale M004 closeout text. Actual packages: core, memory, file, SPARQL, Neo4j.

The previous session ran `npm test`: 38 core + 9 memory + 59 file + 296 SPARQL + 330 Neo4j unit tests = 732 passing. Localhost HTTP fixtures require permission in restrictive sandboxes. Live Neo4j integration was not rerun in that session; no live SPARQL vendor compatibility was newly established.

Confirmed probes found:

- The low-level file serializer rejects bare `Alice`; public FileGraph wraps bare strings as IRIs, SPARQL also formats them as IRIs, and memory stores strings unchanged. FileGraph strips plain-literal quotes on results, losing the distinction between a literal and an IRI with the same bare value.
- Quoted literal content containing `@` or `^^` is split incorrectly by the file serializer.
- Emoji serialization emits surrogate escapes rather than handling the Unicode code point correctly.
- The N-Triples parser silently ignores a fourth term before the terminator.
- A retained memory graph accepts writes after its client closes, unlike remote adapters.

Inspect and address:

- Graph names directly interpolated into file paths: define safe encoding, containment, graph identity and migration.
- Reacquisition of closed cached graph handles and consistent awaitable cleanup.
- Shared compliance fixtures using non-absolute pseudo-IRIs and incomplete cross-driver coverage.
- SPARQL preformatted-term pass-through and semantic validation boundaries.
- Registration side-effect package metadata (SPARQL `sideEffects: false`, memory/file entrypoint mismatch).
- Workspace package publish settings: root `private` is not an individual-package publishing lock. Keep pre-publication intent explicit and implement a suitable local guardrail without any registry operation.

Reproduce findings before fixing them. Add meaningful regressions that would fail for the observed bugs, not tests mirroring implementation. Prefer an established RDF parser/serializer where that reduces correctness risk, but preserve the dependency-free memory requirement unless a deliberate decision supersedes it. Specify legacy data/API compatibility and do not silently change term identity under the guise of a bug fix.

## Existing working-tree changes to preserve

The previous session refreshed root/package READMEs, wrote `docs/jssgdbc-trajectory.md`, and added this prompt. Earlier `handoff/conversation-transcript.md` and `handoff/local-knowledge-pilot-plan.md` capture the separate airline pilot. These may be uncommitted; inspect `git status` and preserve them. Do not include airline organisational details in general library examples. Use synthetic fixtures.

## First actions and delivery criteria

1. Inspect repository instructions, working tree and Open GSD tooling; identify the canonical state and available milestone IDs.
2. Reproduce the baseline and targeted codec/lifecycle behaviours.
3. Register the next milestone with explicit requirements, slices and verification gates through the actual workflow.
4. Execute the bounded M005 slices, keeping API changes intentional and documented.
5. Run the appropriate regression and compliance suites. Distinguish mock/local fixtures from live backend tests, and report unavailable infrastructure accurately.
6. Reconcile docs and canonical GSD state; summarize changes, verification and remaining limitations. Commit according to the repository/workflow conventions, but do not push or publish.

M005 is complete only when the demonstrated bugs have regression coverage, supported inputs retain their documented meaning, graph/path/lifecycle behaviour is coherent, package registration/pre-publication intent is clear, and documentation matches the verified implementation. Do not begin additional backend drivers just because the current unit suite is green.

## Ecosystem interpretation

Graphiti is an application-layer temporal graph framework, not an SPO driver. `gsd-graph` and `ai-knowledge-graph` are candidate consumers/import sources, not substitutes for database conformance. Stardog is a semantic backend; Memgraph/FalkorDB are property-graph backend candidates requiring exact compatibility tests. Bolt/Cypher support does not prove that our Neo4j constraint/locking/schema assumptions transfer. RDF/JS is the key interface comparison before inventing typed terms or query results.

The user mentioned Andromeda without a URL. Identification remains unresolved. Do not guess that it means ArangoDB or an unrelated coding harness. This does not block M005.

Source links and the reasoning behind the milestone order are in `docs/jssgdbc-trajectory.md`. Reverify version-sensitive details when implementing a backend; the scan is not a compatibility certification.
