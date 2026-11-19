import { UnsupportedOperationError } from './errors.js';

export class Driver {
  acceptsURL(url) {
    throw new UnsupportedOperationError('acceptsURL not implemented');
  }

  async connect(url, properties) {
    throw new UnsupportedOperationError('connect not implemented');
  }
}
