import { Client } from '@alt-javascript/jssgdbc-core';
import { Neo4jGraph } from './Neo4jGraph.js';
import { CONSTRAINTS } from './RdfStorage.js';

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
  }

  _getGraph(name) {
    return new Neo4jGraph(this, name);
  }

  async _initialize() {
    await this._execute('initialize', 'write', async tx => {
      for (const constraint of CONSTRAINTS) await tx.run(constraint, {});
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

  // Internal composition seam for atomic lock + mutation in T02. Callbacks may
  // be retried by the native driver and must not perform external side effects.
  async _execute(operation, mode, work) {
    if (this.isClosed()) throw new Error(`Neo4j ${operation}: client is closed`);
    let session;
    let failure;
    let result;
    try {
      session = this._native.session({ database: this._database });
      result = await session[mode === 'read' ? 'executeRead' : 'executeWrite'](work, { timeout: this._timeoutMs });
    } catch (error) {
      failure = transportError(operation, error);
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
    // Core waits for every owned graph (and its sessions) before release.
    try { await this._native.close(); }
    catch (error) { throw transportError('close', error); }
  }
}
