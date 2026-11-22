const states = new Set(['supported', 'configured', 'unavailable', 'unknown']);
export const CAPABILITY_KEYS = Object.freeze(['rdf11', 'namedGraphs', 'defaultGraph', 'blankNodeGraphs',
  'rdfStar', 'variables', 'persistence', 'transactions', 'crossGraphAtomicity', 'streaming', 'duplicateQuads']);
/** Version 1: supported = inherent; configured = enabled by configuration;
 * unavailable = known absent; unknown = no guarantee. No optimistic defaults. */
export function createCapabilities(entries = {}) {
  for (const key of Object.keys(entries)) {
    if (!CAPABILITY_KEYS.includes(key)) throw new TypeError(`Unknown capability: ${key}`);
  }
  const features = {};
  for (const key of CAPABILITY_KEYS) {
    const entry = entries[key] ?? { status: 'unknown' };
    if (!states.has(entry.status) || (entry.detail !== undefined && typeof entry.detail !== 'string')) {
      throw new TypeError(`Invalid capability: ${key}`);
    }
    features[key] = Object.freeze({ status: entry.status, ...(entry.detail === undefined ? {} : { detail: entry.detail }) });
  }
  return Object.freeze({ version: 1, features: Object.freeze(features) });
}
