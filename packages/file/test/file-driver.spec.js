import { DataFactory as F } from 'n3';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { expect } from 'chai';
import { DriverManager } from '@alt-javascript/jssgdbc-core';
import { FileDriver } from '../FileDriver.js';
import { typedGraphComplianceTests as driverComplianceTests } from '../../core/test/typedCompliance.js';

const tempDirs = [];

// Clean up temp directories after each test
afterEach(async () => {
  for (const dir of tempDirs) {
    try {
      fsSync.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  }
  tempDirs.length = 0;
});

// Create a clientFactory that follows the FileDriver pattern
async function clientFactory() {
  const tmpDir = fsSync.mkdtempSync(path.join(fsSync.realpathSync(os.tmpdir()), 'jssgdbc-file-'));
  tempDirs.push(tmpDir);
  DriverManager.clear();
  const driver = new FileDriver();
  DriverManager.registerDriver(driver);
  return DriverManager.getClient('jssgdbc:file:' + tmpDir);
}

// Group 1: Driver compliance tests
driverComplianceTests('FileDriver Compliance', clientFactory);

// Group 2: File persistence tests
describe('FileDriver Persistence', () => {
  it('persists triples to .nt file on disk', async () => {
    const tmpDir = fsSync.mkdtempSync(path.join(fsSync.realpathSync(os.tmpdir()), 'jssgdbc-file-'));
    tempDirs.push(tmpDir);
    DriverManager.clear();
    const driver = new FileDriver();
    DriverManager.registerDriver(driver);
    const client = await DriverManager.getClient('jssgdbc:file:' + tmpDir);

    const graph = client.getGraph();
    await graph.add(F.namedNode('http://example.com/s1'), F.namedNode('http://example.com/p1'), F.namedNode('http://example.com/o1'));
    await graph.add(F.namedNode('http://example.com/s2'), F.namedNode('http://example.com/p2'), F.literal('object2'));

    // Check that the keyed graph.nt payload exists and has content
    const filePath = path.join(tmpDir, client._storage.key(F.defaultGraph()), 'graph.nt');
    const fileExists = fsSync.existsSync(filePath);
    expect(fileExists).to.be.true;

    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).to.include('<http://example.com/s1>');
    expect(content).to.include('<http://example.com/p1>');
    expect(content).to.include('<http://example.com/o1>');

    await client.close();
  });

  it('reloads triples from file on new client session', async () => {
    const tmpDir = fsSync.mkdtempSync(path.join(fsSync.realpathSync(os.tmpdir()), 'jssgdbc-file-'));
    tempDirs.push(tmpDir);
    DriverManager.clear();
    const driver = new FileDriver();
    DriverManager.registerDriver(driver);

    // First session: add triples
    const client1 = await DriverManager.getClient('jssgdbc:file:' + tmpDir);
    const graph1 = client1.getGraph();
    await graph1.add(F.namedNode('http://example.com/s1'), F.namedNode('http://example.com/p1'), F.namedNode('http://example.com/o1'));
    await graph1.add(F.namedNode('http://example.com/s2'), F.namedNode('http://example.com/p2'), F.namedNode('http://example.com/o2'));
    await client1.close();

    // Second session: verify triples are reloaded
    DriverManager.clear();
    const driver2 = new FileDriver();
    DriverManager.registerDriver(driver2);
    const client2 = await DriverManager.getClient('jssgdbc:file:' + tmpDir);
    const graph2 = client2.getGraph();

    const cursor = await graph2.find(null, null, null);
    let count = 0;
    while (await cursor.next()) count++;
    expect(count).to.equal(2);

    // Verify specific triples exist
    const cursor2 = await graph2.find(F.namedNode('http://example.com/s1'), null, null);
    const found1 = await cursor2.next();
    expect(found1).to.be.true;

    await client2.close();
  });

  it('named graphs use separate .nt files', async () => {
    const tmpDir = fsSync.mkdtempSync(path.join(fsSync.realpathSync(os.tmpdir()), 'jssgdbc-file-'));
    tempDirs.push(tmpDir);
    DriverManager.clear();
    const driver = new FileDriver();
    DriverManager.registerDriver(driver);
    const client = await DriverManager.getClient('jssgdbc:file:' + tmpDir);

    const graphA = client.getGraph(F.namedNode('urn:a'));
    const graphB = client.getGraph(F.namedNode('urn:b'));

    await graphA.add(F.namedNode('http://example.com/s1'), F.namedNode('http://example.com/p1'), F.namedNode('http://example.com/o1'));
    await graphB.add(F.namedNode('http://example.com/s2'), F.namedNode('http://example.com/p2'), F.namedNode('http://example.com/o2'));

    // Check that both files exist
    const fileAExists = fsSync.existsSync(path.join(tmpDir, client._storage.key(F.namedNode('urn:a')), 'graph.nt'));
    const fileBExists = fsSync.existsSync(path.join(tmpDir, client._storage.key(F.namedNode('urn:b')), 'graph.nt'));
    expect(fileAExists).to.be.true;
    expect(fileBExists).to.be.true;

    // Verify isolation
    const cursorA = await graphA.find(F.namedNode('http://example.com/s2'), null, null);
    const foundInA = await cursorA.next();
    expect(foundInA).to.be.false;

    const cursorB = await graphB.find(F.namedNode('http://example.com/s1'), null, null);
    const foundInB = await cursorB.next();
    expect(foundInB).to.be.false;

    await client.close();
  });

  it('handles non-existent file gracefully', async () => {
    const tmpDir = fsSync.mkdtempSync(path.join(fsSync.realpathSync(os.tmpdir()), 'jssgdbc-file-'));
    tempDirs.push(tmpDir);
    DriverManager.clear();
    const driver = new FileDriver();
    DriverManager.registerDriver(driver);
    const client = await DriverManager.getClient('jssgdbc:file:' + tmpDir);

    const graph = client.getGraph();

    // Find on non-existent file should return empty cursor
    const cursor = await graph.find(null, null, null);
    const found = await cursor.next();
    expect(found).to.be.false;

    await client.close();
  });

  it('clear removes all triples and writes empty file', async () => {
    const tmpDir = fsSync.mkdtempSync(path.join(fsSync.realpathSync(os.tmpdir()), 'jssgdbc-file-'));
    tempDirs.push(tmpDir);
    DriverManager.clear();
    const driver = new FileDriver();
    DriverManager.registerDriver(driver);
    const client = await DriverManager.getClient('jssgdbc:file:' + tmpDir);

    const graph = client.getGraph();
    await graph.add(F.namedNode('http://example.com/s1'), F.namedNode('http://example.com/p1'), F.namedNode('http://example.com/o1'));
    await graph.add(F.namedNode('http://example.com/s2'), F.namedNode('http://example.com/p2'), F.namedNode('http://example.com/o2'));

    // Clear the graph
    await graph.clear();

    // Verify file is empty (or contains only whitespace)
    const filePath = path.join(tmpDir, client._storage.key(F.defaultGraph()), 'graph.nt');
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content.trim()).to.equal('');

    // Verify find returns nothing
    const cursor = await graph.find(null, null, null);
    const found = await cursor.next();
    expect(found).to.be.false;

    await client.close();
  });

  it('remove persists deletion to disk', async () => {
    const tmpDir = fsSync.mkdtempSync(path.join(fsSync.realpathSync(os.tmpdir()), 'jssgdbc-file-'));
    tempDirs.push(tmpDir);
    DriverManager.clear();
    const driver = new FileDriver();
    DriverManager.registerDriver(driver);

    // First session: add two triples
    const client1 = await DriverManager.getClient('jssgdbc:file:' + tmpDir);
    const graph1 = client1.getGraph();
    await graph1.add(F.namedNode('http://example.com/s1'), F.namedNode('http://example.com/p1'), F.namedNode('http://example.com/o1'));
    await graph1.add(F.namedNode('http://example.com/s2'), F.namedNode('http://example.com/p2'), F.namedNode('http://example.com/o2'));

    // Remove one triple
    await graph1.remove(F.namedNode('http://example.com/s1'), F.namedNode('http://example.com/p1'), F.namedNode('http://example.com/o1'));
    await client1.close();

    // Second session: verify only one triple remains
    DriverManager.clear();
    const driver2 = new FileDriver();
    DriverManager.registerDriver(driver2);
    const client2 = await DriverManager.getClient('jssgdbc:file:' + tmpDir);
    const graph2 = client2.getGraph();

    const cursor = await graph2.find(null, null, null);
    let count = 0;
    while (await cursor.next()) count++;
    expect(count).to.equal(1);

    // Verify the remaining triple is the second one
    const cursor2 = await graph2.find(F.namedNode('http://example.com/s2'), null, null);
    const found = await cursor2.next();
    expect(found).to.be.true;

    await client2.close();
  });
});
