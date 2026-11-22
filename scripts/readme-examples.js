import assert from 'node:assert/strict';
import { readFile, mkdtemp, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
export const examples = [
  ['README.md', 'memory-quickstart'],
  ['README.md', 'root-dataset-persistence'],
  ['README.md', 'root-dataset'],
  ['packages/core/README.md', 'core-quickstart'],
  ['packages/core/README.md', 'core-dataset-persistence'],
  ['packages/memory/README.md', 'memory-quickstart'],
  ['packages/file/README.md', 'file-quickstart'],
  ['packages/dataset/README.md', 'dataset-quickstart']
];

export function extractExample(source, path, marker) {
  const label = `${path} [${marker}]`;
  const token = `<!-- example:${marker} -->`;
  assert.equal(source.split(token).length - 1, 1, `${label}: expected exactly one marker`);
  const tail = source.slice(source.indexOf(token) + token.length);
  const match = /^\s*```(?:javascript|js)\r?\n([\s\S]*?)\r?\n```/.exec(tail);
  assert.ok(match, `${label}: expected a fenced javascript block immediately after marker`);
  assert.ok(match[1].trim(), `${label}: empty example`);
  return match[1];
}

// Execute unchanged source using workspace resolution from the repository root.
// Only a test-owned storage directory is injected; no semantic replacements.
export async function executeSource(source, label, { timeout = 10000, spawn = spawnSync, remove = rm } = {}) {
  let directory, executionError;
  try {
    directory = await mkdtemp(join(await realpath(root), '.readme-test-'));
    const result = spawn(process.execPath, ['--input-type=module', '--eval', source], {
      cwd: root, encoding: 'utf8', timeout, maxBuffer: 1024 * 1024,
      env: { ...process.env, JSSGDBC_EXAMPLE_DIR: directory }
    });
    assert.ok(!result.error && result.status === 0 && !result.signal,
      `${label}: subprocess failed; exit=${result.status} signal=${result.signal} ` +
      `error=${result.error?.message ?? 'none'}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  } catch (error) {
    executionError = new Error(`${label}: ${error.message}`, { cause: error });
  } finally {
    if (directory) {
      try { await remove(directory, { recursive: true, force: true }); }
      catch (error) {
        const cleanupError = new Error(`${label}: cleanup failed: ${error.message}`, { cause: error });
        if (executionError) throw new AggregateError([executionError, cleanupError],
          `${executionError.message}\n${cleanupError.message}`);
        throw cleanupError;
      }
    }
  }
  if (executionError) throw executionError;
}

export async function runExample(path, marker) {
  const label = `${path} [${marker}]`;
  let source;
  try { source = await readFile(resolve(root, path), 'utf8'); }
  catch (error) { throw new Error(`${label}: read failed: ${error.message}`, { cause: error }); }
  return executeSource(extractExample(source, path, marker), label);
}
