import coreFactory from '@rdfjs/dataset'
import dataFactory from '@rdfjs/data-model'
import normalize from '@rdfjs/normalize'
import toNQuads from '@rdfjs/to-ntriples'
import { Readable } from 'node:stream'

const positions = ['subject', 'predicate', 'object', 'graph']
const kinds = [new Set(['NamedNode', 'BlankNode']), new Set(['NamedNode']),
  new Set(['NamedNode', 'BlankNode', 'Literal']), new Set(['NamedNode', 'BlankNode', 'DefaultGraph'])]

// Copy foreign terms rather than trusting implementation-specific .id shortcuts.
function term (input, allowed) {
  if (!input || !allowed.has(input.termType) || typeof input.value !== 'string') {
    throw new TypeError('Unsupported RDF 1.1 term or position')
  }
  let result
  switch (input.termType) {
    case 'NamedNode':
      if (!/^[a-z][a-z0-9+.-]*:/i.test(input.value)) throw new TypeError('Expected absolute IRI')
      result = dataFactory.namedNode(input.value); break
    case 'BlankNode':
      if (!input.value) throw new TypeError('Expected blank node label')
      result = dataFactory.blankNode(input.value); break
    case 'DefaultGraph':
      if (input.value !== '') throw new TypeError('DefaultGraph value must be empty')
      result = dataFactory.defaultGraph(); break
    case 'Literal': {
      if (typeof input.language !== 'string' || input.direction) throw new TypeError('Expected RDF 1.1 literal')
      const datatype = term(input.datatype, kinds[1])
      if (input.language && datatype.value !== 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString') {
        throw new TypeError('Language literal requires rdf:langString')
      }
      result = dataFactory.literal(input.value, input.language || datatype)
      Object.freeze(result.datatype)
      break
    }
  }
  return Object.freeze(result)
}

function copyQuad (quad) {
  if (!quad || quad.termType !== 'Quad') throw new TypeError('Expected RDF/JS Quad')
  return Object.freeze(dataFactory.quad(...positions.map((key, i) => term(quad[key], kinds[i]))))
}

export class Dataset {
  #core = coreFactory.dataset()

  constructor (quads = []) { this.addAll(quads) }
  get size () { return this.#core.size }
  [Symbol.iterator] () { return this.#core[Symbol.iterator]() }
  add (quad) { this.#core.add(copyQuad(quad)); return this }
  delete (quad) { this.#core.delete(copyQuad(quad)); return this }
  has (quad) { return this.#core.has(copyQuad(quad)) }
  match (subject = null, predicate = null, object = null, graph = null) {
    const inputs = [subject, predicate, object, graph]
    // A valid Term in an impossible position is a non-match, not a wildcard/error.
    if (inputs.some((t, i) => t != null && !kinds[i].has(t.termType))) {
      return this.filter(q => positions.every((key, i) => inputs[i] == null || q[key].equals(inputs[i])))
    }
    const args = inputs.map((t, i) => t == null ? null : term(t, kinds[i]))
    return new Dataset(this.#core.match(...args))
  }
  addAll (quads) { for (const quad of quads) this.add(quad); return this }
  deleteMatches (...args) { for (const quad of this.match(...args)) this.delete(quad); return this }
  difference (other) { const set = new Dataset(other); return this.filter(q => !set.has(q)) }
  intersection (other) { const set = new Dataset(other); return this.filter(q => set.has(q)) }
  union (other) { return new Dataset(this).addAll(other) }
  every (fn) { return [...this].every(q => fn(q, this)) }
  some (fn) { return [...this].some(q => fn(q, this)) }
  filter (fn) { return new Dataset([...this].filter(q => fn(q, this))) }
  map (fn) { return new Dataset([...this].map(q => fn(q, this))) }
  forEach (fn) { [...this].forEach(q => fn(q, this)) }
  reduce (fn, ...initial) {
    return [...this].reduce((acc, q) => fn(acc, q, this), ...initial.slice(0, 1))
  }
  async import (stream) {
    // Node's async iterator propagates error and premature close, and cleans up on failure.
    for await (const quad of stream) this.add(quad)
    return this
  }
  toStream () { return Readable.from([...this], { objectMode: true }) }
  toString () { return toNQuads(this) }
  toCanonical () { return normalize(this) }
  equals (other) {
    const dataset = new Dataset(other)
    return this.size === dataset.size && this.toCanonical() === dataset.toCanonical()
  }
  contains (other) {
    const pattern = new Dataset(other)
    if (pattern.size > this.size) return false
    // Injective renaming of blank nodes, shared over ALL positions and graphs.
    // Order by candidate count; backtrack rather than independently canonicalizing subsets.
    const ground = [...pattern].filter(q => !positions.some(key => q[key].termType === 'BlankNode'))
    if (ground.some(q => !this.has(q))) return false
    const targets = [...this]
    const candidates = [...pattern].filter(q => positions.some(key => q[key].termType === 'BlankNode'))
      .map(q => ({ q, matches: targets.filter(target =>
      positions.every(key => q[key].termType === 'BlankNode'
        ? target[key].termType === 'BlankNode' : q[key].equals(target[key]))) }))
      .sort((a, b) => a.matches.length - b.matches.length)
    const stack = [{ index: 0, choice: 0, forward: new Map(), reverse: new Map() }]
    while (stack.length) {
      const frame = stack[stack.length - 1]
      if (frame.index === candidates.length) return true
      const { q, matches } = candidates[frame.index]
      if (frame.choice === matches.length) { stack.pop(); continue }
      const target = matches[frame.choice++]
      {
        const next = new Map(frame.forward)
        const inverse = new Map(frame.reverse)
        let valid = true
        for (const key of positions) {
          if (q[key].termType !== 'BlankNode') continue
          const from = q[key].value; const to = target[key].value
          if ((next.has(from) && next.get(from) !== to) || (inverse.has(to) && inverse.get(to) !== from)) {
            valid = false; break
          }
          next.set(from, to); inverse.set(to, from)
        }
        if (valid) stack.push({ index: frame.index + 1, choice: 0, forward: next, reverse: inverse })
      }
    }
    return false
  }
}

export const dataset = quads => new Dataset(quads)
// DataFactory methods retain their own receiver (notably fresh blank-node allocation).
export const factory = Object.freeze(Object.fromEntries([
  ...['namedNode', 'blankNode', 'literal', 'variable', 'defaultGraph', 'quad', 'fromTerm', 'fromQuad']
    .map(name => [name, dataFactory[name].bind(dataFactory)]),
  ['dataset', dataset]
]))
export { factory as default }
