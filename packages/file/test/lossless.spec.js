import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DriverManager, FileDriver } from '@alt-javascript/jssgdbc-file';
import { NTriplesParser as P } from '../NTriplesParser.js';
import { NTriplesSerializer as S } from '../NTriplesSerializer.js';

describe('Public file graph round trips', () => {
  it('rejects invalid input before I/O and propagates malformed-file/read/write failures', async () => {
    const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'jssgdbc-failure-'));
    const drivers = DriverManager.getDrivers();
    let client;
    try {
      DriverManager.clear();
      DriverManager.registerDriver(new FileDriver());
      const url = `jssgdbc:file:${directory}`;
      client = await DriverManager.getClient(url);
      await assert.rejects(client.getGraph().add('urn:s', 'urn:p', 'bare'), /object/);
      assert.deepEqual(await fs.readdir(directory), []);
      await client.getGraph().count(); // Reserve the exact identity before corrupting its payload.
      await client.getGraph().close();
      const file = path.join(directory, client._storage.key(''), 'graph.nt');
      await fs.writeFile(file, '<urn:s> <urn:p> "unfinished .');
      await assert.rejects(client.getGraph().count(), /line/i);
      await client.close();
      await fs.rm(file);
      await fs.mkdir(file);
      client = await DriverManager.getClient(url);
      await assert.rejects(client.getGraph().count(), /File storage/);
      await client.close();
      await fs.rm(file, { recursive: true });
      client = await DriverManager.getClient(url);
      assert.equal(await client.getGraph().count(), 0);
      await fs.mkdir(file);
      await assert.rejects(client.getGraph().add('urn:s', 'urn:p', '"value"'), /File storage/);
    } finally {
      await client?.close();
      DriverManager.clear();
      for (const driver of drivers) DriverManager.registerDriver(driver);
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves distinct term identities and lexical content after close/reopen', async () => {
    const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'jssgdbc-terms-'));
    const drivers = DriverManager.getDrivers();
    const objects = ['urn:o', '"urn:o"', '"mail@example.org^^type"', String.raw`"quote \" slash \\ 雪😀\n\t"`,
      '"001"^^<http://www.w3.org/2001/XMLSchema#integer>', '"bonjour"@fr-ca', '"text"', '_:local'];
    let client;
    try {
      DriverManager.clear();
      DriverManager.registerDriver(new FileDriver());
      const url = `jssgdbc:file:${directory}`;
      client = await DriverManager.getClient(url);
      for (const object of objects) await client.getGraph().add('<urn:s>', '<urn:p>', object);
      await client.close();
      client = await DriverManager.getClient(url);
      const graph = client.getGraph();
      assert.deepEqual((await graph.find()).getTriples().map(t => t.object), objects);
      for (const object of objects) assert.equal(await graph.count('urn:s', 'urn:p', object), 1);
      await graph.remove(null, null, '"urn:o"');
      assert.equal(await graph.has(null, null, 'urn:o'), true);
      await client.close();
      client = await DriverManager.getClient(url);
      assert.equal(await client.getGraph().has(null, null, '"urn:o"'), false);
    } finally {
      await client?.close();
      DriverManager.clear();
      for (const driver of drivers) DriverManager.registerDriver(driver);
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});

describe('Lossless string contract: strict file codec', () => {
  const triple = { subject: '<urn:s>', predicate: '<urn:p>', object: '"value"' };
  it('accepts comments, CRLF, empty documents and stable document blank labels', () => {
    assert.deepEqual(P.parse(''), []);
    assert.equal(S.serialize([]), '');
    const rows = P.parse('# heading\r\n_:b <urn:p> "a@b^^c" . # trailing\r\n_:b <urn:p> "second" .');
    assert.equal(rows[0].subject, rows[1].subject);
    assert.equal(rows[0].object, '"a@b^^c"');
  });
  it('canonicalizes only RDF-equivalent lexical syntax', () => {
    assert.equal(P.parseLine('<urn:s> <urn:p> "text"^^<http://www.w3.org/2001/XMLSchema#string> .').object, '"text"');
    assert.equal(P.parseLine('<urn:s> <urn:p> "text"@EN-us .').object, '"text"@en-us');
    assert.equal(P.parseLine('<urn:s> <urn:p> "\\u96EA\\U0001F600" .').object, '"雪😀"');
  });
  it('preserves control escape values through repeated serialization', () => {
    const object = String.raw`"\t\n\r\b\f\u0000"`;
    const once = S.serializeLine({ ...triple, object });
    assert.equal(S.serializeLine(P.parseLine(once)), once);
  });
  it('reports document line and serialization field/index with causes', () => {
    assert.throws(() => P.parse('# heading\n\n<urn:s> <urn:p> "bad\\x" .'), error => /line 3/.test(error.message) && !!error.cause);
    assert.throws(() => S.serialize([triple, { ...triple, predicate: '_:b' }]), /index 1: Invalid predicate/);
  });
  for (const invalid of [null, [], {}, { ...triple, graph: '<urn:g>' },
    { ...triple, subject: '"literal"' }, { ...triple, predicate: '_:b' },
    ...[null, undefined, 42, 'bare', '<relative>', '"x" . # comment', '"x" # comment',
      '"x" <urn:extra>', '"x"\n', '"x"@', '"x"^^<relative>'].map(object => ({ ...triple, object }))]) {
    it(`rejects invalid serializer input ${JSON.stringify(invalid)}`, () => assert.throws(() => S.serializeLine(invalid)));
  }
  for (const object of ['"mail@example.org"', '"a^^b"', '"mail@example.org^^type"',
    '"quote \\" slash \\\\ 雪"', '"001"^^<http://www.w3.org/2001/XMLSchema#integer>']) {
    it(`preserves literal content ${object}`, () => {
      const triple = { subject: '<urn:s>', predicate: '<urn:p>', object };
      assert.deepEqual(P.parseLine(S.serializeLine(triple)), triple);
    });
  }
  for (const line of [
    '"subject" <urn:p> <urn:o> .',
    '<urn:s> <urn:p> <urn:o> <urn:fourth> .',
    '<urn:s> "predicate" <urn:o> .',
    '<urn:s> <urn:p> "unterminated .',
    '<urn:s> <urn:p> <urn:o> . junk',
    '<urn:s> <urn:p> <urn:o> . <urn:s> <urn:p> <urn:o> .',
    '<urn:s> _:predicate <urn:o> .',
    '<relative> <urn:p> <urn:o> .',
    '@prefix ex: <urn:example:> .',
    '<urn:s> <urn:p> "x"@ .',
    '<urn:s> <urn:p> "x"^^<relative> .',
    '<urn:s> <urn:p> "x" ; <urn:p> "y" .',
    '<urn:s> <urn:p> "line\nbreak" .',
    String.raw`<urn:s> <urn:p> "bad\uZZZZ" .`,
    String.raw`<urn:s> <urn:p> "bad\U00110000" .`,
  ]) {
    it(`rejects malformed N-Triples: ${line}`, () => assert.throws(() => P.parseLine(line)));
  }
});
