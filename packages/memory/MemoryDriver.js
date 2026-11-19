import { Driver } from '../core/Driver.js';
import { DriverManager } from '../core/DriverManager.js';
import { MemoryClient } from './MemoryClient.js';

export class MemoryDriver extends Driver {
  static URL_PREFIX = 'jsgdbc:memory:';

  acceptsURL(url) {
    return url.startsWith(MemoryDriver.URL_PREFIX);
  }

  async connect(url, properties) {
    return new MemoryClient(this, url, properties);
  }
}

const _driver = new MemoryDriver();
DriverManager.registerDriver(_driver);

export { _driver };
