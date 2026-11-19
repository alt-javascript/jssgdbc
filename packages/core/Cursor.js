export class Cursor {
  constructor(triples = []) {
    this._triples = triples;
    this._cursor = -1;
    this._closed = false;
  }

  async next() {
    this._checkClosed();
    this._cursor++;
    return this._cursor < this._triples.length;
  }

  getTriple() {
    this._checkClosed();
    this._checkCursor();
    return { ...this._triples[this._cursor] };
  }

  getTriples() {
    this._checkClosed();
    return this._triples.map(t => ({ ...t }));
  }

  close() {
    this._closed = true;
  }

  isClosed() {
    return this._closed;
  }

  _checkClosed() {
    if (this._closed) {
      throw new Error('Cursor is closed');
    }
  }

  _checkCursor() {
    if (this._cursor < 0 || this._cursor >= this._triples.length) {
      throw new Error('Cursor position out of bounds');
    }
  }

  async *[Symbol.asyncIterator]() {
    while (await this.next()) {
      yield this.getTriple();
    }
  }
}
