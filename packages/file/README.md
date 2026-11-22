# @alt-javascript/jssgdbc-file

JSSGDBC driver for local RDF files. Stores each graph as N-Triples with
structural graph metadata, using atomic file replacement for writes.

## Install

Experimental `0.0.0` package, available only through the local npm workspace.
Run `npm ci` in the workspace before using the imports below. The package is
private and has a prepublish guard; no registry release is supported.

## Quick Start

Importing the package registers the file driver. Graph APIs accept RDF/JS terms, not strings or N-Triples surface syntax. Dataset edits are local until explicitly saved.

<!-- example:file-quickstart -->
```javascript
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import rdf from '@rdfjs/data-model';
import external from '@rdfjs/dataset';
import factory from '@alt-javascript/jssgdbc-dataset';
import '@alt-javascript/jssgdbc-file';
import { DriverManager } from '@alt-javascript/jssgdbc-core';

const owned = !process.env.JSSGDBC_EXAMPLE_DIR;
const directory = process.env.JSSGDBC_EXAMPLE_DIR ??
  await mkdtemp(join(await realpath(process.cwd()), '.readme-file-'));
const url = `jssgdbc:file:${directory}`;
const g = rdf.namedNode('urn:people'), s = rdf.namedNode('urn:alice');
const p = rdf.namedNode('urn:code');
const integer = rdf.namedNode('http://www.w3.org/2001/XMLSchema#integer');
const input = external.dataset([
  rdf.quad(s, p, rdf.literal('001', integer), g),
  rdf.quad(s, p, rdf.literal('1', integer), g)
]);
let client, cursor;
try {
  client = await DriverManager.getClient(url);
  await client.saveDataset(input, { graphs: [g], mode: 'merge' });
  const local = await client.loadDataset({ graphs: [g], factory });
  local.deleteMatches();
  assert.equal(await client.getGraph(g).count(), 2);
  await client.close();
  client = await DriverManager.getClient(url);
  assert((await client.loadDataset({ graphs: [g], factory })).equals(input));
  const graph = client.getGraph(g);
  assert(await graph.has(s, p, rdf.literal('001', integer)));
  cursor = await graph.find(s, p);
  await client.saveDataset(local, { graphs: [g], mode: 'replace' });
  assert.equal(await graph.count(), 0);
  await graph.close();
  assert.notEqual(client.getGraph(g), graph);
  await client.close();
  await client.close();
  assert.throws(() => client.getGraph(), /closed/i);
  assert.equal(await cursor.next(), true); // Detached snapshot survives closure.
  assert.equal(cursor.getTriple().object.value, '001');
} finally {
  try {
    try { await cursor?.close(); }
    finally { await client?.close(); }
  } finally {
    if (owned) await rm(directory, { recursive: true, force: true });
  }
}
```

Run `node test/verify-file-quickstart.js` for this unchanged example and
`node test/verify-dataset-file.js` for independent-factory persistence acceptance.
These are local file proofs, not remote-adapter validation.

## Typed API and identity

`client.getGraph()` selects DefaultGraph; `getGraph(rdf.namedNode('urn:g'))`
selects a named graph. DefaultGraph and NamedNode identities remain distinct.
All Graph CRUD is asynchronous: `add(s,p,o)`, `remove(s,p,o)`, `find(s,p,o)`,
`has(s,p,o)`, `count(s,p,o)` and `clear()`. Null/undefined wildcards are supported
only in matching operations, not add. Results contain RDF/JS terms. Literal
lexical forms (including distinct integer spellings), datatypes and languages
survive persistence; RDF-equivalent language casing is normalized.

`loadDataset({ graphs, factory })` returns an independent Dataset from an explicit
nonempty graph selection. `saveDataset(dataset, { graphs, mode })` snapshots and
validates all input before I/O. Mode defaults to `merge`; `replace` replaces only
the selected graphs, including clearing them when input is empty. Input quads
outside the selection reject. Unrelated graphs are not modified.

Each save freshens blank nodes once across the entire input, retaining sharing
between selected graphs. Repeated imports, even after reopen, get fresh labels.
Direct Graph operations instead preserve supplied blank identity; they can address
persisted labels returned by reads. Do not treat imported labels as global IDs.
The file codec reversibly encodes arbitrary accepted blank labels and disables
parser freshening, preserving sharing across separate files.

## Connection URL and Storage

The URL is `jssgdbc:file:<directory>`. A missing directory is created lazily.
Canonical RDF graph keys are hashed into bounded `v2-<sha256>` directories;
graph names never become path components. Each contains exact version-2
`identity.json` metadata (`version` and `graph: { termType, value }`) and an
optional `graph.nt`. Metadata and persisted RDF are validated, not trusted.

Recognized v1 directories, unsupported/malformed reserved version names,
unversioned RDF files (including legacy `default.nt`), missing/malformed metadata
and identity mismatches reject without automatic migration, reset or deletion.
Back up old storage first. To explicitly reset experimental storage, stop all
writers, retain the backup/old directory, and point the client at a new empty
trusted directory. Any removal of old data is a separate user-controlled action;
the adapter does not perform it or offer automatic conversion.

Root ancestors, graph directories and file leaves are checked with lstat;
symlinks and special files reject. Opens use no-follow where supported. Temporary
files are created exclusively; only owned temporaries are eligible for cleanup.
Identity and paths are revalidated before atomic rename over the payload.
The root and ancestors must be controlled by trusted owners: these checks are
not a sandbox against concurrent hostile directory replacement.

## Failure recovery and lifecycle

One serial queue per graph identity is shared by Graph handles and Dataset hooks
within a client. Candidate state is published only after persistence succeeds.
Read/parse/serialization failures propagate without publishing partial state.
Pre-rename failures preserve the old payload. A write can reject after rename:
its outcome is uncertain, not necessarily rolled back. Rejected writes invalidate
the cache; the next read reloads disk for reconciliation. Never blindly retry an
unknown save, especially because imports freshen blanks.

`DatasetSaveError` retains its original `cause` and ordered graph outcomes:
`committed`, `unknown`, `not-attempted`. Reload affected graphs, inspect actual
state, and explicitly reconcile before deciding on a new save. Storage errors
carry operation/key context; nested native causes may contain filesystem paths.
Cleanup failure retains both primary and cleanup errors in `AggregateError.errors`.
There is no cross-graph rollback or transaction.

Await idempotent Graph/client close in finally blocks. Close drains admitted work,
including Dataset I/O, rather than cancelling or deleting data. An open client can
reacquire a closed graph handle; closed clients are terminal. Detached buffered
cursors remain usable after close and have their own close method.

## Limitations

`client.getCapabilities()` returns a deeply immutable versioned description.
Typed RDF, default/named graphs and persistence are supported; transactions,
cross-graph atomicity and streaming are unavailable.

Loads materialize selected graphs and the returned Dataset. Saves buffer the
input, graph candidates, serialization and retained committed state; query
cursors add result-sized memory. Whole-file I/O is roughly linear in selected
data size (roughly 10x bytes at 10x data), not a throughput guarantee; metadata
compatibility scans also depend on the number of stored graphs. Memory and disk
bandwidth are the first likely constraints. No size limit, backpressure,
streaming or cancellation mechanism is imposed; bound input externally.

Queues coordinate only one client. There is no multiwriter isolation across
clients/processes, no cross-graph transaction and no fsync/power-loss durability
guarantee. Use one writer or external synchronization. Deterministic codec tests
are not a claim of exhaustive N-Triples conformance.

## License

MIT License — see LICENSE file for details.
