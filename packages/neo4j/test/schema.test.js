import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Neo4jDriver } from '../Neo4jDriver.js';
import { INSPECT_SCHEMA, ENSURE_SCHEMA, SCHEMA_PARAMS, CONSTRAINTS } from '../RdfStorage.js';

const row = value => ({ records: [{ get: key => value[key] }] });
function fixture(state) {
  const calls = [], closes = [];
  const native = {
    async verifyConnectivity() {},
    session() {
      const execute = work => work({ run: async (query, params) => {
        calls.push({ query, params });
        if (query === INSPECT_SCHEMA) return row(state);
        if (query === ENSURE_SCHEMA) {
          state.markers = state.markers.length ? state.markers : [{ ...params }];
          return row({ marker: state.markers[0] });
        }
        return { records: [] };
      } });
      return { executeRead: execute, executeWrite: execute, async close() { closes.push('session'); } };
    },
    async close() { closes.push('native'); }
  };
  return { calls, closes, driver: new Neo4jDriver(() => native) };
}
const url = 'jssgdbc:neo4j:bolt://localhost';
for (const [name, state] of Object.entries({
  legacy: { legacy: true, owned: false, markers: [] },
  mixed: { legacy: true, owned: true, markers: [SCHEMA_PARAMS] },
  unmarked: { legacy: false, owned: true, markers: [] },
  unknownVersion: { legacy: false, owned: true, markers: [{ ...SCHEMA_PARAMS, version: 'secret' }] },
  unknownProfile: { legacy: false, owned: false, markers: [{ ...SCHEMA_PARAMS, profile: 'secret' }] },
  unknownIdentity: { legacy: false, owned: false, markers: [{ ...SCHEMA_PARAMS, id: 'secret' }] },
  duplicates: { legacy: false, owned: false, markers: [SCHEMA_PARAMS, SCHEMA_PARAMS] },
  malformed: { legacy: null, owned: false, markers: [] }
})) test(`schema rejects ${name} before any mutation and releases native driver`, async () => {
  const f = fixture(state), before = structuredClone(state);
  await assert.rejects(f.driver.connect(url), error => {
    assert.match(error.message, /schema\/profile.*operator control/);
    assert.doesNotMatch(error.stack, /secret|MATCH|password/);
    return true;
  });
  assert.deepEqual(state, before);
  assert.deepEqual(f.calls.map(c => c.query), [INSPECT_SCHEMA]);
  assert.deepEqual(f.closes, ['session', 'native']);
});

test('empty/unrelated storage and repeated opens converge on versioned unique marker', async () => {
  const state = { legacy: false, owned: false, markers: [], unrelatedSentinel: 'unchanged' };
  const f = fixture(state);
  const clients = await Promise.all([f.driver.connect(url), f.driver.connect(url)]);
  for (const client of clients) await client.close();
  state.owned = true;
  await (await f.driver.connect(url)).close();
  assert.deepEqual(state.markers, [SCHEMA_PARAMS]);
  assert.equal(state.unrelatedSentinel, 'unchanged');
  assert.match(CONSTRAINTS[2], /REQUIRE m.id IS UNIQUE/);
  assert.match(ENSURE_SCHEMA, /MERGE.*\$id/);
  assert.equal(f.calls[0].query, INSPECT_SCHEMA);
  assert.equal(f.closes.filter(c => c === 'native').length, 3);
});
