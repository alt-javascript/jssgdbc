import { Driver, DriverManager } from '@alt-javascript/jssgdbc-core';
import { SparqlClient } from './SparqlClient.js';

export class SparqlDriver extends Driver {
  static URL_PREFIX = 'jssgdbc:sparql:';

  acceptsURL(url) {
    return typeof url === 'string' && url.startsWith(SparqlDriver.URL_PREFIX);
  }

  async connect(url, properties) {
    return new SparqlClient(this, url, properties);
  }
}

const _driver = new SparqlDriver();
DriverManager.registerDriver(_driver);

export { _driver };
