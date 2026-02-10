/**
 * CacheAdapter - Wraps any database adapter with automatic caching
 * 
 * Provides transparent caching layer without repositories knowing about it.
 * All queries are cached automatically with configurable TTL.
 * Cache invalidation is scoped per-table — a write to 'users' only
 * clears 'users' cache keys, not the entire cache.
 */
export class CacheAdapter {
  constructor(db, cache, options = {}) {
    this.db = db;
    this.cache = cache;
    this.name = 'CacheAdapter';
    this.defaultTTL = options.ttl ?? 3600; // configurable, default 1 hour
    // Track cache keys per table for scoped invalidation
    this._tableKeys = new Map();
  }

  async connect() {
    return this.db.connect();
  }

  async disconnect() {
    return this.db.disconnect();
  }

  async query(sql, params = []) {
    const key = `query:${sql}:${JSON.stringify(params)}`;
    const cached = await this.cache.get(key);
    if (cached) return cached;

    const result = await this.db.query(sql, params);
    await this.cache.set(key, result, this.defaultTTL);
    return result;
  }

  async queryOne(sql, params = []) {
    const key = `one:${sql}:${JSON.stringify(params)}`;
    const cached = await this.cache.get(key);
    if (cached) return cached;

    const result = await this.db.queryOne(sql, params);
    if (result) {
      await this.cache.set(key, result, this.defaultTTL);
    }
    return result;
  }

  async queryAll(sql, params = []) {
    const key = `all:${sql}:${JSON.stringify(params)}`;
    const cached = await this.cache.get(key);
    if (cached) return cached;

    const result = await this.db.queryAll(sql, params);
    await this.cache.set(key, result, this.defaultTTL);
    return result;
  }

  async insert(table, data) {
    const result = await this.db.insert(table, data);
    await this._invalidateTableCache(table);
    return result;
  }

  async update(table, data, where) {
    const result = await this.db.update(table, data, where);
    await this._invalidateTableCache(table);
    return result;
  }

  async delete(table, where) {
    const result = await this.db.delete(table, where);
    await this._invalidateTableCache(table);
    return result;
  }

  async findById(table, id) {
    const key = `${table}:id:${id}`;
    const cached = await this.cache.get(key);
    if (cached) return cached;

    const result = await this.db.findById(table, id);
    if (result) {
      await this.cache.set(key, result, this.defaultTTL);
      this._trackKey(table, key);
    }
    return result;
  }

  async findAll(table) {
    const key = `${table}:all`;
    const cached = await this.cache.get(key);
    if (cached) return cached;

    const result = await this.db.findAll(table);
    await this.cache.set(key, result, this.defaultTTL);
    this._trackKey(table, key);
    return result;
  }

  async ping() {
    return this.db.ping?.();
  }

  async transaction(callback) {
    const result = await this.db.transaction(callback);
    // After a transaction we can't know which tables changed — clear all
    await this.cache.clear?.();
    this._tableKeys.clear();
    return result;
  }

  /**
   * Track a cache key under a table name for scoped invalidation
   * @private
   */
  _trackKey(table, key) {
    if (!this._tableKeys.has(table)) {
      this._tableKeys.set(table, new Set());
    }
    this._tableKeys.get(table).add(key);
  }

  /**
   * Invalidate only cache keys associated with a specific table.
   * Falls back to full cache clear if the cache doesn't support per-key deletion.
   * @private
   */
  async _invalidateTableCache(table) {
    const keys = this._tableKeys.get(table);

    if (keys && keys.size > 0 && typeof this.cache.del === 'function') {
      // Targeted invalidation — only delete keys for this table
      await Promise.all([...keys].map(k => this.cache.del(k)));
      this._tableKeys.delete(table);
    } else if (typeof this.cache.clear === 'function') {
      // Fallback: full cache clear
      await this.cache.clear();
      this._tableKeys.clear();
    }
  }
}
