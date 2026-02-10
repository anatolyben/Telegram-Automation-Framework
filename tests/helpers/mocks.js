/**
 * Shared mock factories for tests
 */

/**
 * Minimal logger mock that captures calls
 */
export function makeLogger() {
  const calls = { info: [], warn: [], error: [], debug: [] };
  return {
    calls,
    info:  (...a) => calls.info.push(a),
    warn:  (...a) => calls.warn.push(a),
    error: (...a) => calls.error.push(a),
    debug: (...a) => calls.debug.push(a),
  };
}

/**
 * Minimal message object
 */
export function makeMessage(overrides = {}) {
  return {
    id: 'msg-1',
    chatId: 100,
    text: 'hello',
    from: { id: 42, firstName: 'Test' },
    ...overrides,
  };
}

/**
 * Minimal context object
 */
export function makeContext(overrides = {}) {
  return {
    bot: null,
    db: null,
    logger: makeLogger(),
    config: {},
    state: {},
    ...overrides,
  };
}

/**
 * In-memory cache mock with get/set/del/clear
 */
export function makeCache() {
  const store = new Map();
  const calls = { get: 0, set: 0, del: 0, clear: 0 };
  return {
    store,
    calls,
    async get(key)            { calls.get++;   return store.get(key) ?? null; },
    async set(key, val, ttl)  { calls.set++;   store.set(key, val); },
    async del(key)            { calls.del++;   store.delete(key); },
    async clear()             { calls.clear++; store.clear(); },
  };
}

/**
 * In-memory DB mock
 */
export function makeDb(rows = {}) {
  const calls = { query: 0, queryOne: 0, queryAll: 0, insert: 0, update: 0, delete: 0, findById: 0, findAll: 0 };
  return {
    calls,
    rows, // map of table -> array
    async connect()    {},
    async disconnect() {},
    async ping()       { return true; },
    async query(sql, params)         { calls.query++;    return { rows: rows[sql] ?? [] }; },
    async queryOne(sql, params)      { calls.queryOne++; return (rows[sql] ?? [])[0] ?? null; },
    async queryAll(sql, params)      { calls.queryAll++; return rows[sql] ?? []; },
    async insert(table, data)        { calls.insert++;   return { id: 1, ...data }; },
    async update(table, data, where) { calls.update++;   return { ...data }; },
    async delete(table, where)       { calls.delete++;   return {}; },
    async findById(table, id)        { calls.findById++; return (rows[table] ?? []).find(r => r.id === id) ?? null; },
    async findAll(table)             { calls.findAll++;  return rows[table] ?? []; },
    async transaction(cb)            { return cb({ query: async () => {} }); },
  };
}

/**
 * Minimal adapter mock (transport)
 */
export function makeAdapter(name = 'MockAdapter') {
  const sent = [];
  const handlers = {};
  return {
    name,
    sent,
    handlers,
    initialized: false,
    started: false,
    shutdown: false,
    async initialize() { this.initialized = true; },
    async start()      { this.started = true; },
    async shutdown()   { this.shutdown = true; },
    on(event, handler) { handlers[event] = handler; },
    async sendMessage(chatId, text, opts) { sent.push({ chatId, text, opts }); return {}; },
    async banMember(chatId, userId)       { return {}; },
    async unbanMember(chatId, userId)     { return {}; },
    async restrictMember(chatId, userId, perms) { return {}; },
    async approveChatJoinRequest(chatId, userId) { return {}; },
    async declineChatJoinRequest(chatId, userId) { return {}; },
    async sendPoll(chatId, q, opts, extra) { return {}; },
    async getChat(chatId)  { return { id: chatId }; },
    emit(event, msg)       { handlers[event]?.(msg); },
  };
}
