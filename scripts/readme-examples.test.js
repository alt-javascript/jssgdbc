import test from 'node:test';
import assert from 'node:assert/strict';
import { access, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { examples, extractExample, executeSource, runExample } from './readme-examples.js';

for (const [path, marker] of examples) {
  test(`${path} [${marker}] executes unchanged`, () => runExample(path, marker));
}

const label = 'README.md [negative]';
const token = '<!-- example:negative -->';
const good = `${token}\n\x60\x60\x60javascript\nconsole.log('ok');\n\x60\x60\x60`;
test('missing, duplicate, malformed and empty markers identify README/example', () => {
  for (const source of ['', good + good, token + '\nnot a fence', `${token}\n\x60\x60\x60javascript\n\n\x60\x60\x60`]) {
    assert.throws(() => extractExample(source, 'README.md', 'negative'), /README\.md \[negative\]/);
  }
  assert.equal(extractExample(good, 'README.md', 'negative'), "console.log('ok');");
});

test('missing README has contextual diagnostics', async () => {
  await assert.rejects(runExample('packages/missing-readme.md', 'negative'), /missing-readme.md \[negative\]: read failed/);
});

for (const [name, source, expected, timeout] of [
  ['invalid term', `import '@alt-javascript/jssgdbc-memory';
    import { DriverManager } from '@alt-javascript/jssgdbc-core';
    const client = await DriverManager.getClient('jssgdbc:memory:');
    try { await client.getGraph().add('urn:s', 'urn:p', 'bare literal'); }
    finally { await client.close(); }`, /exit=1[\s\S]*stderr=[\s\S]*TypeError/, 10000],
  ['nonzero exit', "console.error('deliberate failure'); process.exit(7)", /exit=7[\s\S]*deliberate failure/, 10000],
  ['timeout', 'setInterval(() => {}, 1000)', /ETIMEDOUT/, 200]
]) {
  test(`${name} includes diagnostics and cleans owned storage`, async () => {
    let directory;
    await assert.rejects(executeSource(source, label, {
      timeout,
      spawn(...args) {
        directory = args[2].env.JSSGDBC_EXAMPLE_DIR;
        return spawnSync(...args);
      }
    }), error => {
      assert.match(error.message, /README\.md \[negative\]/);
      assert.match(error.message, expected);
      return true;
    });
    assert.ok(directory);
    await assert.rejects(access(directory), { code: 'ENOENT' });
  });
}

test('spawn failure bubbles with example context and cleans storage', async () => {
  let directory;
  await assert.rejects(executeSource('', label, {
    spawn(_cmd, _args, options) {
      directory = options.env.JSSGDBC_EXAMPLE_DIR;
      throw new Error('spawn unavailable');
    }
  }), /README.md \[negative\]: spawn unavailable/);
  await assert.rejects(access(directory), { code: 'ENOENT' });
});

test('combined execution and cleanup failures retain both diagnostics', async () => {
  let directory;
  try {
    await assert.rejects(executeSource('process.exit(9)', label, {
      async remove(path) { directory = path; throw new Error('denied'); }
    }), error => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors.length, 2);
      assert.match(error.message, /exit=9[\s\S]*cleanup failed: denied/);
      return true;
    });
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

test('cleanup failure is observable and identifies example', async () => {
  let directory;
  try {
    await assert.rejects(executeSource('', label, {
      async remove(path) { directory = path; throw new Error('denied'); }
    }), /README.md \[negative\]: cleanup failed: denied/);
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});
