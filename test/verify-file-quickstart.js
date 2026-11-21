#!/usr/bin/env node
// Execute the actual marked example with disposable storage and persistence assertions.
import { runExample } from '../scripts/readme-examples.js';
await runExample('packages/file/README.md', 'file-quickstart');
console.log('File README close/reopen quick start passed');
