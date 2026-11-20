#!/usr/bin/env node
/**
 * Verify the quick-start example runs as documented in README.md
 */
import assert from 'node:assert';

// Auto-registers the memory driver on import
import '../packages/memory/index.js';
import { DriverManager } from '../packages/core/index.js';

async function main() {
  // Get a client for the in-memory triple store
  const client = await DriverManager.getClient('jssgdbc:memory:');
  assert(client, 'Client should be created');

  // Get the default graph (or any named graph)
  const graph = client.getGraph();
  assert(graph, 'Graph should be retrieved');

  // Add triples (async)
  await graph.add(
    'http://example.org/alice',
    'http://xmlns.com/foaf/0.1/name',
    'Alice'
  );

  // Query triples with wildcard find (async, returns a Cursor)
  const cursor = await graph.find(null, null, null);
  assert(cursor, 'Cursor should be returned');

  // Iterate with for-await-of and collect triples
  let tripleCount = 0;
  for await (const triple of cursor) {
    tripleCount++;
    assert(triple, 'Triple should be non-null');
    assert(triple.subject === 'http://example.org/alice', 'Subject should match');
    assert(triple.predicate === 'http://xmlns.com/foaf/0.1/name', 'Predicate should match');
    assert(triple.object === 'Alice', 'Object should match');
  }
  assert(tripleCount >= 1, 'At least one triple should be found');

  // Or iterate manually with while/next
  const cursor2 = await graph.find('http://example.org/alice', null, null);
  let manualCount = 0;
  while (await cursor2.next()) {
    manualCount++;
    const triple = cursor2.getTriple();
    assert(triple, 'Triple should be retrievable');
  }
  assert(manualCount >= 1, 'At least one triple should be found in manual iteration');

  // Remove triples (async)
  await graph.remove(
    'http://example.org/alice',
    'http://xmlns.com/foaf/0.1/name',
    'Alice'
  );

  // Count remaining triples
  const count = await graph.count(null, null, null);
  assert.strictEqual(count, 0, 'Count should be 0 after removal');

  console.log('✓ Quick-start example verified successfully');
  process.exit(0);
}

main().catch((error) => {
  console.error('✗ Quick-start example verification failed:', error);
  process.exit(1);
});
