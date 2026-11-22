import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { n, b, l } from './terms.js';
import { termKey } from '@alt-javascript/jssgdbc-core';

// Deliberately NOT a SPARQL engine: graph forms with one triple, positional ?s/?p/?o,
// plus the exact generated multi-graph Dataset forms (no general UNION parser),
// optional GRAPH, and the exact SELECT/ASK/COUNT/DATA/CLEAR forms below.
// No prefixes, joins, filters or numeric shorthand. Request-local blank
// labels are supported for INSERT only. Wildcard DELETE supports
// only identical single-pattern DELETE/WHERE templates (not general updates).
const iri = '<[^<>\\s]+>';
const literal = '"(?:[^"\\\\\\r\\n]|\\\\(?:["\\\\nrtbf]|u[0-9a-fA-F]{4}))*"(?:@[a-zA-Z]+(?:-[a-zA-Z0-9]+)*|\\^\\^' + iri + ')?';
const triple = new RegExp(`^(${iri}|_:[a-zA-Z0-9]+|\\?s)\\s+(${iri}|\\?p)\\s+(${iri}|${literal}|_:[a-zA-Z0-9]+|\\?o)\\s+\\.$`);
const unsupported = () => { throw new Error('Unsupported fixture request'); };

function parse(text) {
  const clear = text.match(new RegExp(`^CLEAR (DEFAULT|GRAPH (${iri}))$`));
  if (clear) return { operation: 'CLEAR', graph: clear[2]?.slice(1, -1) ?? '' };
  const deletion = text.match(/^DELETE\s*\{([\s\S]*)\}\s*WHERE\s*\{([\s\S]*)\}$/);
  if (deletion) {
    if (deletion[1].trim() !== deletion[2].trim()) return unsupported();
    return { ...parse(`SELECT ?s ?p ?o WHERE {${deletion[2]}}`), operation: 'DELETE PATTERN' };
  }
  const outer = text.match(/^(SELECT \?s \?p \?o WHERE|SELECT \(COUNT\(\*\) AS \?count\) WHERE|ASK|INSERT DATA|DELETE DATA)\s*\{([\s\S]*)\}$/);
  if (!outer) return unsupported();
  const operation = outer[1].startsWith('SELECT (') ? 'COUNT'
    : outer[1].startsWith('SELECT ') ? 'SELECT' : outer[1];
  let body = outer[2].trim(), graph = '';
  const named = body.match(new RegExp(`^GRAPH (${iri})\\s*\\{([\\s\\S]*)\\}$`));
  if (named) { graph = named[1].slice(1, -1); body = named[2].trim(); }
  const match = body.match(triple);
  if (!match) return unsupported();
  const terms = match.slice(1);
  if (operation.endsWith('DATA') && terms.some(term => term.startsWith('?'))) return unsupported();
  return { operation, graph, terms };
}

function parseTerm(term, scope) {
  if (term.startsWith('?')) return term;
  if (term.startsWith('<')) return n(term.slice(1, -1));
  if (term.startsWith('_:')) return b(`${scope}_${term.slice(2)}`);
  const match = term.match(/^("(?:[^"\\]|\\.)*")(@[^\s]+|\^\^<[^>]+>)?$/);
  if (!match) return unsupported();
  return l(JSON.parse(match[1]), match[2]?.startsWith('@') ? match[2].slice(1).toLowerCase() : '',
    match[2]?.startsWith('^^') ? match[2].slice(3, -1) : undefined);
}
function binding(term) {
  if (term.termType === 'NamedNode') return { type: 'uri', value: term.value };
  if (term.termType === 'BlankNode') return { type: 'bnode', value: term.value };
  return { type: 'literal', value: term.value, ...(term.language
    ? { 'xml:lang': term.language } : { datatype: term.datatype.value }) };
}
const variable = term => typeof term === 'string' && term.startsWith('?');
const rowKey = terms => JSON.stringify(terms.map(termKey));

export async function startMockSparqlEndpoint() {
  const graphs = new Map(), requests = [], sockets = new Set();
  let dropNextUpdate = false;
  const acknowledge = res => {
    if (dropNextUpdate) { dropNextUpdate = false; res.destroy(); }
    else res.writeHead(204).end();
  };
  const server = http.createServer(async (req, res) => {
    // Records deliberately exclude URLs, authorization, raw RDF and bodies.
    const record = { method: req.method, operation: 'unsupported', graph: null,
      headers: { accept: req.headers.accept, 'content-type': req.headers['content-type'],
        'x-example': req.headers['x-example'] } };
    requests.push(record);
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      let text;
      if (url.pathname !== '/sparql') return unsupported();
      if (req.method === 'GET' && url.searchParams.getAll('query').length === 1) {
        text = url.searchParams.get('query');
      } else if (req.method === 'POST' && req.headers['content-type'] === 'application/sparql-update') {
        text = '';
        for await (const chunk of req) text += chunk;
      } else return unsupported();
      // Exact generated Dataset forms only; this is not a SPARQL parser/oracle.
      if (text.startsWith('SELECT ?s ?p ?o ?g WHERE { ')) {
        if (req.method !== 'GET') return unsupported();
        const inner = text.slice('SELECT ?s ?p ?o ?g WHERE { '.length, -2);
        const selections = inner.split(' UNION ').map(branch => {
          if (branch === '{ ?s ?p ?o . }') return '';
          const match = branch.match(/^\{ GRAPH <([^>]+)> \{\s*\?s \?p \?o \.\s*\} BIND\(<([^>]+)> AS \?g\) \}$/);
          if (!match || match[1] !== match[2]) return unsupported();
          return match[1];
        });
        record.operation = 'DATASET SELECT';
        const rows = selections.flatMap(graph => [...(graphs.get(graph)?.values() ?? [])].map(row => ({
          s: binding(row[0]), p: binding(row[1]), o: binding(row[2]),
          ...(graph ? { g: binding(n(graph)) } : {})
        })));
        res.writeHead(200, { 'Content-Type': 'application/sparql-results+json' }).end(JSON.stringify({
          head: { vars: ['s', 'p', 'o', 'g'] }, results: { bindings: rows }
        }));
        return;
      }
      if (text.includes(';\n') || text.startsWith('INSERT DATA {\n') && !text.startsWith('INSERT DATA {\n  ')) {
        if (req.method !== 'POST') return unsupported();
        record.operation = 'DATASET UPDATE';
        let rest = text;
        const scope = randomUUID();
        while (!rest.startsWith('INSERT DATA') && rest) {
          const end = rest.indexOf(';\n');
          const command = end < 0 ? rest : rest.slice(0, end);
          const parsed = parse(command);
          if (!['CLEAR', 'DELETE PATTERN'].includes(parsed.operation)) return unsupported();
          graphs.get(parsed.graph)?.clear();
          rest = end < 0 ? '' : rest.slice(end + 2);
        }
        if (rest) {
          if (!rest.startsWith('INSERT DATA {\n') || !rest.endsWith('\n}')) return unsupported();
          let graph = '';
          for (const raw of rest.slice('INSERT DATA {\n'.length, -2).split('\n')) {
            const line = raw.trim();
            const named = line.match(/^GRAPH <([^>]+)> \{$/);
            if (named) { graph = named[1]; continue; }
            if (line === '}') { graph = ''; continue; }
            const match = line.match(triple);
            if (!match) return unsupported();
            const terms = match.slice(1).map(term => parseTerm(term, scope));
            const data = graphs.get(graph) ?? new Map();
            graphs.set(graph, data); data.set(rowKey(terms), terms);
          }
        }
        acknowledge(res);
        return;
      }
      const parsed = parse(text.trim());
      const { operation, graph } = parsed;
      const scope = randomUUID();
      const terms = parsed.terms?.map(term => parseTerm(term, scope));
      const query = ['SELECT', 'COUNT', 'ASK'].includes(operation);
      if ((req.method === 'GET') !== query) return unsupported();
      Object.assign(record, { operation, graph });
      const data = graphs.get(graph) ?? new Map();
      graphs.set(graph, data);
      const rows = terms ? [...data.values()].filter(row => terms.every((term, i) => variable(term) || term.equals(row[i]))) : [];
      if (!query) {
        if (operation === 'CLEAR') data.clear();
        else if (operation === 'INSERT DATA') data.set(rowKey(terms), terms);
        else if (operation === 'DELETE PATTERN') {
          for (const row of rows) data.delete(rowKey(row));
        } else data.delete(rowKey(terms));
        acknowledge(res);
        return;
      }
      const result = operation === 'ASK' ? { head: {}, boolean: rows.length > 0 }
        : operation === 'COUNT' ? { head: { vars: ['count'] }, results: { bindings: [
          { count: { type: 'literal', datatype: 'http://www.w3.org/2001/XMLSchema#integer', value: String(rows.length) } }
        ] } }
          : { head: { vars: ['s', 'p', 'o'] }, results: { bindings: rows.map(row =>
            Object.fromEntries(terms.flatMap((term, i) => variable(term) ? [[term.slice(1), binding(row[i])]] : []))) } };
      res.writeHead(200, { 'Content-Type': 'application/sparql-results+json' }).end(JSON.stringify(result));
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Unsupported fixture request');
    }
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    endpoint: `http://127.0.0.1:${server.address().port}/sparql`, requests,
    dropNextUpdateResponse() { dropNextUpdate = true; },
    reset() { graphs.clear(); requests.length = 0; dropNextUpdate = false; },
    async close() {
      for (const socket of sockets) socket.destroy();
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  };
}
