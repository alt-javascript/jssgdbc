import { Client } from '../core/Client.js';
import { MemoryGraph } from './MemoryGraph.js';

export class MemoryClient extends Client {
  constructor(driver, url, properties) {
    super(driver, url, properties);
    this._stores = new Map();
  }

  _getGraph(name) {
    let store = this._stores.get(name);
    if (!store) {
      store = [];
      this._stores.set(name, store);
    }
    return new MemoryGraph(this, name, store);
  }
}
