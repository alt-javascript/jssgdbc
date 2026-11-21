import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// A unique Compose project ensures teardown can only remove this run's fixture.
const project = `jssgdbc-test-${process.pid}-${Date.now()}`;
const cwd = fileURLToPath(new URL('..', import.meta.url));
const compose = ['compose', '-p', project, '-f', 'compose.test.yml'];
function run(command, args, timeout) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', timeout });
  return !result.error && result.status === 0;
}

let passed = false;
try {
  if (!run('docker', [...compose, 'up', '-d', '--wait', '--wait-timeout', '240'], 300000)) {
    console.error('Neo4j fixture startup/readiness failed');
  } else {
    passed = run(process.execPath, ['--test', 'test/neo4j-integration.test.js'], 180000);
  }
} finally {
  if (!run('docker', [...compose, 'down', '--volumes', '--remove-orphans'], 60000)) {
    console.error('Neo4j fixture teardown failed');
    passed = false;
  }
}
process.exitCode = passed ? 0 : 1;
