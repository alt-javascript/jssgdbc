import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const cwd = fileURLToPath(new URL('..', import.meta.url));
export function runConformance({ spawn = spawnSync, report = console.error } = {}) {
  let failed = false;
  const phases = [
    ['memory', 'npm', ['test', '--workspace=packages/memory'], 120000],
    ['file', 'npm', ['test', '--workspace=packages/file'], 120000],
    ['Neo4j', process.execPath, ['packages/neo4j/test/run-integration.js'], 780000],
    ['Fuseki', process.execPath, ['packages/sparql/test/run-integration.js'], 900000],
  ];
  for (const [name, command, args, timeout] of phases) {
    const start = Date.now();
    let ok = false;
    try {
      const result = spawn(command, args, { cwd, stdio: 'inherit', timeout, killSignal: 'SIGKILL' });
      ok = !!result && !result.error && result.status === 0;
    } catch { /* Never report arbitrary subprocess error bodies. */ }
    report(`Conformance ${name}: ${ok ? 'passed' : 'failed'} (${Date.now() - start}ms)`);
    if (!ok) failed = true;
  }
  return failed ? 1 : 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runConformance();
