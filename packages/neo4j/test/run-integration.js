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
  report(`Neo4j owned project ${project}`);
  function run(phase, command, args, timeout) {
    const start = Date.now();
    let ok = false;
    try {
      const result = spawn(command, args, {
        cwd, stdio: 'inherit', timeout, killSignal: 'SIGKILL',
        env: { ...process.env, JSSGDBC_DISPOSABLE_NEO4J: project },
      });
      ok = !!result && !result.error && result.status === 0;
    } catch {
      // Never expose native error bodies or environment values.
    }
    report(`Neo4j ${phase} ${ok ? 'passed' : 'failed'} (${Date.now() - start}ms)`);
    return ok;
  }
  let passed = false;
  try {
    if (run('fixture startup/readiness', 'docker', [...compose, 'up', '-d', '--wait', '--wait-timeout', '240'], 300000)) {
      const smoke = run('node:test suite', process.execPath,
        ['--test', 'test/neo4j-integration.test.js', 'test/readme-integration.test.js'], 180000);
      const compliance = run('Mocha compliance suite', process.execPath,
        [require.resolve('mocha/bin/mocha.js'), '--timeout', '30000', '--forbid-pending', '--fail-zero', 'test/compliance.spec.js'], 180000);
      passed = smoke && compliance;
    }
  } catch {
    report('Neo4j suite setup failed');
  } finally {
    if (!run('fixture teardown', 'docker', [...compose, 'down', '--volumes', '--remove-orphans'], 60000)) passed = false;
    if (!run('owned container removal', process.execPath, ['--input-type=module', '-e',
      `import {spawnSync} from 'node:child_process'; const r=spawnSync('docker',['ps','-aq','--filter','label=com.docker.compose.project=${project}'],{encoding:'utf8',timeout:10000}); process.exitCode=r.error||r.status!==0||r.stdout.trim()?1:0;`], 15000)) passed = false;
  }
  return passed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runIntegration();
}
