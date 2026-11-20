import { Client } from '@alt-javascript/jssgdbc-core';
import { SparqlGraph } from './SparqlGraph.js';

const URL_PREFIX = 'jssgdbc:sparql:';

/** Buffered HTTP transport. Timeouts bound I/O duration, not response memory. */
export class SparqlClient extends Client {
  constructor(driver, url, properties = {}) {
    super(driver, url, properties);
    try {
      if (typeof url !== 'string' || !url.startsWith(URL_PREFIX)) throw new Error();
      this._endpoint = new URL(url.slice(URL_PREFIX.length));
      if (!['http:', 'https:'].includes(this._endpoint.protocol)
          || this._endpoint.username || this._endpoint.password) throw new Error();
    } catch {
      throw new Error('Invalid SPARQL endpoint URL');
    }
    if (properties === null || typeof properties !== 'object') {
      throw new Error('Invalid SPARQL properties');
    }
    this._timeoutMs = properties.timeoutMs === undefined ? 30000 : properties.timeoutMs;
    if (typeof this._timeoutMs !== 'number' || !Number.isFinite(this._timeoutMs) || this._timeoutMs <= 0) {
      throw new Error('SPARQL timeoutMs must be a positive finite number');
    }
    try {
      this._headers = new Headers(properties.headers);
    } catch {
      throw new Error('Invalid SPARQL headers');
    }
  }

  _getGraph(name) {
    return new SparqlGraph(this, name);
  }

  async _query(text) {
    return this._request('query', text);
  }

  async _update(text) {
    await this._request('update', text);
  }

  async _request(operation, text) {
    if (this.isClosed()) throw new Error(`SPARQL ${operation}: client is closed`);
    const controller = new AbortController();
    const deadline = performance.now() + this._timeoutMs;
    let timer;
    // Chunk large timeouts to avoid Node's signed 32-bit timer overflow.
    const arm = () => {
      const remaining = deadline - performance.now();
      if (remaining <= 0) controller.abort();
      else timer = setTimeout(arm, Math.min(remaining, 2147483647));
    };
    arm();
    let category = 'network';
    try {
      const url = new URL(this._endpoint);
      const headers = new Headers(this._headers);
      const options = { headers, redirect: 'error', signal: controller.signal };
      if (operation === 'query') {
        url.searchParams.set('query', text);
        headers.set('Accept', 'application/sparql-results+json');
        options.method = 'GET';
      } else {
        headers.set('Content-Type', 'application/sparql-update');
        options.method = 'POST';
        options.body = text;
      }
      const response = await fetch(url, options);
      if (!response.ok) {
        category = `HTTP ${response.status}`;
        // Do not retain or expose an error response body.
        await response.body?.cancel();
        throw new Error();
      }
      // Reading separately distinguishes broken transport from invalid JSON.
      const body = await response.text();
      if (operation === 'query') {
        category = 'JSON';
        return JSON.parse(body);
      }
      return undefined;
    } catch {
      throw new Error(`SPARQL ${operation}: ${controller.signal.aborted ? 'timeout' : category} failure`);
    } finally {
      clearTimeout(timer);
    }
  }
}
