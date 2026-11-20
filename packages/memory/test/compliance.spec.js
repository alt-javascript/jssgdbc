import { expect } from 'chai';
import { DriverManager } from '@alt-javascript/jssgdbc-core';
import { MemoryDriver } from '../MemoryDriver.js';
import driverComplianceTests from '@alt-javascript/jssgdbc-core/test/driverCompliance.js';

async function clientFactory() {
  DriverManager.clear();
  const driver = new MemoryDriver();
  DriverManager.registerDriver(driver);
  return DriverManager.getClient('jssgdbc:memory:');
}

driverComplianceTests('MemoryDriver Compliance', clientFactory);
