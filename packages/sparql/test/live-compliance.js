import assert from 'node:assert/strict';
import { DriverManager, SparqlDriver } from '@alt-javascript/jssgdbc-sparql';
import { typedGraphComplianceTests } from './helpers/typed-graph-compliance.js';
import { datasetCompliance } from '../../core/test/datasetCompliance.js';
import rdf from '@rdfjs/data-model';
import external from '@rdfjs/dataset';
import { factory } from '@alt-javascript/jssgdbc-dataset';
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
  async function connect() {
    assert.match(process.env.JSSGDBC_DISPOSABLE_FUSEKI ?? '', /^jssgdbc-fuseki-[0-9a-f-]{36}$/);
    DriverManager.clear();
    DriverManager.registerDriver(new SparqlDriver());
    const client = await DriverManager.getClient(`jssgdbc:sparql:${origin}/ds`, { timeoutMs: 10000 });
    clients.add(client);
    // Destructive reset is permitted only inside the guarded owned service.
    const reset = await fetch(`${origin}/ds/update`, {
      method: 'POST', headers: { 'Content-Type': 'application/sparql-update' },
      body: 'CLEAR ALL', signal: AbortSignal.timeout(10000)
    });
    await reset.text();
    assert.ok(reset.ok, 'owned fixture reset failed');
    return client;
  }
  typedGraphComplianceTests('Live Fuseki DriverManager compliance', connect);
  it('preserves the independent Dataset contract including lexical integers and cross-graph blanks', async () => {
    await datasetCompliance(await connect(), rdf, external, factory);
  });
  it('allocates fresh response blank scopes without losing shared identity', async () => {
    const client = await connect();
    const d = rdf.defaultGraph(), g = rdf.namedNode('urn:scope:g');
    const b = rdf.blankNode('shared'), p = rdf.namedNode('urn:p');
    const input = external.dataset([rdf.quad(b, p, b, d), rdf.quad(b, p, b, g)]);
    await client.saveDataset(input, { graphs: [d, g] });
    const first = await client.loadDataset({ graphs: [d, g], factory });
    const second = await client.loadDataset({ graphs: [d, g], factory });
    assert(first.equals(input));
    assert(second.equals(input));
    assert.notEqual([...first][0].subject.value, [...second][0].subject.value);
  });
});
