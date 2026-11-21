import neo4j from 'neo4j-driver';
import { Driver } from '@alt-javascript/jssgdbc-core';
import { Neo4jClient, transportError } from './Neo4jClient.js';

function nativeURI(url) {
  try {
    if (typeof url !== 'string' || !url.startsWith(Neo4jDriver.URL_PREFIX)) throw new Error();
    const uri = url.slice(Neo4jDriver.URL_PREFIX.length);
    if (!/^(bolt|neo4j)(\+s|\+ssc)?:\/\//.test(uri) || /[\s\\]/.test(uri)) throw new Error();
    const parsed = new URL(uri);
    if (!parsed.hostname || parsed.username || parsed.password || uri.includes('@')
        || parsed.hash || (parsed.pathname && parsed.pathname !== '/')
        || (parsed.port && (Number(parsed.port) < 1 || Number(parsed.port) > 65535))) throw new Error();
    return uri;
  } catch { throw new Error('Invalid Neo4j URL'); }
}

function optionsFrom(properties) {
  try {
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(properties))) throw new Error();
    const allowed = ['username', 'password', 'database', 'timeoutMs', 'connectionTimeoutMs'];
    for (const key of Reflect.ownKeys(properties)) {
      if (!allowed.includes(key) || !('value' in Object.getOwnPropertyDescriptor(properties, key))) throw new Error();
    }
    const options = { ...properties };
    if (options.username !== undefined || options.password !== undefined) {
      if (typeof options.username !== 'string' || !options.username.length
          || typeof options.password !== 'string' || !options.password.length) throw new Error();
    }
    if (options.database !== undefined && (typeof options.database !== 'string' || !options.database.trim())) throw new Error();
    options.timeoutMs ??= 30000;
    options.connectionTimeoutMs ??= 10000;
    for (const key of ['timeoutMs', 'connectionTimeoutMs']) {
      if (properties[key] === null || !Number.isSafeInteger(options[key]) || options[key] <= 0 || options[key] > 2147483647) throw new Error();
    }
    return options;
  } catch { throw new Error('Invalid Neo4j properties'); }
}

export class Neo4jDriver extends Driver {
  static URL_PREFIX = 'jssgdbc:neo4j:';

  // Narrow test seam; normal construction always uses the official driver.
  constructor(nativeDriverFactory = neo4j.driver) {
    super();
    this._nativeDriverFactory = nativeDriverFactory;
  }

  acceptsURL(url) {
    return typeof url === 'string' && url.startsWith(Neo4jDriver.URL_PREFIX);
  }

  async connect(url, properties = {}) {
    const uri = nativeURI(url);
    const options = optionsFrom(properties);
    let native;
    let client;
    let operation = 'connect';
    try {
      const auth = options.username === undefined ? undefined : neo4j.auth.basic(options.username, options.password);
      native = this._nativeDriverFactory(uri, auth, {
        connectionTimeout: options.connectionTimeoutMs,
        connectionAcquisitionTimeout: options.connectionTimeoutMs,
        maxTransactionRetryTime: options.timeoutMs,
        maxConnectionPoolSize: 100
      });
      // Do not retain credentials in the facade's properties.
      client = new Neo4jClient(this, url, {
        database: options.database, timeoutMs: options.timeoutMs,
        connectionTimeoutMs: options.connectionTimeoutMs
      }, native);
      await native.verifyConnectivity({ database: options.database });
      operation = 'initialize';
      await client._initialize();
      return client;
    } catch (error) {
      const failure = transportError(operation, error);
      try {
        if (client) await client.close();
        else if (native) await native.close();
      } catch { /* Preserve the initialization failure, not cleanup failure. */ }
      throw failure;
    }
  }
}
