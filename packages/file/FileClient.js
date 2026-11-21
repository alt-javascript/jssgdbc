import { Client } from '../core/Client.js';
import { FileGraph } from './FileGraph.js';

export class FileClient extends Client {
  constructor(driver, url, properties, storage) {
    super(driver, url, properties);
    this._storage = storage;
  }

  _getGraph(name) {
    if (typeof name !== 'string') throw new TypeError('File graph name must be a string');
    return new FileGraph(this, name, this._storage);
  }
}
