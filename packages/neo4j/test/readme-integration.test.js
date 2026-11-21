import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DriverManager } from '@alt-javascript/jssgdbc-neo4j';

const url = 'jssgdbc:neo4j:bolt://127.0.0.1:17687';
const options = { database: 'neo4j', timeoutMs: 10000, connectionTimeoutMs: 2000 };
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
function extract(text, id) {
  const marker = `<!-- example:${id} -->`;
  assert.equal(text.split(marker).length - 1, 1, `exactly one ${id} marker required`);
  const matches = [...text.matchAll(new RegExp(marker + '\\s*```javascript\\n([\\s\\S]*?)\\n```', 'g'))];
  assert.equal(matches.length, 1, `one JavaScript block required for ${id}`);
  const specifier = "'@alt-javascript/jssgdbc-neo4j'";
  assert.ok(matches[0][1].includes(specifier), 'public package import required');
  // Only resolve the package import; example operations are unchanged.
  return matches[0][1].replace(specifier, JSON.stringify(import.meta.resolve('@alt-javascript/jssgdbc-neo4j')));
}
async function example(id) {
  return import(`data:text/javascript;base64,${Buffer.from(extract(readme, id)).toString('base64')}`);
}

test('README extraction rejects missing, duplicate and malformed blocks', () => {
  for (const id of ['default-crud', 'named-isolation']) {
    assert.ok(extract(readme, id));
    assert.throws(() => extract('', id), /marker required/);
    assert.throws(() => extract(readme + `\n<!-- example:${id} -->`, id), /marker required/);
    assert.throws(() => extract(`<!-- example:${id} -->\ntext`, id), /JavaScript block/);
    assert.throws(() => extract(`<!-- example:${id} -->\n\`\`\`javascript\nexport const x = 1;\n\`\`\``, id), /public package/);
  }
});

for (const [id, name, expectedHandles] of [
  ['default-crud', 'defaultExample', 3], ['named-isolation', 'namedExample', 4],
]) {
  test(`README ${id} executes against Neo4j and awaits cleanup`, { timeout: 30000 }, async () => {
    assert.match(process.env.JSSGDBC_DISPOSABLE_NEO4J ?? '', /^jssgdbc-test-[0-9a-f-]{36}$/, 'use disposable runner');
    const module = await example(id);
    const driver = DriverManager.getDrivers().find(d => d.acceptsURL(url));
    assert.ok(driver, 'public import auto-registers driver');
    const originalConnect = driver.connect;
    const handles = [];
    let closeSettled = false;
    driver.connect = async function (...args) {
      assert.equal(args[0], url, 'fixed fixture only');
      const client = await originalConnect.apply(this, args);
      handles.push(client);
      const close = client.close.bind(client);
      client.close = async () => { await close(); closeSettled = true; };
      const getGraph = client.getGraph.bind(client);
      client.getGraph = (...args) => {
        const graph = getGraph(...args);
        if (!handles.includes(graph)) {
          handles.push(graph);
          const find = graph.find.bind(graph);
          graph.find = async (...pattern) => {
            const cursor = await find(...pattern);
            handles.push(cursor);
            return cursor;
          };
        }
        return graph;
      };
      return client;
    };
    try {
      const result = await module[name](url, options);
      assert.equal(handles.length, expectedHandles);
      assert.ok(handles.every(h => h.isClosed()), 'example closes all acquired handles');
      assert.equal(closeSettled, true, 'native client close awaited before return');
      if (id === 'default-crud') {
        assert.deepEqual(result, { subject: result.subject,
          rows: [{ subject: result.subject, predicate: 'urn:label', object: '"Hello"@en' }],
          present: true, count: 1, afterRemove: false });
      } else {
        assert.deepEqual(result, { name: result.name, rightBefore: false, defaultBefore: false,
          leftAfter: 0, rightPreserved: true, rightAfter: 0 });
      }
      // Independent public client verifies committed cleanup, not just returned flags.
      const verifier = await originalConnect.call(driver, url, options);
      try {
        if (id === 'default-crud') assert.equal(await verifier.getGraph().count(result.subject), 0);
        else {
          assert.equal(await verifier.getGraph(`${result.name}:left`).count(), 0);
          assert.equal(await verifier.getGraph(`${result.name}:right`).count(), 0);
        }
      } finally { await verifier.close(); }
      await assert.rejects(module[name](url, { timeoutMs: 0 }), /Invalid Neo4j properties/);
      assert.equal(handles.length, expectedHandles, 'invalid config acquires no additional handles');
    } finally {
      driver.connect = originalConnect;
      const results = await Promise.allSettled(handles.map(h => h.close()));
      assert.ok(results.every(r => r.status === 'fulfilled'), 'safety cleanup succeeds');
    }
  });
}
