import { expect } from 'chai';
import { DriverManager } from '@alt-javascript/jsgdbc-core';
import { MemoryDriver } from '../MemoryDriver.js';
import driverComplianceTests from '@alt-javascript/jsgdbc-core/test/driverCompliance.js';

async function clientFactory() {
  DriverManager.clear();
  const driver = new MemoryDriver();
  DriverManager.registerDriver(driver);
  return DriverManager.getClient('jsgdbc:memory:');
}

driverComplianceTests('MemoryDriver Compliance', clientFactory);
