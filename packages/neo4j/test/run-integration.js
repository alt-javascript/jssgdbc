import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const cwd = fileURLToPath(new URL('..', import.meta.url));

// The injected subprocess boundary lets offline tests exercise the real orchestration.
export function runIntegration({ spawn = spawnSync, report = console.error } = {}) {
  const project = `jssgdbc-test-${randomUUID()}`;
  const compose = ['compose', '-p', project, '-f', 'compose.test.yml'];
  function run(phase, command, args, timeout) {
    try {
      const result = spawn(command, args, {
        cwd, stdio: 'inherit', timeout, killSignal: 'SIGKILL',
        env: { ...process.env, JSSGDBC_DISPOSABLE_NEO4J: project },
      });
      if (result && !result.error && result.status === 0) return true;
    } catch {
      // Never expose native error bodies or environment values.
    }
    report(`Neo4j ${phase} failed`);
    return false;
  }
  let passed = false;
  try {
    if (run('fixture startup/readiness', 'docker', [...compose, 'up', '-d', '--wait', '--wait-timeout', '240'], 300000)) {
      const smoke = run('node:test suite', process.execPath,
        ['--test', 'test/neo4j-integration.test.js'], 180000);
      const compliance = run('Mocha compliance suite', process.execPath,
        [require.resolve('mocha/bin/mocha.js'), '--timeout', '30000', '--forbid-pending', '--fail-zero', 'test/compliance.spec.js'], 180000);
      passed = smoke && compliance;
    }
  } catch {
    report('Neo4j suite setup failed');
  } finally {
    if (!run('fixture teardown', 'docker', [...compose, 'down', '--volumes', '--remove-orphans'], 60000)) passed = false;
  }
  return passed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runIntegration();
}
