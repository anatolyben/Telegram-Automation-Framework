/**
 * PostgreSQL Database Adapter
 * 
 * Requires: npm install pg
 */
export class PostgreSQLAdapter {
  constructor(connectionString, options = {}) {
    this.name = 'PostgreSQLAdapter';
    this.connectionString = connectionString;
    this.pool = null;
    this.connected = false;
    this.options = options;
  }

  async connect() {
    if (this.connected) return;
    try {
      const { Pool } = (await import('pg')).default || (await import('pg'));
      this.pool = new Pool({ connectionString: this.connectionString, ...this.options });
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      this.connected = true;
    } catch (error) {
      throw new Error(`PostgreSQL connection failed: ${error.message || error}`);
    }
  }

  async disconnect() {
    if (!this.connected || !this.pool) return;
    try {
      await this.pool.end();
      this.connected = false;
      console.log('📡 PostgreSQL disconnected');
    } catch (error) {
      console.error('PostgreSQL disconnect error:', error);
    }
  }

  async query(sql, params = []) {
    if (!this.connected) throw new Error('PostgreSQL not connected');
    try {
      return await this.pool.query(sql, params);
    } catch (error) {
      throw new Error(`Query error: ${error.message}`);
    }
  }

  async queryOne(sql, params = []) {
    const result = await this.query(sql, params);
    return result.rows[0] || null;
  }

  async queryAll(sql, params = []) {
    const result = await this.query(sql, params);
    return result.rows;
  }

  async ping() {
    try {
      await this.query('SELECT NOW()');
      return true;
    } catch {
      return false;
    }
  }

  async transaction(callback) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async insert(table, data) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(',');
    const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${placeholders}) RETURNING *`;
    return this.queryOne(sql, values);
  }

  async update(table, data, where) {
    const sets = Object.keys(data).map((k, i) => `${k}=$${i + 1}`).join(',');
    const whereClause = Object.keys(where).map((k, i) => `${k}=$${Object.keys(data).length + i + 1}`).join(' AND ');
    const sql = `UPDATE ${table} SET ${sets} WHERE ${whereClause} RETURNING *`;
    const params = [...Object.values(data), ...Object.values(where)];
    return this.queryOne(sql, params);
  }

  async delete(table, where) {
    const whereClause = Object.keys(where).map((k, i) => `${k}=$${i + 1}`).join(' AND ');
    const sql = `DELETE FROM ${table} WHERE ${whereClause}`;
    return this.query(sql, Object.values(where));
  }

  async findById(table, id) {
    return this.queryOne(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  }

  async findAll(table) {
    return this.queryAll(`SELECT * FROM ${table}`);
  }
}
