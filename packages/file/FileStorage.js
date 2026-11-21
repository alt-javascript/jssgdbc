import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// Internal boundary. Directories must be owned by a trusted caller: portable
// lstat/open checks cannot prevent concurrent hostile ancestor replacement.
// No writer coordination, fsync durability, or legacy filename migration.
export class FileStorage {
  constructor(root) {
    this.root = path.resolve(root);
    this._configuredRoot = path.isAbsolute(root) ? root : `${process.cwd()}${path.sep}${root}`;
    this._fs = fs;
  }

  key(name) {
    if (typeof name !== 'string') throw new TypeError('File graph name must be a string');
    return `v1-${createHash('sha256').update(JSON.stringify(name)).digest('hex')}`;
  }

  _error(operation, key, cause) {
    const error = new Error(`File storage ${operation} failed [${key}]${cause?.storageOperation ? `: ${cause.storageOperation}` : ''}`, { cause });
    error.storageOperation = operation;
    if (cause?.code) error.code = cause.code;
    return error;
  }

  async _stat(target, missing = false) {
    try { return await this._fs.lstat(target); }
    catch (error) { if (missing && error.code === 'ENOENT') return null; throw error; }
  }

  async _directory(target, create = false) {
    let stat = await this._stat(target, create);
    if (!stat && create) {
      try { await this._fs.mkdir(target, { mode: 0o700 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      stat = await this._stat(target);
    }
    if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe directory type');
  }

  async _root() {
    const anchor = path.parse(this._configuredRoot).root;
    let current = anchor;
    await this._directory(current);
    // Preserve '..' until after its preceding component was checked.
    for (const part of this._configuredRoot.slice(anchor.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      await this._directory(current, true);
    }
  }

  async _regular(target, missing = false) {
    const stat = await this._stat(target, missing);
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error('Unsafe file type');
    return stat;
  }

  async _using(handle, operation) {
    let result, failure;
    try { result = await operation(handle); } catch (error) { failure = error; }
    try { await handle.close(); } catch (error) {
      failure = failure ? new AggregateError([failure, error], 'File operation and close failed') : error;
    }
    if (failure) throw failure;
    return result;
  }

  async _read(target, missing = false) {
    if (!await this._regular(target, missing)) return null;
    const handle = await this._fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
    return this._using(handle, async file => {
      if (!(await file.stat()).isFile()) throw new Error('Unsafe opened file type');
      return file.readFile('utf8');
    });
  }

  async _exclusive(target, text, onOwned = () => {}) {
    const handle = await this._fs.open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
    onOwned();
    await this._using(handle, async file => {
      if (!(await file.stat()).isFile()) throw new Error('Unsafe opened file type');
      await file.writeFile(text, 'utf8');
    });
  }

  async _entry(name, key) {
    await this._root();
    const directory = path.join(this.root, key);
    let created = false;
    try { await this._fs.mkdir(directory, { mode: 0o700 }); created = true; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    await this._directory(directory);
    const identity = path.join(directory, 'identity.json');
    // Only the creator of a new directory may reserve its identity. An existing
    // entry without metadata is ambiguous (including interrupted creation).
    if (created) await this._exclusive(identity, JSON.stringify({ version: 1, name }));
    let metadata;
    try {
      const text = await this._read(identity);
      try { metadata = JSON.parse(text); } catch { throw new Error('Malformed identity metadata'); }
      if (!metadata || metadata.version !== 1 || metadata.name !== name ||
          Object.keys(metadata).length !== 2) throw new Error('Identity mismatch');
    } catch (error) { throw this._error('identity verification', key, error); }
    const payload = path.join(directory, 'graph.nt');
    await this._regular(payload, true);
    return { directory, payload };
  }

  async read(name) {
    const key = this.key(name);
    try {
      const { payload } = await this._entry(name, key);
      return (await this._read(payload, true)) ?? '';
    } catch (error) { throw this._error('read', key, error); }
  }

  async write(name, text) {
    const key = this.key(name);
    let temporary, owned = false;
    try {
      const { directory, payload } = await this._entry(name, key);
      temporary = path.join(directory, `.tmp-${randomUUID()}`);
      await this._exclusive(temporary, text, () => { owned = true; });
      // Revalidate before replacement as well as before opening the temporary.
      await this._entry(name, key);
      await this._fs.rename(temporary, payload);
      owned = false;
    } catch (error) {
      const primary = this._error('write', key, error);
      if (owned) {
        try {
          await this._root();
          await this._directory(path.dirname(temporary));
          await this._regular(temporary);
          await this._fs.unlink(temporary);
        } catch (cleanup) {
          throw new AggregateError([primary, this._error('temporary cleanup', key, cleanup)], `File storage write and cleanup failed [${key}]`);
        }
      }
      throw primary;
    }
  }
}
