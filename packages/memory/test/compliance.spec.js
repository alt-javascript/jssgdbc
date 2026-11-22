import { DriverManager } from '@alt-javascript/jssgdbc-core';
import { MemoryDriver } from '../MemoryDriver.js';
import { typedGraphComplianceTests } from '../../core/test/typedCompliance.js';

async function clientFactory() {
  DriverManager.clear();
  const driver = new MemoryDriver();
  DriverManager.registerDriver(driver);
  return DriverManager.getClient('jssgdbc:memory:');
}

typedGraphComplianceTests('MemoryDriver Compliance', clientFactory);
