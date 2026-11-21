import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const cwd = fileURLToPath(new URL('..', import.meta.url));

export function runIntegration({ spawn = spawnSync, report = console.error } = {}) {
  const project = `jssgdbc-fuseki-${randomUUID()}`;
  const compose = ['compose', '-p', project, '-f', 'compose.test.yml'];
  report(`Fuseki owned project ${project}`);
  function run(phase, command, args, timeout) {
    const start = Date.now();
    let ok = false;
    try {
      const result = spawn(command, args, { cwd, stdio: 'inherit', timeout,
        killSignal: 'SIGKILL', env: { ...process.env, JSSGDBC_DISPOSABLE_FUSEKI: project } });
      ok = !!result && !result.error && result.status === 0;
    } catch { /* Do not expose subprocess errors or environment. */ }
    report(`Fuseki ${phase} ${ok ? 'passed' : 'failed'} (${Date.now() - start}ms)`);
    return ok;
  }
  let passed = false;
  try {
    if (run('startup/readiness', 'docker', [...compose, 'up', '--build', '-d', '--wait', '--wait-timeout', '180'], 600000)) {
      passed = run('version and shared compliance', process.execPath,
        [require.resolve('mocha/bin/mocha.js'), '--timeout', '30000', '--forbid-pending', '--fail-zero', 'test/live-compliance.js'], 180000);
    }
  } finally {
    if (!run('cleanup', 'docker', [...compose, 'down', '--volumes', '--remove-orphans'], 60000)) passed = false;
    if (!run('owned container removal', process.execPath, ['--input-type=module', '-e',
      `import {spawnSync} from 'node:child_process'; const r=spawnSync('docker',['ps','-aq','--filter','label=com.docker.compose.project=${project}'],{encoding:'utf8',timeout:10000}); process.exitCode=r.error||r.status!==0||r.stdout.trim()?1:0;`], 15000)) passed = false;
  }
  return passed ? 0 : 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runIntegration();
