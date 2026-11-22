import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { readFileSync } from 'node:fs'
import { DataFactory as external, Store, Parser } from 'n3'
import factory, { Dataset, dataset } from '../index.js'

const n = value => external.namedNode(`urn:${value}`)
const b = value => external.blankNode(value)
const p = n('p')
const q = (s = n('s'), o = n('o'), g = external.defaultGraph()) => external.quad(s, p, o, g)
const a = q(); const c = q(n('c'), external.literal('01', n('integer')), n('g'))

test('DatasetFactory and DataFactory: independent terms, defaults, fresh blanks and copies', () => {
  assert.ok(factory.dataset() instanceof Dataset)
  for (const name of ['namedNode', 'blankNode', 'literal', 'variable', 'defaultGraph', 'quad', 'fromTerm', 'fromQuad']) assert.equal(typeof factory[name], 'function')
  assert.ok(factory.namedNode('urn:s').equals(n('s')))
  assert.notEqual(factory.blankNode().value, factory.blankNode().value)
  assert.equal(factory.literal('hello', 'en').language, 'en')
  assert.equal(factory.variable('x').termType, 'Variable')
  assert.ok(factory.fromQuad(a).equals(a))
  assert.ok(factory.fromTerm(n('s')).equals(n('s')))
  assert.equal(factory.quad(n('s'), p, n('o')).graph.termType, 'DefaultGraph')
})

test('Core size, iterator, add/delete/has identity and duplicate elimination', () => {
  const d = dataset([a, a, c])
  assert.equal(d.size, 2)
  assert.equal([...d].length, 2)
  assert.equal(d.add(factory.fromQuad(a)), d)
  assert.equal(d.size, 2)
  assert.equal(d.has(a), true)
  assert.equal(d.delete(a), d)
  assert.equal(d.delete(a), d)
  assert.equal(d.has(a), false)
  assert.equal(d.size, 1)
})

test('match and deleteMatches: null/undefined wildcard in each position and graph identity', () => {
  const d = dataset([a, c, q(n('s'), n('o'), n('g'))])
  assert.equal(d.match().size, 3)
  assert.equal(d.match(null, undefined, null, external.defaultGraph()).size, 1)
  assert.equal(d.match(n('s')).size, 2)
  assert.equal(d.match(external.literal('impossible')).size, 0)
  assert.equal(d.match(external.variable('x')).size, 0)
  assert.equal(d.match(null, p).size, 3)
  assert.equal(d.match(null, n('absent')).size, 0)
  assert.equal(d.match(null, null, n('o')).size, 2)
  assert.equal(d.match(null, null, null, n('g')).size, 2)
  const copy = d.match(); copy.deleteMatches()
  assert.equal(d.size, 3)
  assert.equal(d.deleteMatches(null, null, null, n('g')), d)
  assert.equal(d.size, 1)
})

test('addAll and pure set operations accept foreign Dataset and do not mutate source', () => {
  const source = new Store([a, c]); const before = [...source]
  const d = dataset([a])
  for (const [method, size] of [['difference', 0], ['intersection', 1], ['union', 2]]) {
    const result = d[method](source)
    assert.ok(result instanceof Dataset); assert.notEqual(result, d)
    assert.equal(result.size, size); assert.equal(d.size, 1)
  }
  assert.equal(d.addAll(source), d); assert.equal(d.size, 2)
  assert.deepEqual([...source], before)
  const input = Object.freeze([a, c]); dataset(input); assert.equal(input.length, 2)
})

test('set operations use term equality, not blank-node normalization', () => {
  const left = dataset([q(b('a'))]); const right = new Store([q(b('b'))])
  assert.equal(left.difference(right).size, 1)
  assert.equal(left.intersection(right).size, 0)
  assert.equal(left.union(right).size, 2)
  assert.equal(left.equals(right), true)
})

test('callbacks receive normative arguments, short circuit, return types and deduplicate map', () => {
  const d = dataset([a, c]); let calls = 0
  const check = (...args) => { assert.equal(args.length, 2); assert.equal(args[1], d); calls++; return true }
  assert.equal(d.every(check), true); assert.equal(calls, 2)
  calls = 0; assert.equal(d.some(check), true); assert.equal(calls, 1)
  calls = 0; assert.equal(d.every(() => { calls++; return false }), false); assert.equal(calls, 1)
  assert.equal(d.filter(check).size, 2)
  assert.equal(d.forEach(check), undefined)
  const mapped = d.map((...args) => { check(...args); return a })
  assert.ok(mapped instanceof Dataset); assert.equal(mapped.size, 1)
  assert.equal(d.reduce((...args) => { assert.equal(args.length, 3); assert.equal(args[2], d); return args[0] + 1 }, 0), 2)
  assert.ok(dataset([a]).reduce(() => assert.fail()).equals(a))
  const empty = dataset()
  assert.equal(empty.every(() => assert.fail()), true)
  assert.equal(empty.some(() => assert.fail()), false)
  assert.equal(empty.reduce(() => assert.fail(), undefined), undefined)
  assert.throws(() => empty.reduce(() => {}), TypeError)
})

test('callback errors and invalid map output propagate', () => {
  const d = dataset([a]); const failure = new Error('callback failed')
  for (const name of ['every', 'some', 'filter', 'map', 'forEach', 'reduce']) {
    assert.throws(() => d[name](() => { throw failure }, 0), error => error === failure)
  }
  assert.throws(() => d.map(() => null), TypeError)
  assert.equal(d.size, 1)
})

test('import resolves to receiver, buffers duplicates; toStream snapshots object-mode quads', async () => {
  const d = dataset(); const pending = d.import(Readable.from([a, c, a]))
  assert.ok(pending instanceof Promise); assert.equal(await pending, d); assert.equal(d.size, 2)
  const stream = d.toStream(); assert.equal(stream.readableObjectMode, true)
  d.deleteMatches()
  const values = []; for await (const quad of stream) values.push(quad)
  assert.equal(values.length, 2); assert.equal(dataset(values).has(a), true)
  assert.equal(await d.import(Readable.from([])), d)
})

test('import rejects source failure, premature close and malformed quads (partial state retained)', async () => {
  const error = new Error('connection lost'); const d = dataset()
  const source = Readable.from((async function * () { yield a; throw error })())
  await assert.rejects(d.import(source), e => e === error)
  assert.equal(d.has(a), true)
  await assert.rejects(dataset().import(Readable.from([{}])), TypeError)
  const broken = new Readable({ objectMode: true, read () { this.destroy() } })
  await assert.rejects(dataset().import(broken), { code: 'ERR_STREAM_PREMATURE_CLOSE' })
})

test('canonicalization is synchronous, sorted RDFC-1.0 N-Quads and source invariant', () => {
  const d = dataset([q(b('local'), external.literal('hi\n"', 'en')), c])
  const before = d.toString()
  const canonical = d.toCanonical()
  assert.equal(typeof canonical, 'string')
  assert.ok(canonical.includes('_:c14n0'))
  assert.equal(d.toString(), before)
  const parsed = new Store(new Parser({ format: 'N-Quads' }).parse(canonical))
  assert.equal(d.equals(parsed), true)
  assert.equal(d.equals(new Store([...d].reverse())), true)
  assert.equal(dataset([a]).toCanonical(), '<urn:s> <urn:p> <urn:o> .\n')
  assert.equal(dataset().toCanonical(), '')
})

test('lexical, language, datatype and graph distinctions survive N-Quads', () => {
  const d = dataset([
    q(n('s'), external.literal('01', n('integer'))), q(n('s'), external.literal('1', n('integer'))),
    q(n('s'), external.literal('1')), q(n('s'), external.literal('1', 'en')),
    q(n('s'), external.literal('1', 'fr')), q(n('s'), external.literal('1'), n('g'))
  ])
  assert.equal(d.size, 6)
  assert.equal(d.equals(new Store(new Parser({ format: 'N-Quads' }).parse(d.toString()))), true)
})

test('equals respects cross-graph blank-node sharing and graph blank nodes', () => {
  const left = dataset([q(b('x'), b('y')), q(b('y'), b('x'), b('x'))])
  const renamed = new Store([q(b('a'), b('b')), q(b('b'), b('a'), b('a'))])
  assert.equal(left.equals(renamed), true)
  assert.equal(left.equals(new Store([q(b('a'), b('b')), q(b('b'), b('c'), b('a'))])), false)
  assert.equal(left.equals(new Store([q(b('a'), b('b'))])), false)
})

test('contains finds asymmetric embedded subset despite surrounding structure', () => {
  const host = dataset([q(b('a'), b('b')), q(b('b'), n('end')), q(b('a'), n('extra')), q(b('z'), b('a'))])
  const sub = new Store([q(b('x'), b('y')), q(b('y'), n('end'))])
  const before = [...sub]
  assert.equal(host.contains(sub), true)
  assert.equal(dataset(sub).contains(host), false)
  assert.deepEqual([...sub], before)
  assert.equal(host.contains(new Store()), true)
  assert.equal(dataset().contains(new Store([a])), false)
})

test('contains backtracks and enforces injection, repeated blanks and cross-graph sharing', () => {
  const host = dataset([q(b('bad'), b('dead')), q(b('good'), b('tail')), q(b('tail'), n('end'), n('g'))])
  assert.equal(host.contains(new Store([q(b('x'), b('y')), q(b('y'), n('end'), n('g'))])), true)
  assert.equal(host.contains(new Store([q(b('x'), b('y')), q(b('x'), n('end'), n('g'))])), false)
  assert.equal(dataset([q(b('one'), b('one'))]).contains(new Store([q(b('x'), b('y'))])), false)
  assert.equal(dataset([q(b('one'), b('two'))]).contains(new Store([q(b('x'), b('x'))])), false)
  assert.equal(dataset([q(n('fixed'))]).contains(new Store([q(b('x'))])), false)
  assert.equal(dataset([q(b('a'), b('b'), b('a'))]).contains(new Store([q(b('x'), b('y'), b('x'))])), true)
  assert.equal(dataset([q(b('a'), b('b'), b('c'))]).contains(new Store([q(b('x'), b('y'), b('x'))])), false)
})

test('unsupported positions, variables, nested quads, relative IRIs and directional literals fail explicitly', () => {
  const invalid = [external.quad(external.literal('s'), p, n('o')), q(external.variable('x')), q(a),
    q(n('s'), external.variable('o')), q(n('s'), n('o'), external.literal('g')),
    q(external.namedNode('relative')), { ...a, subject: { termType: 'BlankNode', value: '' } },
    { ...a, object: { termType: 'Literal', value: 'hi', language: 'en', direction: 'ltr', datatype: n('type') } }]
  for (const quad of invalid) assert.throws(() => dataset([quad]), TypeError)
  assert.throws(() => dataset([{}]), TypeError)
})

test('foreign mutable quad data and nonstandard id cannot corrupt Dataset indexes', () => {
  const subject = { termType: 'NamedNode', value: 'urn:s', id: 'urn:wrong' }
  const input = { termType: 'Quad', value: '', subject, predicate: p, object: n('o'), graph: external.defaultGraph() }
  const d = dataset([input]); subject.value = 'urn:changed'
  assert.equal(d.has(a), true); assert.equal(d.size, 1)
})

const fixture = file => readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')
for (const id of ['003', '020', '044', '057', '060', '076', '077']) {
  test(`W3C RDFC-1.0 vector ${id}`, () => {
    const input = new Parser({ format: 'N-Quads' }).parse(fixture(`test${id}-in.nq`))
    assert.equal(dataset(input).toCanonical(), fixture(`test${id}-rdfc10.nq`))
  })
}

test('canonicalizer complexity failure bubbles and leaves source unchanged (W3C poison graph 074)', () => {
  const input = new Parser({ format: 'N-Quads' }).parse(fixture('test074-in.nq'))
  const d = dataset(input); const before = d.toString()
  assert.throws(() => d.toCanonical(), /Maximum deep iterations exceeded/)
  assert.throws(() => d.equals(new Store(input)), /Maximum deep iterations exceeded/)
  assert.equal(d.toString(), before)
})

test('10x representative ground load: 1000 to 10000 quads', t => {
  for (const size of [1000, 10000]) {
    const start = performance.now()
    const source = new Store(Array.from({ length: size }, (_, i) => q(n(`s${i}`))))
    const d = dataset(source)
    assert.equal(d.size, size)
    assert.equal(d.contains(source), true)
    assert.equal(d.equals(source), true)
    assert.equal(d.match().size, size)
    t.diagnostic(`${size} ground quads: ${(performance.now() - start).toFixed(1)}ms, heapUsed=${process.memoryUsage().heapUsed}`)
  }
})
