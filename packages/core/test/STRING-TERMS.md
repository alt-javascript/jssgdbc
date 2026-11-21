# Lossless string-term contract (M005)

This is the tested portable contract for the existing string API, not a public term-object API.

- Accept absolute IRI convenience strings (`urn:s`, `https://example.org/o`) and bracketed N-Triples IRIs. They identify the same RDF term. Graph result IRIs use unbracketed absolute strings; standalone file codec terms remain N-Triples surface syntax.
- Literal objects use double-quoted N-Triples syntax, optionally followed by a language tag or `^^<absolute-datatype-IRI>`. Never infer a literal from bare text, coerce a typed lexical value to a JS value, or strip its quotes. `"urn:o"` and `urn:o` are distinct terms.
- Subjects are IRIs or blank nodes; predicates are IRIs; objects may additionally be literals. Reject malformed terms and relative/bare shorthand rather than guessing.
- `null`/`undefined` are wildcards only in find/has/count/remove patterns. Add requires three bound valid terms. Remove is a pattern operation even though it mutates the graph.
- Blank nodes use `_:label`, scoped to their graph/dataset. Labels are not globally portable identifiers; separate imports or remote queries do not guarantee stable blank-node identity. No cross-document blank-node equivalence is promised.
- Plain `"text"` and `"text"^^<http://www.w3.org/2001/XMLSchema#string>` are RDF-equivalent; canonical results use plain quoted syntax. Language tags compare case-insensitively and canonical results use lowercase tags.
- Preserve decoded lexical content, including leading zeroes (`"001"^^<...#integer>`), delimiters inside quotes, escapes and Unicode. Equivalent escape spellings may normalize; numeric value equality must not collapse lexical identity.
- File parsing is strict N-Triples: exactly three terms, legal positions, a terminating dot, and only whitespace/comment afterward. Comments and blank lines are accepted; malformed lines fail with useful context.

## Portable shared assertions

`driverCompliance.js` exercises all eight bound/wildcard combinations for find, has, count and remove, with both null and undefined wildcards. An eight-triple Cartesian fixture verifies exact result membership and that removal preserves nonmatching triples. No-match removal is a no-op. Default and two named graphs must remain isolated through pattern removal and graph-local clear in both directions.

Lexical assertions distinguish IRI versus equal-content literal, integer lexical `001` versus `1`, plain versus language-tagged versus custom-datatype literals, different language tags, escaped delimiters and Unicode. Equivalent bracketed IRIs, escaped Unicode, language-tag case and plain/xsd:string terms deduplicate and match across operations. Existing default/named lifecycle assertions retain close/reacquire persistence and terminal-client rejection.

Blank-node cross-request identity is excluded from the portable shared suite: SPARQL result blank-node labels are scoped to the result, and update/import labels may allocate fresh nodes. A label returned by one request cannot safely identify the same stored node in a later request. Local blank-node support does not imply remote stable identity; use absolute IRIs for portable identities.

Factories must provide owned disposable storage, including the default graph (clear is deliberately exercised). New cases use UUID-scoped graph/subject identities, bounded fixtures of at most ten triples, and awaited finally cleanup. Resource-close errors remain visible through the shared cleanup hook. No production dataset should be supplied to this suite.

Memory/file and deterministic SPARQL harnesses invoke the shared generator through DriverManager. The loopback fixture recognizes only supported single-triple query/update shapes, including matching DELETE/WHERE patterns; it is not a SPARQL engine or live proof. Deterministic Neo4j tests likewise establish adapter behavior only. Real Neo4j and Jena acceptance remains S03 infrastructure work.
