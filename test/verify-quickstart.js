#!/usr/bin/env node
// Execute the actual README blocks; assertions live alongside the documented API use.
import { runExample } from '../scripts/readme-examples.js';
await runExample('README.md', 'memory-quickstart');
await runExample('packages/memory/README.md', 'memory-quickstart');
console.log('Root and memory README quick starts passed');
