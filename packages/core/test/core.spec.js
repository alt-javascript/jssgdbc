import { expect } from 'chai';
import { Driver, DriverManager, Client, ClientDataSource, Graph, Cursor, UnsupportedOperationError } from '../index.js';

describe('UnsupportedOperationError', () => {
  it('extends Error', () => {
    const err = new UnsupportedOperationError('test');
    expect(err).to.be.instanceof(Error);
  });

  it('has name property set to UnsupportedOperationError', () => {
    const err = new UnsupportedOperationError('test');
    expect(err.name).to.equal('UnsupportedOperationError');
  });

  it('preserves message', () => {
    const msg = 'operation not supported';
    const err = new UnsupportedOperationError(msg);
    expect(err.message).to.equal(msg);
  });
});

describe('DriverManager dispatch', () => {
  beforeEach(() => {
    DriverManager.clear();
  });

  it('throws Error with "No suitable driver" when no drivers registered', async () => {
    try {
      await DriverManager.getClient('jssgdbc:nonexistent:', {});
      expect.fail('should have thrown');
    } catch (e) {
      expect(e.message).to.include('No suitable driver');
    }
  });

  it('calls driver.connect when acceptsURL matches', async () => {
    let connectCalled = false;
    const mockDriver = {
      acceptsURL(url) {
        return url === 'jssgdbc:test:';
      },
      async connect(url, properties) {
        connectCalled = true;
        return new Client(this, url, properties);
      }
    };

    DriverManager.registerDriver(mockDriver);
    const client = await DriverManager.getClient('jssgdbc:test:', {});

    expect(connectCalled).to.be.true;
    expect(client).to.be.instanceof(Client);
  });

  it('tries drivers in order and returns first match', async () => {
    const callOrder = [];
    const driver1 = {
      acceptsURL(url) {
        callOrder.push('driver1');
        return false;
      },
      async connect() { }
    };
    const driver2 = {
      acceptsURL(url) {
        callOrder.push('driver2');
        return url === 'jssgdbc:match:';
      },
      async connect(url, properties) {
        return new Client(this, url, properties);
      }
    };

    DriverManager.registerDriver(driver1);
    DriverManager.registerDriver(driver2);
    await DriverManager.getClient('jssgdbc:match:', {});

    expect(callOrder).to.deep.equal(['driver1', 'driver2']);
  });

  it('deregisterDriver removes driver', async () => {
    const driver = {
      acceptsURL() { return true; },
      async connect() { }
    };

    DriverManager.registerDriver(driver);
    expect(DriverManager.getDrivers()).to.have.length(1);

    DriverManager.deregisterDriver(driver);
    expect(DriverManager.getDrivers()).to.have.length(0);
  });

  it('clear empties all drivers', () => {
    DriverManager.registerDriver({ acceptsURL() { }, async connect() { } });
    DriverManager.registerDriver({ acceptsURL() { }, async connect() { } });
    expect(DriverManager.getDrivers()).to.have.length(2);

    DriverManager.clear();
    expect(DriverManager.getDrivers()).to.have.length(0);
  });

  it('getDrivers returns copy, not reference', () => {
    const driver = { acceptsURL() { }, async connect() { } };
    DriverManager.registerDriver(driver);

    const drivers1 = DriverManager.getDrivers();
    const drivers2 = DriverManager.getDrivers();

    expect(drivers1).to.deep.equal(drivers2);
    expect(drivers1).to.not.equal(drivers2);
  });
});

describe('Cursor iteration', () => {
  it('constructs with triples array', () => {
    const triples = [
      { s: 'urn:s1', p: 'urn:p1', o: 'urn:o1' },
      { s: 'urn:s2', p: 'urn:p2', o: 'urn:o2' }
    ];
    const cursor = new Cursor(triples);
    expect(cursor).to.be.instanceof(Cursor);
  });

  it('next() returns true for each triple, then false', async () => {
    const triples = [
      { s: 'urn:s1', p: 'urn:p1', o: 'urn:o1' },
      { s: 'urn:s2', p: 'urn:p2', o: 'urn:o2' }
    ];
    const cursor = new Cursor(triples);

    expect(await cursor.next()).to.be.true;
    expect(await cursor.next()).to.be.true;
    expect(await cursor.next()).to.be.false;
  });

  it('getTriple() returns shallow copy of current item', async () => {
    const triples = [{ s: 'urn:s1', p: 'urn:p1', o: 'urn:o1' }];
    const cursor = new Cursor(triples);

    await cursor.next();
    const triple = cursor.getTriple();

    expect(triple).to.deep.equal(triples[0]);
    expect(triple).to.not.equal(triples[0]);
  });

  it('getTriples() returns all as shallow copies', () => {
    const triples = [
      { s: 'urn:s1', p: 'urn:p1', o: 'urn:o1' },
      { s: 'urn:s2', p: 'urn:p2', o: 'urn:o2' }
    ];
    const cursor = new Cursor(triples);

    const result = cursor.getTriples();

    expect(result).to.deep.equal(triples);
    result.forEach((t, i) => {
      expect(t).to.not.equal(triples[i]);
    });
  });

  it('async iterator yields all triples', async () => {
    const triples = [
      { s: 'urn:s1', p: 'urn:p1', o: 'urn:o1' },
      { s: 'urn:s2', p: 'urn:p2', o: 'urn:o2' }
    ];
    const cursor = new Cursor(triples);

    const yielded = [];
    for await (const triple of cursor) {
      yielded.push(triple);
    }

    expect(yielded).to.have.length(2);
    expect(yielded[0]).to.deep.equal(triples[0]);
    expect(yielded[1]).to.deep.equal(triples[1]);
  });

  it('empty cursor next() returns false immediately', async () => {
    const cursor = new Cursor([]);
    expect(await cursor.next()).to.be.false;
  });

  it('close() sets isClosed() to true', () => {
    const cursor = new Cursor([]);
    expect(cursor.isClosed()).to.be.false;

    cursor.close();
    expect(cursor.isClosed()).to.be.true;
  });

  it('next() throws after close()', async () => {
    const cursor = new Cursor([{ s: 'urn:s1', p: 'urn:p1', o: 'urn:o1' }]);
    cursor.close();

    try {
      await cursor.next();
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).to.be.instanceof(Error);
    }
  });

  it('getTriple() throws when cursor not positioned', async () => {
    const cursor = new Cursor([{ s: 'urn:s1', p: 'urn:p1', o: 'urn:o1' }]);

    try {
      cursor.getTriple();
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).to.be.instanceof(Error);
    }
  });

  it('getTriples() throws after close()', () => {
    const cursor = new Cursor([{ s: 'urn:s1', p: 'urn:p1', o: 'urn:o1' }]);
    cursor.close();

    try {
      cursor.getTriples();
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).to.be.instanceof(Error);
    }
  });
});

describe('Graph abstract stubs', () => {
  it('add() throws UnsupportedOperationError', async () => {
    const graph = new Graph(null, 'test');

    try {
      await graph.add('urn:s', 'urn:p', 'urn:o');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).to.be.instanceof(UnsupportedOperationError);
    }
  });

  it('remove() throws UnsupportedOperationError', async () => {
    const graph = new Graph(null, 'test');

    try {
      await graph.remove('urn:s', 'urn:p', 'urn:o');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).to.be.instanceof(UnsupportedOperationError);
    }
  });

  it('find() throws UnsupportedOperationError', async () => {
    const graph = new Graph(null, 'test');

    try {
      await graph.find('urn:s', 'urn:p', 'urn:o');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).to.be.instanceof(UnsupportedOperationError);
    }
  });

  it('has() throws UnsupportedOperationError', async () => {
    const graph = new Graph(null, 'test');

    try {
      await graph.has('urn:s', 'urn:p', 'urn:o');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).to.be.instanceof(UnsupportedOperationError);
    }
  });

  it('count() throws UnsupportedOperationError', async () => {
    const graph = new Graph(null, 'test');

    try {
      await graph.count('urn:s', 'urn:p', 'urn:o');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).to.be.instanceof(UnsupportedOperationError);
    }
  });

  it('clear() throws UnsupportedOperationError', async () => {
    const graph = new Graph(null, 'test');

    try {
      await graph.clear();
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).to.be.instanceof(UnsupportedOperationError);
    }
  });

  it('after close(), add() throws closed error before stub', async () => {
    const graph = new Graph(null, 'test');
    graph.close();

    try {
      await graph.add('urn:s', 'urn:p', 'urn:o');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).to.be.instanceof(Error);
      expect(e.message).to.include('closed');
    }
  });

  it('close() sets isClosed() to true', () => {
    const graph = new Graph(null, 'test');
    expect(graph.isClosed()).to.be.false;

    graph.close();
    expect(graph.isClosed()).to.be.true;
  });

  it('getName() returns graph name', () => {
    const graph = new Graph(null, 'myGraph');
    expect(graph.getName()).to.equal('myGraph');
  });
});

describe('Client closed guard', () => {
  it('getUrl() returns URL passed to constructor', () => {
    const mockDriver = { acceptsURL() { }, async connect() { } };
    const client = new Client(mockDriver, 'jssgdbc:test:', { prop: 'value' });

    expect(client.getUrl()).to.equal('jssgdbc:test:');
  });

  it('isClosed() returns false before close()', () => {
    const mockDriver = { acceptsURL() { }, async connect() { } };
    const client = new Client(mockDriver, 'jssgdbc:test:', {});

    expect(client.isClosed()).to.be.false;
  });

  it('close() sets isClosed() to true', () => {
    const mockDriver = { acceptsURL() { }, async connect() { } };
    const client = new Client(mockDriver, 'jssgdbc:test:', {});

    client.close();
    expect(client.isClosed()).to.be.true;
  });

  it('getGraph() after close() throws', () => {
    const mockDriver = { acceptsURL() { }, async connect() { } };
    const client = new Client(mockDriver, 'jssgdbc:test:', {});

    client.close();

    try {
      client.getGraph('test');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).to.be.instanceof(Error);
    }
  });

  it('getGraph() caches and returns same graph instance', () => {
    // Create a test client that implements _getGraph
    class TestClient extends Client {
      _getGraph(name) {
        return new Graph(this, name);
      }
    }

    const mockDriver = { acceptsURL() { }, async connect() { } };
    const client = new TestClient(mockDriver, 'jssgdbc:test:', {});

    const graph1 = client.getGraph('test');
    const graph2 = client.getGraph('test');

    expect(graph1).to.equal(graph2);
  });

  it('getGraph() with different names returns different instances', () => {
    class TestClient extends Client {
      _getGraph(name) {
        return new Graph(this, name);
      }
    }

    const mockDriver = { acceptsURL() { }, async connect() { } };
    const client = new TestClient(mockDriver, 'jssgdbc:test:', {});

    const graph1 = client.getGraph('graph1');
    const graph2 = client.getGraph('graph2');

    expect(graph1).to.not.equal(graph2);
  });

  it('getGraph() with default name', () => {
    class TestClient extends Client {
      _getGraph(name) {
        return new Graph(this, name);
      }
    }

    const mockDriver = { acceptsURL() { }, async connect() { } };
    const client = new TestClient(mockDriver, 'jssgdbc:test:', {});

    const graph = client.getGraph();
    expect(graph).to.be.instanceof(Graph);
  });
});

describe('ClientDataSource', () => {
  beforeEach(() => {
    DriverManager.clear();
  });

  it('constructs with URL and properties', () => {
    const ds = new ClientDataSource('jssgdbc:test:', { prop: 'value' });
    expect(ds).to.be.instanceof(ClientDataSource);
  });

  it('getClient() throws no suitable driver when no drivers registered', async () => {
    const ds = new ClientDataSource('jssgdbc:test:', {});

    try {
      await ds.getClient();
      expect.fail('should have thrown');
    } catch (e) {
      expect(e.message).to.include('No suitable driver');
    }
  });

  it('getClient() delegates to DriverManager', async () => {
    const mockDriver = {
      acceptsURL(url) {
        return url === 'jssgdbc:test:';
      },
      async connect(url, properties) {
        return new Client(this, url, properties);
      }
    };

    DriverManager.registerDriver(mockDriver);
    const ds = new ClientDataSource('jssgdbc:test:', { prop: 'value' });
    const client = await ds.getClient();

    expect(client).to.be.instanceof(Client);
    expect(client.getUrl()).to.equal('jssgdbc:test:');
  });
});
