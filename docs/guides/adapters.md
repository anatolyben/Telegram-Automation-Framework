# Adapters Guide

Adapters are the boundary between TAF and the outside world. Transport adapters talk to Telegram; database adapters talk to your storage layer. All of them present a consistent interface to the rest of the framework.

---

## Transport Adapters

### TelegramAdapter

The standard choice. Uses the Telegram Bot API via long-polling.

**When to use it:** You have a bot token from @BotFather and need to respond to messages, handle commands, moderate groups, approve join requests, or interact with inline keyboards.

**Setup:**

```js
import { TelegramAdapter } from './src/index.js';

const adapter = new TelegramAdapter(process.env.BOT_TOKEN);
```

**Full API:**

```js
// Messaging
await adapter.sendMessage(chatId, text, options?)
await adapter.editMessage(chatId, messageId, text, options?)
await adapter.deleteMessage(chatId, messageId)

// Moderation
await adapter.banMember(chatId, userId)
await adapter.unbanMember(chatId, userId)
await adapter.restrictMember(chatId, userId, permissions)

// Join requests
await adapter.approveChatJoinRequest(chatId, userId)
await adapter.declineChatJoinRequest(chatId, userId)

// Polls
await adapter.sendPoll(chatId, question, options[], extra?)

// Chat info
await adapter.getChat(chatId)

// Lifecycle
await adapter.initialize()
await adapter.start()        // begins long-polling
await adapter.shutdown()     // stops polling cleanly
```

**sendMessage options** (passed through to node-telegram-bot-api):

```js
await adapter.sendMessage(chatId, '<b>Hello</b>', {
  parse_mode: 'HTML',                  // default — HTML or Markdown
  disable_web_page_preview: true,      // default
  reply_to_message_id: messageId,      // reply to a specific message
  reply_markup: {                      // inline keyboard
    inline_keyboard: [[
      { text: 'Approve', callback_data: 'approve:123' },
      { text: 'Deny',    callback_data: 'deny:123'    },
    ]]
  }
});
```

**Handling polling errors:**

`TelegramAdapter` handles the two most common polling errors automatically:
- `429 Too Many Requests` — logged as a warning; the bot will auto-retry after the `retry_after` window
- `409 Conflict` — logged as a fatal error; this means another instance of your bot is running with the same token

---

### MTProtoAdapter

Uses the MTProto protocol (via GramJS) to operate as a user account rather than a bot.

**When to use it:** You need access that Bot API doesn't provide — reading message history, operating in groups where the bot isn't a member, or accessing account-level data.

**Requirements:** A Telegram `apiId` and `apiHash` (from [my.telegram.org](https://my.telegram.org)), and a phone number for first-time authentication.

**Setup:**

```js
import { MTProtoAdapter } from './src/index.js';

const adapter = new MTProtoAdapter({
  apiId:         parseInt(process.env.TELEGRAM_API_ID),
  apiHash:       process.env.TELEGRAM_API_HASH,
  sessionString: process.env.TELEGRAM_SESSION,  // empty string on first run
  phoneNumber:   process.env.TELEGRAM_PHONE,    // only needed for first auth
});

await adapter.initialize();
```

**First-time authentication:**

On the first run (no saved session), `MTProtoAdapter` will request an authentication code to be sent to the phone number. Set `TELEGRAM_CODE` in your environment before running, or implement interactive auth in your startup script. After successful auth, save the session string:

```js
await adapter.initialize();
const session = adapter.getSessionString();
// persist session to env / secrets manager
console.log('Save this session string:', session);
```

**User-level operations:**

```js
// Messaging
await adapter.sendMessage(chatId, text, options?)
await adapter.editMessage(chatId, messageId, text, options?)
await adapter.deleteMessage(chatId, messageId)

// User/chat lookup
await adapter.getUserInfo(userId)    // → { id, firstName, lastName, username, isBot, isScam }
await adapter.getChatInfo(chatId)    // → { id, title, type, isGroup, isSupergroup, username }
await adapter.getChatMembers(chatId) // → [{ id, firstName, lastName, username, isBot }]

// Moderation
await adapter.banMember(chatId, userId)
await adapter.unbanMember(chatId, userId)
await adapter.restrictMember(chatId, userId, permissions)

// Session
adapter.getSessionString() // → string to save for future runs
```

---

### TransportAdapter

Combines multiple adapters and routes all events through a single pipeline.

**When to use it:** You want one pipeline to process events from both the Bot API and a user MTProto account, or you're building a multi-source event bus.

**Setup:**

```js
import { TransportAdapter, TelegramAdapter, MTProtoAdapter } from './src/index.js';

const botApi  = new TelegramAdapter(process.env.BOT_TOKEN);
const mtproto = new MTProtoAdapter({ apiId, apiHash, sessionString });

const transport = new TransportAdapter([botApi, mtproto]);
```

**Routing by source in a stage:**

Every message gets `msg.source` set to the adapter's `.name` property:

```js
async function routeBySource(message, context) {
  if (message.source === 'MTProtoAdapter') {
    // handle user-level events
  } else {
    // handle bot API events
  }
}
```

**Sending via a specific adapter:**

```js
// Default — sends via the first adapter
await transport.sendMessage(chatId, text);

// Targeted — send via a named adapter
await transport.sendMessageVia('TelegramAdapter', chatId, text);
await transport.sendMessageVia('MTProtoAdapter', chatId, text);
```

All delegation methods (`banMember`, `restrictMember`, `approveChatJoinRequest`, etc.) automatically find the first adapter that supports the method.

---

## Database Adapters

### PostgreSQLAdapter

A lightweight wrapper around the `pg` connection pool.

**Setup:**

```js
import { PostgreSQLAdapter } from './src/index.js';

const db = new PostgreSQLAdapter(process.env.DATABASE_URL, {
  max: 20,              // max pool size (pg option)
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

await db.connect();
```

**Query methods:**

```js
// Raw query — returns a pg result object
const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
result.rows // → array

// Returns first row or null
const user = await db.queryOne('SELECT * FROM users WHERE id = $1', [userId]);

// Returns all rows as an array
const users = await db.queryAll('SELECT * FROM users WHERE role = $1', ['admin']);
```

**Convenience methods:**

```js
// Insert — returns the inserted row (uses RETURNING *)
const user = await db.insert('users', {
  telegram_id: 12345,
  username:    'alice',
  joined_at:   new Date()
});

// Update — returns the updated row
const updated = await db.update(
  'users',
  { username: 'alice_new' },   // data to set
  { telegram_id: 12345 }       // WHERE clause
);

// Delete
await db.delete('users', { telegram_id: 12345 });

// Lookup by id column
const user = await db.findById('users', userId);

// Get all rows in a table
const all = await db.findAll('users');
```

**Transactions:**

```js
await db.transaction(async (client) => {
  await client.query('INSERT INTO events ...');
  await client.query('UPDATE users SET event_count = event_count + 1 ...');
  // automatically commits; rolls back on throw
});
```

**Connection check:**

```js
const ok = await db.ping();  // returns true or false
```

---

### CacheAdapter

`CacheAdapter` wraps any database adapter with transparent read caching. Your stages call the same `db.queryOne()` / `db.findById()` methods — they don't know or care whether the result came from cache or the database.

**Requirements:** A cache object with `get(key)`, `set(key, value, ttl)`, and optionally `del(key)` and `clear()`. Works with ioredis, node-cache, or any compatible interface.

**Setup:**

```js
import Redis from 'ioredis';
import { CacheAdapter, PostgreSQLAdapter } from './src/index.js';

const redis = new Redis(process.env.REDIS_URL);

// Wrap redis to match the expected interface
const cache = {
  get:   (key)           => redis.get(key).then(v => v ? JSON.parse(v) : null),
  set:   (key, val, ttl) => redis.set(key, JSON.stringify(val), 'EX', ttl),
  del:   (key)           => redis.del(key),
  clear: ()              => redis.flushdb(),
};

const db       = new PostgreSQLAdapter(process.env.DATABASE_URL);
const cachedDb = new CacheAdapter(db, cache, { ttl: 300 }); // 5 minutes

const engine = new BotEngine(adapter, { pipeline, db: cachedDb });
```

**How caching works:**

- **Reads** (`query`, `queryOne`, `queryAll`, `findById`, `findAll`) — checked in cache first; on miss, fetched from DB and stored with `defaultTTL`.
- **Writes** (`insert`, `update`, `delete`) — execute against the DB, then invalidate only the cache keys associated with that specific table.
- **Transactions** — after any transaction, the full cache is cleared (writes in a transaction can touch any table).

**Scoped invalidation example:**

```js
await cachedDb.findAll('chat_settings');  // cached as 'chat_settings:all'
await cachedDb.findAll('users');          // cached as 'users:all'

await cachedDb.update('users', { role: 'admin' }, { id: 1 });
// → clears 'users:all' only
// → 'chat_settings:all' is untouched
```

**TTL configuration:**

```js
// 5 minutes for hot user data
const userCache = new CacheAdapter(db, cache, { ttl: 300 });

// 1 hour for slow-changing chat settings
const settingsCache = new CacheAdapter(db, cache, { ttl: 3600 });
```

If the cache doesn't implement `del()` (key-level deletion), `CacheAdapter` falls back to `clear()` for full-cache invalidation.

---

## Building a Custom Adapter

To add a new transport (Discord, Slack, etc.), implement this interface:

```js
class DiscordAdapter {
  constructor(token) {
    this.name = 'DiscordAdapter';  // required — used for source stamping
    this.handlers = {};
  }

  async initialize() { /* connect to Discord gateway */ }
  async start()      { /* begin receiving events */ }
  async shutdown()   { /* graceful disconnect */ }

  on(eventName, handler) {
    this.handlers[eventName] = handler;
  }

  async sendMessage(chatId, text, options = {}) { /* ... */ }

  // Call this.handlers['message'](normalizedMessage) when an event arrives
  _onMessageReceived(rawEvent) {
    const message = this._normalize(rawEvent);
    this.handlers.message?.(message);
  }

  _normalize(raw) {
    return {
      id:        raw.id,
      chatId:    raw.channelId,
      chat:      { id: raw.channelId, title: raw.channel.name, type: 'group' },
      from:      { id: raw.author.id, firstName: raw.author.username },
      text:      raw.content,
      entities:  [],
      timestamp: new Date(raw.createdTimestamp),
      type:      'text',
      raw,
    };
  }
}
```

Drop it into `src/adapters/transports/`, add an export to `transports/index.js`, and it works with `BotEngine` and `TransportAdapter` immediately.
