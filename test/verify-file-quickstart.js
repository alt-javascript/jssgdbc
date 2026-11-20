#!/usr/bin/env node
/**
 * Verify the file-driver quick-start example runs as documented in README.md
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Auto-registers the file driver on import
import '../packages/file/index.js';
import { DriverManager } from '../packages/core/index.js';

async function main() {
  // Create a temporary directory outside the repo so verification never mutates the source tree
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-file-driver-'));

  try {
    // Get a client for the file-based triple store
    const client = await DriverManager.getClient('jssgdbc:file:' + tmpDir);
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

    console.log('✓ File-driver quick-start example verified successfully');
  } catch (error) {
    console.error('✗ File-driver quick-start example verification failed:', error);
    process.exitCode = 1;
  } finally {
    // Clean up temporary directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error('Warning: Could not clean up temporary directory:', cleanupError);
    }
  }
}

main().catch((error) => {
  console.error('✗ Unexpected error:', error);
  process.exit(1);
});
