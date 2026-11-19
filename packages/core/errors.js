export class UnsupportedOperationError extends Error {
  constructor(message = 'Operation not supported') {
    super(message);
    this.name = 'UnsupportedOperationError';
  }
}
