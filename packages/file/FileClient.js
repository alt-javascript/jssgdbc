import path from 'path';
import { Client } from '../core/Client.js';
import { FileGraph } from './FileGraph.js';

export class FileClient extends Client {
  constructor(driver, url, properties, dirPath) {
    super(driver, url, properties);
    this._dirPath = dirPath;
  }

  _getGraph(name) {
    const filename = name === '' ? 'default.nt' : `${name}.nt`;
    const filePath = path.join(this._dirPath, filename);
    return new FileGraph(this, name, filePath);
  }
}
