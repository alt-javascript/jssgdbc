# @alt-javascript/jssgdbc-sparql

Triple-pattern access to a SPARQL HTTP endpoint.

Experimental, pre-publication workspace package. Run `npm ci` from the repository
root. Package imports below resolve through workspaces. Use ES modules and a
runtime providing native `fetch`, `Headers`, `AbortController`, `URL` and
`performance` (for example a maintained Node.js 22+ release). The package has no
`engines` constraint and does not install a fetch polyfill.

Importing the package auto-registers its driver once per module load. Obtain a
client with `DriverManager.getClient` (not `Client.getClient`), using the exact
prefix `jssgdbc:sparql:` followed by an HTTP(S) endpoint URL. If your application
clears the registry, explicitly register a new exported `SparqlDriver`.

## Read-only quick-start

Save this block as an ES module and call `readExample(endpoint, headers)` with a
trusted endpoint URL. It queries a fixed subject and predicate (without a
server-side result limit); the endpoint may return no matches. Optional headers
can contain your deployment's credentials, supplied securely at runtime, never
hardcoded or logged. `X-Example` below is only a harmless example header.

<!-- example:read-only -->
```javascript
import { DriverManager } from '@alt-javascript/jssgdbc-sparql';

export async function readExample(endpoint, headers = { 'X-Example': 'readme' }) {
  const client = await DriverManager.getClient(`jssgdbc:sparql:${endpoint}`, {
    headers, timeoutMs: 10000
  });
  let graph, cursor;
  try {
    graph = client.getGraph();
    cursor = await graph.find('http://dbpedia.org/resource/Berlin',
      'http://www.w3.org/2000/01/rdf-schema#label', null);
    const rows = [];
    while (await cursor.next()) rows.push(cursor.getTriple());
    return rows;
  } finally {
    cursor?.close();
    graph?.close();
    client.close();
  }
}
```

Endpoint configuration illustrations, **not certified or tested integrations**:

| Service | Endpoint argument |
| --- | --- |
| DBpedia (read-only example) | `https://dbpedia.org/sparql` |
| Wikidata (read-only; use Wikidata IRIs for useful results) | `https://query.wikidata.org/sparql` |
| Local Fuseki-style dataset | `http://127.0.0.1:3030/dataset/sparql` |

The second `getClient` argument is a configuration object: `headers` accepts
native Headers-compatible input; `timeoutMs` must be a positive finite number
and defaults to **30000** milliseconds. Protocol headers override supplied
`Accept` for queries and `Content-Type` for updates.

Queries use GET with a `query` parameter and request SPARQL JSON. Updates use
POST with raw `application/sparql-update` bodies to the **same URL**. Separate
query/update URLs, form POST queries and other transports are not supported by
this configuration. Check local server routing before enabling writes: a
Fuseki-style `/sparql` URL alone does not imply update support.

## Opt-in writable local example

**Never run this against a public read-only endpoint or valuable data.** Use a
trusted, disposable local dataset whose single URL supports both query and
update. Call `writeExample(endpoint, { allowWrites: true })` explicitly. It
clears the example named graph; it removes only its specific default-graph
triple. Do not use that triple or graph for other data.

<!-- example:writable -->
```javascript
import { DriverManager } from '@alt-javascript/jssgdbc-sparql';

export async function writeExample(endpoint, {
  allowWrites = false, headers = { 'X-Example': 'readme' }
} = {}) {
  if (!allowWrites) throw new Error('Writes require explicit opt-in');
  const client = await DriverManager.getClient(`jssgdbc:sparql:${endpoint}`, {
    headers, timeoutMs: 10000
  });
  let graph, named, cursor;
  try {
    graph = client.getGraph();
    named = client.getGraph('https://example.org/graphs/demo');
    const subject = 'https://example.org/items/demo';
    const predicate = 'http://www.w3.org/2000/01/rdf-schema#label';
    const object = '"Demo"@en';
    await graph.add(subject, predicate, object);
    await named.add(subject, predicate, object);
    cursor = await named.find(subject, predicate, null);
    const rows = [];
    while (await cursor.next()) rows.push(cursor.getTriple());
    const present = await named.has(subject, predicate, object);
    const count = await named.count(subject, predicate, null);
    await named.remove(subject, predicate, object);
    const afterRemove = await named.has(subject, predicate, object);
    await named.add(subject, predicate, object);
    await named.clear();
    const afterClear = await named.count();
    const defaultPreserved = await graph.has(subject, predicate, object);
    await graph.remove(subject, predicate, object);
    const defaultAfterRemove = await graph.has(subject, predicate, object);
    return { rows, present, count, afterRemove, afterClear,
      defaultPreserved, defaultAfterRemove };
  } finally {
    cursor?.close();
    named?.close();
    graph?.close();
    client.close();
  }
}
```

Closing handles is not rollback. If a step fails, previous writes can remain.

## Terms, graphs and handles

- Bare strings, including object strings, are IRIs, not string literals. Prefer
  absolute IRIs. Quoted RDF literals must use RDF syntax, e.g. `'"Hello"'`,
  `'"Bonjour"@fr'`, or `'"42"^^<http://www.w3.org/2001/XMLSchema#integer>'`.
  Preformatted `<IRI>`, `_:blankNode` and quoted terms pass through; this is not
  a general RDF validator or an escaping boundary for untrusted RDF input.
- `null` or omitted arguments are wildcards for find/has/count/remove.
  `add` requires all three terms. Wildcard remove generates DELETE/WHERE;
  fully bound remove generates DELETE DATA.
- `getGraph()` (or `getGraph('')`) addresses the default graph;
  `getGraph(absoluteGraphIri)` scopes operations to that named graph. Clear
  affects only the selected graph, not all graphs. Endpoint dataset policies
  can determine what a default query sees.
- URI results are bare strings; literal results retain quoted RDF syntax;
  blank-node results use `_:id`. A Cursor is **fully buffered**, not streaming.
  Iterate with `next()`/`getTriple()` or `for await`. Close cursors, graphs and
  clients in `finally`; closing a client prevents later graph operations but
  does not cancel already-running requests or close independent cursors.

## Failures, trust and capacity

Invalid endpoint URLs, properties, headers and timeouts reject early. URL
userinfo (`https://user:password@host/`) is forbidden. Redirects are rejected,
not followed. Use only trusted destinations, headers and RDF input. Enforce
host-level SSRF policy (destination allowlists, DNS/network egress controls);
HTTP(S)-only validation is not an SSRF defense.

Transport errors are sanitized: `SPARQL query: timeout failure`,
`SPARQL update: HTTP 403 failure`, `SPARQL query: network failure` (including
connection loss or redirect rejection), or `SPARQL query: JSON failure`.
Malformed result shapes reject as `SPARQL SELECT: invalid result`,
`SPARQL ASK: invalid result`, or `SPARQL COUNT: invalid result`. Check endpoint
routing/permissions for HTTP failures, availability for network failures, and
SPARQL JSON compatibility for JSON/result failures. Do not log credentials,
credential-bearing URLs or response bodies. Let errors propagate or handle
these categories at the application boundary.

There is no pagination, response-size limit, streaming, automatic retries or
concurrency limiter. Memory grows with response size and buffered triples;
concurrent requests multiply that cost. Timeouts bound I/O duration, not memory.
Use selective patterns, application concurrency limits and endpoint quotas.
A failed update can have an **unknown commit outcome**; do not blindly retry it.

The README examples and shared compliance tests run offline against a narrow
loopback HTTP fixture. These checks are not live-vendor validation and do not
establish vendor-relative-IRI behavior or endpoint availability.
