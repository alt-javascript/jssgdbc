import fs from 'fs/promises';
import path from 'path';
import { Graph } from '../core/Graph.js';
import { Cursor } from '../core/Cursor.js';
import { NTriplesParser } from './NTriplesParser.js';
import { NTriplesSerializer } from './NTriplesSerializer.js';

export class FileGraph extends Graph {
  constructor(client, name, filePath) {
    super(client, name);
    this._filePath = filePath;
    this._store = [];
    this._loaded = false;
  }

  async _ensureLoaded() {
    if (this._loaded) {
      return;
    }

    try {
      const text = await fs.readFile(this._filePath, 'utf-8');
      this._store = NTriplesParser.parse(text);
    } catch (err) {
      if (err.code === 'ENOENT') {
        this._store = [];
      } else {
        throw err;
      }
    }

    this._loaded = true;
  }

  async _add(subject, predicate, object) {
    await this._ensureLoaded();
    const triple = { subject, predicate, object };
    const exists = this._store.some(t =>
      t.subject === subject &&
      t.predicate === predicate &&
      t.object === object
    );
    if (!exists) {
      this._store.push(triple);
      await this._flush();
    }
    return undefined;
  }

  async _remove(subject, predicate, object) {
    await this._ensureLoaded();
    let removed = false;
    for (let i = this._store.length - 1; i >= 0; i--) {
      const t = this._store[i];
      if (this._matchesPattern(t, subject, predicate, object)) {
        this._store.splice(i, 1);
        removed = true;
      }
    }
    if (removed) {
      await this._flush();
    }
    return undefined;
  }

  async _find(subject, predicate, object) {
    await this._ensureLoaded();
    const matches = this._store.filter(t =>
      this._matchesPattern(t, subject, predicate, object)
    );
    return new Cursor(matches);
  }

  async _has(subject, predicate, object) {
    await this._ensureLoaded();
    return this._store.some(t =>
      this._matchesPattern(t, subject, predicate, object)
    );
  }

  async _count(subject, predicate, object) {
    await this._ensureLoaded();
    return this._store.filter(t =>
      this._matchesPattern(t, subject, predicate, object)
    ).length;
  }

  async _clear() {
    await this._ensureLoaded();
    this._store.length = 0;
    await this._flush();
    return undefined;
  }

  _matchesPattern(triple, subject, predicate, object) {
    return (subject === null || subject === undefined || triple.subject === subject) &&
           (predicate === null || predicate === undefined || triple.predicate === predicate) &&
           (object === null || object === undefined || triple.object === object);
  }

  async _flush() {
    const text = NTriplesSerializer.serialize(this._store);
    const dir = path.dirname(this._filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this._filePath, text, 'utf-8');
  }
}
