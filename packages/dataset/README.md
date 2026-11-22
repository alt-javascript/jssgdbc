# @alt-javascript/jssgdbc-dataset

Optional, buffered, synchronous **full RDF/JS Dataset** package. Core and memory have no dependency on this package. This workspace remains private and publish-guarded like the other workspaces.

```js
import rdf from '@alt-javascript/jssgdbc-dataset'
const local = rdf.dataset([
  rdf.quad(rdf.blankNode('a'), rdf.namedNode('urn:p'), rdf.literal('hello'))
])
const edited = local.map(q => rdf.quad(q.subject, q.predicate, rdf.literal('edited'), q.graph))
console.log(edited.toCanonical()) // synchronous canonical N-Quads
```

Exports: default/named `factory` implements DataFactory and DatasetFactory; named `dataset(quads?)` and `Dataset`. All Dataset-producing methods return this package's full Dataset, not DatasetCore. The independent N3 `DataFactory` and `Store` are exercised as inputs. Local edits have no persistence effects. Memory persistence integration is a separate task.

## Pinned contract and supported profile

- RDF/JS Dataset **1.0**, https://rdf.js.org/dataset-spec/; audited source revision [`4bb0ed9b0180c4790f58bd1e3df1967c4eee0a86`](https://github.com/rdfjs/dataset-spec/tree/4bb0ed9b0180c4790f58bd1e3df1967c4eee0a86).
- RDF/JS Data Model source revision [`65d5f5340b2e55a19be8f4b4562ea40f987fb44e`](https://github.com/rdfjs/data-model-spec/tree/65d5f5340b2e55a19be8f4b4562ea40f987fb44e), **RDF 1.1 quad profile**: NamedNode (absolute IRI), BlankNode, Literal (lexical value, language and datatype), DefaultGraph and Quad. No RDF-star/nested quads, variables in stored quads, directional literals, or generalized RDF. Subjects are named/blank nodes, predicates named nodes, objects named/blank/literal nodes, graphs named/blank/default nodes. This local Dataset supports blank graph names even if a persistence adapter does not.
- DataFactory exposes `namedNode`, `blankNode`, `literal`, `variable`, `defaultGraph`, `quad`, `fromTerm`, `fromQuad`; variable construction is supported by the factory, but variable storage is rejected explicitly. Omitted quad graph is DefaultGraph. Dataset rejects unsupported terms with TypeError rather than serializing them ambiguously.
- `match`/`deleteMatches` accept null or undefined wildcards in all four positions. A Term in an impossible position is a non-match, not a wildcard. Return order is unspecified. Duplicates are eliminated by RDF term equality, preserving distinct literal lexical forms and graph identity.
- Inputs are copied into the indexed core, including foreign implementations with proprietary `id` fields. Caller objects are not mutated. As RDF/JS requires, consumers must treat returned terms as immutable. Callbacks iterate a snapshot; mutation of the receiving Dataset during callback execution does not extend that traversal.

## Normative method matrix

Audited against the pinned IDL and method prose, including DatasetCore inheritance. `test/dataset.test.js` contains executable cases; `test/contract.test.js` guards this inventory, exact dependencies/licenses and packaging. This is the full method surface, not a DatasetCore-only claim. The table also includes the `toString` N-Quads convenience extension; it is not a normative Dataset 1.0 method.

| Member | Return | Coverage in dataset.test.js |
| --- | --- | --- |
| size | number | Core size, duplicate elimination |
| Symbol.iterator | Iterator<Quad> | Core size, iterator |
| add | this | Core identity, foreign copies, duplicates |
| delete | this | Core identity, absent deletion |
| has | boolean | Core identity, copied foreign quad |
| match | Dataset | all positions, null/undefined, DefaultGraph vs NamedNode, independent output |
| addAll | this | foreign Store/array, source immutability |
| contains | boolean | asymmetric embedded subset, backtracking, injective renaming, repeated blanks, graph sharing |
| deleteMatches | this | wildcard and graph-specific deletion |
| difference | Dataset | pure set operations, exact blank labels |
| equals | boolean | renamed blanks, graph sharing, independent Store, lexical distinctions |
| every | boolean | callback (quad, dataset), short circuit, empty true |
| filter | Dataset | callback, independent result |
| forEach | undefined | callback (quad, dataset), error propagation |
| import | Promise<Dataset> | object stream, identity, empty, duplicate, error and premature close |
| intersection | Dataset | pure set operations, exact blank labels |
| map | Dataset | callback (quad, dataset), deduplication, malformed output |
| reduce | any | (accumulator, quad, dataset), omitted initial, explicit undefined, empty error |
| some | boolean | callback (quad, dataset), short circuit, empty false |
| toCanonical | string | synchronous RDFC-1.0, pinned W3C vectors, complexity failure |
| toStream | Stream | object-mode snapshot, end, no implicit mutation |
| toString | string | parseable N-Quads including named graphs, escapes, literal distinctions |
| union | Dataset | pure set operations, exact blank labels |
| dataset | Dataset | factory optional iterable, empty, external Store |

`equals` compares canonical representations; `contains` searches for an **injective** blank-node renaming of the smaller dataset into the receiver, preserving sharing across every quad position and graph. Blank nodes cannot match fixed named nodes. Independently canonicalizing a subset and a larger graph is not a valid containment algorithm. Candidate pruning and an iterative depth-first search implement this embedding test; no ad-hoc canonicalization is used. The ordinary set operations deliberately use exact term equality, not isomorphism.

`reduce(fn, initialValue?)` follows Array semantics (including a TypeError on empty input with no initial value). Callback exceptions propagate. `import(stream)` is asynchronous only because the standard requires stream ingestion; all computational Dataset methods are synchronous. Node readable object streams are supported through their async iterator. Stream errors/premature close reject the promise; already admitted quads remain present (not transactional). `toStream()` takes a buffered snapshot at call time and respects Node consumption/backpressure. No network, subprocess or filesystem access occurs at runtime. Streams that never end remain pending; callers own cancellation/timeouts.

## Algorithms, exact releases and license audit

Inspected npm release metadata and installed license files, 2026-11-21. Runtime versions are exact and locked, including the normalizer's transitive canonicalizer to prevent accidental drift of its internal integration.

| Dependency | Exact release | License | Role |
| --- | --- | --- | --- |
| @rdfjs/dataset | 2.0.3 | MIT | Proven indexed DatasetCore foundation |
| @rdfjs/data-model | 2.1.2 | MIT | RDF/JS DataFactory and copied terms |
| @rdfjs/normalize | 2.0.4 | MIT | Maintained synchronous public normalization wrapper |
| rdf-canonize | 5.0.0 | BSD-3-Clause | RDFC-1.0 implementation used by that wrapper |
| @rdfjs/to-ntriples | 3.0.1 | MIT | N-Quads serialization (despite package name) |
| n3 | 2.13.12 | MIT | Dev-only independent DataFactory/Store/parser fixtures |

Candidate inspection also considered `rdf-ext@2.6.0` (MIT), whose Dataset extends DatasetCore, and `rdf-dataset-ext@1.1.0` (MIT) with the older `rdf-canonize@^1.0.0` path. Neither is adopted wholesale: we need explicit adversarial containment coverage and a narrow dependency surface. `rdf-canonize@5.0.0` explicitly discourages direct use of its private `_canonizeSync` API; this package does not call it. Instead it calls the maintained public `@rdfjs/normalize@2.0.4` function, whose release owns integration with `RDFC10Sync`. That wrapper enforces `maxDeepIterations: 500`; options cannot override it. RDFC-1.0 is the current standardized successor to the normalization algorithm referenced by Dataset 1.0. This is not a claim of arbitrary RDF 1.2 support or unbounded canonicalization success.

Selected official W3C vectors are vendored under `test/fixtures/` from `w3c/rdf-canon` commit `5ffaaa13c0e19a2a2f9e60d0ecd9efaf3edab633`, under the W3C Software and Document License (see fixtures/LICENSE.md): 003, 020, 044, 057, 060, 076, 077 and negative poison input 074. They cover blank topology, named graphs, escaping and duplicate removal. They are a selected conformance sample, not the entire W3C suite.

## Failure modes and load limits

This is an in-memory package, not a streaming database. Storage, callback snapshots, serializers and stream snapshots scale with dataset size. Representative ground-quad tests exercise 1,000 and 10,000 quads and report time/heap diagnostics, without machine-dependent performance assertions. Ground containment uses indexed membership checks. Blank-containing candidate construction is O(pattern × target); candidate lists and mapping snapshots consume memory. Blank-node embedding can be exponential on adversarial graphs. Its iterative search avoids recursion stack exhaustion but has **no timeout/work budget** and can block the event loop. Use a worker with an external time/memory limit for large or untrusted inputs; do not expose these operations directly on an untrusted request path.

Canonicalization has an upstream 500-deep-iteration guard; exceeding it throws, including from `equals`, rather than silently returning false. The official poison graph verifies propagation and source immutability. There is no fallback to label-based equality. Invalid RDF terms fail with TypeError; stream failures preserve their original error object. Missing runtime modules fail normally at module import. Dependency availability is an installation concern, not a runtime network service. The repository audit currently reports pre-existing Mocha/serialize-javascript development advisories; no automatic broad dependency upgrades are made by this package.

Run `npm test --workspace=packages/dataset`. Tests are offline after install and use only repository fixtures. A full repository test also includes this optional workspace; core/memory runtime dependency lists remain untouched.
