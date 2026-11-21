import assert from 'node:assert/strict';
import { DriverManager, SparqlDriver } from '@alt-javascript/jssgdbc-sparql';
import driverComplianceTests from '../../core/test/driverCompliance.js';
const origin = 'http://127.0.0.1:13330';
const clients = new Set();
describe('Owned Apache Jena/Fuseki portable contract', function () {
  this.timeout(30000);
  before(async () => {
    assert.match(process.env.JSSGDBC_DISPOSABLE_FUSEKI ?? '', /^jssgdbc-fuseki-[0-9a-f-]{36}$/, 'Use disposable runner');
    const response = await fetch(`${origin}/$/server`, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    const info = await response.json();
    assert.equal(info.version, '5.4.0', 'Actual Fuseki version must match pin');
    console.error(`Apache Jena/Fuseki actual version: ${info.version}`);
  });
  afterEach(async () => {
    const results = await Promise.allSettled([...clients].map(client => client.close()));
    clients.clear();
    DriverManager.clear();
    assert.ok(results.every(result => result.status === 'fulfilled'), 'client cleanup failed');
  });
  driverComplianceTests('Live Fuseki DriverManager compliance', async () => {
    assert.match(process.env.JSSGDBC_DISPOSABLE_FUSEKI ?? '', /^jssgdbc-fuseki-[0-9a-f-]{36}$/);
    DriverManager.clear();
    DriverManager.registerDriver(new SparqlDriver());
    const client = await DriverManager.getClient(`jssgdbc:sparql:${origin}/ds`, { timeoutMs: 10000 });
    clients.add(client);
    return client;
  });
});
