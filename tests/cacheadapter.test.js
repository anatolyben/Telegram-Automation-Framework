import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CacheAdapter } from '../src/adapters/databases/CacheAdapter.js';
import { makeDb, makeCache } from './helpers/mocks.js';

function make(dbRows = {}, opts = {}) {
  const db    = makeDb(dbRows);
  const cache = makeCache();
  const ca    = new CacheAdapter(db, cache, opts);
  return { ca, db, cache };
}

// ─── cache hits ──────────────────────────────────────────────────────────────

describe('CacheAdapter – cache hits', () => {
  it('returns cached result on second query() call', async () => {
    const { ca, db } = make({ 'SELECT 1': [{ val: 1 }] });

    await ca.query('SELECT 1');
    await ca.query('SELECT 1');

    assert.equal(db.calls.query, 1, 'DB should only be hit once');
  });

  it('returns cached result on second queryOne() call', async () => {
    const { ca, db } = make({ 'SELECT a': [{ a: 1 }] });

    await ca.queryOne('SELECT a');
    await ca.queryOne('SELECT a');

    assert.equal(db.calls.queryOne, 1);
  });

  it('returns cached result on second queryAll() call', async () => {
    const { ca, db } = make({ 'SELECT *': [{ id: 1 }] });

    await ca.queryAll('SELECT *');
    await ca.queryAll('SELECT *');

    assert.equal(db.calls.queryAll, 1);
  });

  it('returns cached result on second findById() call', async () => {
    const { ca, db } = make({ users: [{ id: 1, name: 'Alice' }] });

    await ca.findById('users', 1);
    await ca.findById('users', 1);

    assert.equal(db.calls.findById, 1);
  });

  it('returns cached result on second findAll() call', async () => {
    const { ca, db } = make({ users: [{ id: 1 }] });

    await ca.findAll('users');
    await ca.findAll('users');

    assert.equal(db.calls.findAll, 1);
  });
});

// ─── scoped cache invalidation ───────────────────────────────────────────────

describe('CacheAdapter – scoped invalidation', () => {
  it('insert() invalidates keys for that table only', async () => {
    const { ca, cache } = make({ users: [{ id: 1 }], posts: [{ id: 10 }] });

    // Populate cache for both tables
    await ca.findAll('users');
    await ca.findAll('posts');

    const usersCacheKey = 'users:all';
    const postsCacheKey = 'posts:all';
    assert.ok(cache.store.has(usersCacheKey), 'users cached');
    assert.ok(cache.store.has(postsCacheKey), 'posts cached');

    await ca.insert('users', { id: 2, name: 'Bob' });

    assert.equal(cache.store.has(usersCacheKey), false, 'users cache should be cleared');
    assert.equal(cache.store.has(postsCacheKey), true,  'posts cache should NOT be cleared');
  });

  it('update() invalidates keys for that table only', async () => {
    const { ca, cache } = make({ users: [{ id: 1 }], posts: [{ id: 10 }] });

    await ca.findAll('users');
    await ca.findAll('posts');

    await ca.update('users', { name: 'New' }, { id: 1 });

    assert.equal(cache.store.has('users:all'), false);
    assert.equal(cache.store.has('posts:all'), true);
  });

  it('delete() invalidates keys for that table only', async () => {
    const { ca, cache } = make({ users: [{ id: 1 }], posts: [{ id: 10 }] });

    await ca.findAll('users');
    await ca.findAll('posts');

    await ca.delete('users', { id: 1 });

    assert.equal(cache.store.has('users:all'), false);
    assert.equal(cache.store.has('posts:all'), true);
  });

  it('after invalidation, next findAll() hits DB again', async () => {
    const { ca, db } = make({ users: [{ id: 1 }] });

    await ca.findAll('users');        // hit DB
    await ca.insert('users', { id: 2 }); // invalidate
    await ca.findAll('users');        // should hit DB again

    assert.equal(db.calls.findAll, 2);
  });
});

// ─── configurable TTL ────────────────────────────────────────────────────────

describe('CacheAdapter – configurable TTL', () => {
  it('passes custom TTL to cache.set', async () => {
    const db = makeDb({ tbl: [{ id: 1 }] });
    const cache = makeCache();
    let usedTTL = null;
    cache.set = async (k, v, ttl) => { usedTTL = ttl; cache.store.set(k, v); };

    const ca = new CacheAdapter(db, cache, { ttl: 120 });
    await ca.findAll('tbl');

    assert.equal(usedTTL, 120);
  });

  it('uses default TTL of 3600 when no option provided', async () => {
    const db = makeDb({ tbl: [] });
    const cache = makeCache();
    let usedTTL = null;
    cache.set = async (k, v, ttl) => { usedTTL = ttl; cache.store.set(k, v); };

    const ca = new CacheAdapter(db, cache);
    await ca.findAll('tbl');

    assert.equal(usedTTL, 3600);
  });
});

// ─── transaction ─────────────────────────────────────────────────────────────

describe('CacheAdapter – transaction', () => {
  it('clears entire cache after transaction', async () => {
    const { ca, cache } = make({ users: [{ id: 1 }], posts: [{ id: 2 }] });

    await ca.findAll('users');
    await ca.findAll('posts');
    assert.equal(cache.store.size, 2);

    await ca.transaction(async () => {});

    assert.equal(cache.store.size, 0);
  });

  it('returns the result from the transaction callback', async () => {
    const { ca } = make();
    const result = await ca.transaction(async () => 'done');
    assert.equal(result, 'done');
  });
});

// ─── passthrough ─────────────────────────────────────────────────────────────

describe('CacheAdapter – passthrough', () => {
  it('connect() delegates to db', async () => {
    const { ca, db } = make();
    let called = false;
    db.connect = async () => { called = true; };
    await ca.connect();
    assert.equal(called, true);
  });

  it('disconnect() delegates to db', async () => {
    const { ca, db } = make();
    let called = false;
    db.disconnect = async () => { called = true; };
    await ca.disconnect();
    assert.equal(called, true);
  });

  it('ping() delegates to db', async () => {
    const { ca } = make();
    const result = await ca.ping();
    assert.equal(result, true);
  });
});
