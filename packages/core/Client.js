import { UnsupportedOperationError } from './errors.js';
import { DriverManager } from './DriverManager.js';

export class Client {
  constructor(driver, url, properties) {
    this._driver = driver;
    this._url = url;
    this._properties = properties;
    this._graphs = new Map();
    this._closed = false;
  }

  getGraph(name = '') {
    this._checkClosed();
    if (this._graphs.has(name)) {
      return this._graphs.get(name);
    }
    const graph = this._getGraph(name);
    this._graphs.set(name, graph);
    return graph;
  }

  _getGraph(name) {
    throw new UnsupportedOperationError('_getGraph not implemented');
  }

  getUrl() {
    return this._url;
  }

  close() {
    this._closed = true;
  }

  isClosed() {
    return this._closed;
  }

  _checkClosed() {
    if (this._closed) {
      throw new Error('Client is closed');
    }
  }
}

export class ClientDataSource {
  constructor(url, properties) {
    this._url = url;
    this._properties = properties;
  }

  async getClient() {
    return DriverManager.getClient(this._url, this._properties);
  }
}
