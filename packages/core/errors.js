export class UnsupportedOperationError extends Error {
  constructor(message = 'Operation not supported') {
    super(message);
    this.name = 'UnsupportedOperationError';
  }
}

export class UnsupportedRdfFeatureError extends UnsupportedOperationError {
  constructor(message, feature, position) {
    super(message);
    this.name = 'UnsupportedRdfFeatureError';
    this.feature = feature;
    this.position = position;
  }
}
