export class DatasetSaveError extends Error {
  constructor(message, cause, outcomes) {
    super(message, { cause });
    this.name = 'DatasetSaveError';
    this.outcomes = Object.freeze(outcomes.map(outcome => Object.freeze({ ...outcome })));
  }
}

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
