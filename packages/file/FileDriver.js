import { Driver } from '../core/Driver.js';
import { DriverManager } from '../core/DriverManager.js';
import { FileClient } from './FileClient.js';
import { FileStorage } from './FileStorage.js';

export class FileDriver extends Driver {
  static URL_PREFIX = 'jssgdbc:file:';

  acceptsURL(url) {
    return url.startsWith(FileDriver.URL_PREFIX);
  }

  async connect(url, properties) {
    const dirPath = url.substring(FileDriver.URL_PREFIX.length);
    return new FileClient(this, url, properties, new FileStorage(dirPath));
  }
}

const _driver = new FileDriver();
DriverManager.registerDriver(_driver);

export { _driver };
