import neo4j from 'neo4j-driver';
import { DriverManager, Neo4jDriver } from '@alt-javascript/jssgdbc-neo4j';
import driverComplianceTests from '../../core/test/driverCompliance.js';

// No configurable URI: destructive reset is limited to the runner's disposable fixture.
const uri = 'bolt://127.0.0.1:17687';
const clients = new Set();

describe('Disposable Neo4j contract', function () {
  this.timeout(30000);

  afterEach(async function () {
    const results = await Promise.allSettled([...clients].map(client => client.close()));
    clients.clear();
    DriverManager.clear();
    if (results.some(result => result.status === 'rejected')) {
      throw new Error('Neo4j compliance client cleanup failed');
    }
  });

  driverComplianceTests('Neo4j shared driver compliance', async () => {
    if (!/^jssgdbc-test-[0-9a-f-]{36}$/.test(process.env.JSSGDBC_DISPOSABLE_NEO4J ?? '')) {
      throw new Error('Run compliance through the disposable integration runner');
    }
    const native = neo4j.driver(uri, undefined, { connectionTimeout: 2000, maxTransactionRetryTime: 0 });
    try {
      const session = native.session({ database: 'neo4j' });
      try {
        // Clear every graph, including default, graph1 and graph2, before each factory call.
        await session.run('MATCH (n:JssgdbcTerm) DETACH DELETE n', {}, { timeout: 10000 });
      } finally {
        await session.close();
      }
    } catch {
      throw new Error('Neo4j disposable fixture reset failed');
    } finally {
      try { await native.close(); } catch { throw new Error('Neo4j reset connection cleanup failed'); }
    }
    DriverManager.clear();
    DriverManager.registerDriver(new Neo4jDriver());
    const client = await DriverManager.getClient(`jssgdbc:neo4j:${uri}`, {
      database: 'neo4j', timeoutMs: 10000, connectionTimeoutMs: 2000,
    });
    clients.add(client);
    return client;
  });
});
