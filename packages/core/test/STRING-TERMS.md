# Lossless string-term contract (M005)

This is the target contract for the existing string API, not a public term-object API.

- Accept absolute IRI convenience strings (`urn:s`, `https://example.org/o`) and bracketed N-Triples IRIs. They identify the same RDF term. Graph result IRIs use unbracketed absolute strings; standalone file codec terms remain N-Triples surface syntax.
- Literal objects use double-quoted N-Triples syntax, optionally followed by a language tag or `^^<absolute-datatype-IRI>`. Never infer a literal from bare text, coerce a typed lexical value to a JS value, or strip its quotes. `"urn:o"` and `urn:o` are distinct terms.
- Subjects are IRIs or blank nodes; predicates are IRIs; objects may additionally be literals. Reject malformed terms and relative/bare shorthand rather than guessing. Legacy compliance fixtures such as `s1`, `p1`, `o1` predate this contract and need migration in T03.
- `null`/`undefined` are wildcards only in find/has/count/remove patterns. Add requires three bound valid terms. Remove is a pattern operation even though it mutates the graph.
- Blank nodes use `_:label`, scoped to their graph/dataset. Labels are not globally portable identifiers; separate imports or remote queries do not guarantee stable blank-node identity. No cross-document blank-node equivalence is promised.
- Plain `"text"` and `"text"^^<http://www.w3.org/2001/XMLSchema#string>` are RDF-equivalent; canonical results use plain quoted syntax. Language tags compare case-insensitively and canonical results use lowercase tags. Existing SPARQL mixed-case decoder tests need adjustment in T03, not wholesale decoder replacement.
- Preserve decoded lexical content, including leading zeroes (`"001"^^<...#integer>`), delimiters inside quotes, escapes and Unicode. Equivalent escape spellings may normalize; numeric value equality must not collapse lexical identity.
- File parsing is strict N-Triples: exactly three terms, legal positions, a terminating dot, and only whitespace/comment afterward. Comments and blank lines are accepted; malformed lines fail with useful context.

The new regressions intentionally fail on the unchanged implementation. Deterministic SPARQL and Neo4j tests establish adapter behavior only, not live endpoint proof. Live proof remains S03 work.
