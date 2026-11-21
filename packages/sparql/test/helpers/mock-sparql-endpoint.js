import http from 'node:http';

// Deliberately NOT a SPARQL engine: one triple, positional ?s/?p/?o,
// optional GRAPH, and the exact SELECT/ASK/COUNT/DATA/CLEAR forms below.
// Relative-looking IRIs (e.g. <subject1>) are opaque contract-test terms,
// not an assertion about a vendor's base-IRI resolution. No prefixes,
// joins, filters, blank nodes or numeric shorthand. Wildcard DELETE supports
// only identical single-pattern DELETE/WHERE templates (not general updates).
const iri = '<[^<>\\s]+>';
const literal = '"(?:[^"\\\\\\r\\n]|\\\\(?:["\\\\nrtbf]|u[0-9a-fA-F]{4}))*"(?:@[a-zA-Z]+(?:-[a-zA-Z0-9]+)*|\\^\\^' + iri + ')?';
const triple = new RegExp(`^(${iri}|\\?s)\\s+(${iri}|\\?p)\\s+(${iri}|${literal}|\\?o)\\s+\\.$`);
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

function binding(term) {
  if (term.startsWith('<')) return { type: 'uri', value: term.slice(1, -1) };
  const match = term.match(/^("(?:[^"\\]|\\.)*")(@[^\s]+|\^\^<[^>]+>)?$/);
  if (!match) return unsupported();
  const result = { type: 'literal', value: JSON.parse(match[1]) };
  if (match[2]?.startsWith('@')) result['xml:lang'] = match[2].slice(1);
  if (match[2]?.startsWith('^^')) result.datatype = match[2].slice(3, -1);
  return result;
}

export async function startMockSparqlEndpoint() {
  const graphs = new Map(), requests = [], sockets = new Set();
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
      const parsed = parse(text.trim());
      const { operation, graph, terms } = parsed;
      const query = ['SELECT', 'COUNT', 'ASK'].includes(operation);
      if ((req.method === 'GET') !== query) return unsupported();
      Object.assign(record, { operation, graph });
      const data = graphs.get(graph) ?? new Map();
      graphs.set(graph, data);
      const rows = terms ? [...data.values()].filter(row => terms.every((term, i) => term.startsWith('?') || term === row[i])) : [];
      if (!query) {
        if (operation === 'CLEAR') data.clear();
        else if (operation === 'INSERT DATA') data.set(JSON.stringify(terms), terms);
        else if (operation === 'DELETE PATTERN') {
          for (const row of rows) data.delete(JSON.stringify(row));
        } else data.delete(JSON.stringify(terms));
        res.writeHead(204).end();
        return;
      }
      const result = operation === 'ASK' ? { head: {}, boolean: rows.length > 0 }
        : operation === 'COUNT' ? { head: { vars: ['count'] }, results: { bindings: [
          { count: { type: 'literal', datatype: 'http://www.w3.org/2001/XMLSchema#integer', value: String(rows.length) } }
        ] } }
          : { head: { vars: ['s', 'p', 'o'] }, results: { bindings: rows.map(row =>
            Object.fromEntries(terms.flatMap((term, i) => term.startsWith('?') ? [[term.slice(1), binding(row[i])]] : []))) } };
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
    reset() { graphs.clear(); requests.length = 0; },
    async close() {
      for (const socket of sockets) socket.destroy();
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  };
}
