import { randomUUID } from 'node:crypto';
import { Client, createCapabilities, createQuad, snapshotTerm } from '@alt-javascript/jssgdbc-core';
import { Neo4jGraph } from './Neo4jGraph.js';
import { CypherBuilder } from './CypherBuilder.js';
import { CONSTRAINTS, INSPECT_SCHEMA, ENSURE_SCHEMA, SCHEMA_PARAMS, validateSchema,
  validateMarker, StorageCompatibilityError, decodeTriple, STORAGE_VERSION, STORAGE_PROFILE } from './RdfStorage.js';

const CAPABILITIES = createCapabilities({
  rdf11: { status: 'supported', detail: `Version ${STORAGE_VERSION} structural RDF storage/profile ${STORAGE_PROFILE}` },
  namedGraphs: { status: 'supported' }, defaultGraph: { status: 'supported' },
  blankNodeGraphs: { status: 'unavailable' }, rdfStar: { status: 'unavailable' }, variables: { status: 'unavailable' },
  persistence: { status: 'supported', detail: 'Persistent blank identity; fresh UUID blank scope per Dataset save' },
  transactions: { status: 'supported', detail: 'One managed write transaction per graph; Graph mutations and Dataset replacement share a graph lock' },
  crossGraphAtomicity: { status: 'unavailable', detail: 'Sequential per-graph commits; loads are not whole-Dataset snapshots' },
  streaming: { status: 'unavailable', detail: 'Buffered O(quads) preflight, parameters and reads; per-graph transaction size is caller bounded' },
  duplicateQuads: { status: 'unavailable', detail: 'Structural set semantics' }
});

// Never retain native errors: their messages/causes may contain credentials or data.
export function transportError(operation, error) {
  const code = typeof error?.code === 'string'
    && /^(?:Neo\.(?:ClientError|TransientError|DatabaseError)\.[A-Za-z]+\.[A-Za-z]+|ServiceUnavailable|SessionExpired)$/.test(error.code)
    ? error.code : undefined;
  const safe = new Error(`Neo4j ${operation} failed${code ? ` (${code})` : ''}`);
  if (code) safe.code = code;
  return safe;
}

/** Owns the native driver. Results are eager/buffered, not streaming cursors. */
export class Neo4jClient extends Client {
  constructor(driver, url, options, native) {
    super(driver, url, options);
    this._native = native;
    this._database = options.database;
    this._timeoutMs = options.timeoutMs;
    this._closePromise = null;
    this._operations = new Set();
  }

  _getGraph(name) {
    return new Neo4jGraph(this, name);
  }

  getCapabilities() { return CAPABILITIES; }

  async _initialize() {
    // Never issue DDL or write a marker until existing owned data passes admission.
    await this._execute('initialize', 'read', async tx => validateSchema(await tx.run(INSPECT_SCHEMA, {})));
    await this._execute('initialize', 'write', async tx => {
      for (const constraint of CONSTRAINTS) await tx.run(constraint, {});
    });
    await this._execute('initialize', 'write', async tx => {
      validateSchema(await tx.run(INSPECT_SCHEMA, {}));
      const result = await tx.run(ENSURE_SCHEMA, SCHEMA_PARAMS);
      if (!Array.isArray(result?.records) || result.records.length !== 1) throw new StorageCompatibilityError();
      validateMarker(result.records[0].get('marker'));
      validateSchema(await tx.run(INSPECT_SCHEMA, {}));
    });
  }

  _scopeDataset(quads) {
    const prefix = randomUUID(), blanks = new Map();
    const scope = term => {
      if (term.termType !== 'BlankNode') return term;
      if (!blanks.has(term.value)) blanks.set(term.value, snapshotTerm({ termType: 'BlankNode', value: `jssgdbc-${prefix}-${blanks.size}` }));
      return blanks.get(term.value);
    };
    return quads.map(q => createQuad(scope(q.subject), q.predicate, scope(q.object), q.graph));
  }

  async _loadDatasetGraph(graph) {
    const { query, params } = CypherBuilder.buildFind(graph);
    return this.#executeAdmitted('load Dataset', 'read', async tx => {
      const result = await tx.run(query, params);
      if (!Array.isArray(result?.records)) throw new Error();
      return result.records.map(row => {
        const aliases = ['subject', 'predicate', 'object'];
        if (!Array.isArray(row?.keys) || row.keys.length !== 3 || !aliases.every(k => row.keys.includes(k))) throw new Error();
        const triple = decodeTriple(Object.fromEntries(aliases.map(k => [k, row.get(k)])), graph);
        return createQuad(triple.subject, triple.predicate, triple.object, graph);
      });
    });
  }

  async _saveDatasetGraph(graph, quads, mode) {
    // Materialize once, outside the managed retry callback. Never rescope on retry.
    const statements = [CypherBuilder.buildLock(graph)];
    if (mode === 'replace') statements.push(CypherBuilder.buildClear(graph));
    for (const q of quads) statements.push(CypherBuilder.buildAdd(graph, q.subject, q.predicate, q.object));
    await this.#executeAdmitted('save Dataset', 'write', async tx => {
      for (const { query, params } of statements) await tx.run(query, params);
    });
  }

  async _query(query, params = {}) {
    return this._execute('query', 'read', async tx => {
      const result = await tx.run(query, params);
      if (!Array.isArray(result.records)) throw new Error();
      return result.records;
    });
  }

  async _update(query, params = {}) {
    await this._execute('update', 'write', async tx => {
      await tx.run(query, params);
    });
  }

  // Admission-checked composition seam for atomic lock + mutation. Callbacks may
  // be retried by the native driver and must not perform external side effects.
  async _execute(operation, mode, work) {
    if (this.isClosed()) throw new Error(`Neo4j ${operation}: client is closed`);
    return this.#executeAdmitted(operation, mode, work);
  }

  #executeAdmitted(operation, mode, work) {
    const pending = this.#run(operation, mode, work);
    this._operations.add(pending);
    pending.then(() => this._operations.delete(pending), () => this._operations.delete(pending));
    return pending;
  }

  async #run(operation, mode, work) {
    let session;
    let failure;
    let result;
    try {
      session = this._native.session({ database: this._database });
      result = await session[mode === 'read' ? 'executeRead' : 'executeWrite'](work, { timeout: this._timeoutMs });
    } catch (error) {
      failure = error instanceof StorageCompatibilityError ? error : transportError(operation, error);
    } finally {
      if (session) {
        try { await session.close(); }
        catch (error) {
          const cleanup = transportError('session close', error);
          failure = failure
            ? new AggregateError([failure, cleanup], `Neo4j ${operation} and session close failed`)
            : cleanup;
        }
      }
    }
    if (failure) throw failure;
    return result;
  }

  async _close() {
    // Core drains Dataset admissions and graph work first; include direct queries.
    await Promise.allSettled([...this._operations]);
    try { await this._native.close(); }
    catch (error) { throw transportError('close', error); }
  }
}
