# Architecture Overview

TAF is built around four interlocking ideas: a **normalized message bus**, a **sequential pipeline**, a **declarative action pattern**, and **swappable adapters**. Understanding how they connect makes the whole system predictable.

---

## The Big Picture

```
┌─────────────────────────────────────────────────────────────┐
│                        Telegram                             │
│              (Bot API / MTProto / both)                     │
└──────────────────────────┬──────────────────────────────────┘
                           │ raw Telegram events
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Transport Layer                          │
│                                                             │
│  TelegramAdapter   MTProtoAdapter   TransportAdapter        │
│  (Bot API polling) (user-level)     (fan-out router)        │
│                                                             │
│  Normalizes every event to a common message shape           │
└──────────────────────────┬──────────────────────────────────┘
                           │ normalized message
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      BotEngine                              │
│                                                             │
│  - Connects adapter → pipeline                              │
│  - Manages lifecycle (start / stop)                         │
│  - Builds the context object passed to every stage          │
└──────────────────────────┬──────────────────────────────────┘
                           │ (message, context)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                       Pipeline                              │
│                                                             │
│   Stage 1 → Stage 2 → Stage 3 → … → Stage N                │
│                                                             │
│  Each stage runs in order. Any stage can:                   │
│    • Return nothing            → continue                   │
│    • Return { stop: true }     → halt the pipeline          │
│    • Return { action, data }   → queue a side effect        │
│    • Throw an error            → ErrorHandler decides fate  │
└──────────────────────────┬──────────────────────────────────┘
                           │ collected actions
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    ActionHandler                            │
│                                                             │
│  Receives declared intents and executes them:               │
│    'ban_user'       → bot.banMember(...)                    │
│    'notify_admin'   → bot.sendMessage(adminChat, ...)       │
│    'log_event'      → db.insert('events', ...)              │
└─────────────────────────────────────────────────────────────┘
```

---

## Component Roles

### BotEngine

The root of every running bot. Its job is connection management, not logic:

- Calls `adapter.initialize()` then `adapter.start()`
- Connects to the database if one is provided
- Attaches event listeners for `message`, `callback_query`, and `chat_join_request`
- Builds the context object for each incoming event
- Delegates to the pipeline

You should have one `BotEngine` per logical bot. Use `BotManager` when you need to run several bots dynamically (e.g. one per client/tenant).

### Pipeline

The pipeline is a strict ordered sequence. Stages run one at a time, awaited, never in parallel. This keeps behaviour predictable: later stages can rely on earlier stages having finished.

**Flow control signals:**

| Stage returns | Pipeline behaviour |
|---|---|
| `undefined` / `null` | Continue to next stage |
| `{ stop: true }` | Halt — no further stages run |
| `{ action: 'x', data: {} }` | Collect action, continue |
| Throws | Consult ErrorHandler (or skip by default) |

### HookManager

Hooks give you observability without putting logging or metrics inside your stages. Register listeners on any of these events:

| Hook | Fires |
|---|---|
| `before:pipeline` | Once, before any stage runs |
| `after:pipeline` | Once, after all stages complete |
| `before:stage` | Before each individual stage |
| `after:stage` | After each stage (with its result) |
| `error:stage` | When a stage throws |

Hooks are fire-and-forget observers. They cannot modify the message or stop the pipeline.

### ErrorHandler

The ErrorHandler maps errors to recovery strategies. Two things can determine the recovery:

1. **Stage name** — you register a strategy per stage: `'retry'`, `'skip'`, `'stop'`, or `'fallback'`
2. **Error type** — built-in handlers for `DatabaseError` (checks the error code) and `ValidationError`

Stage-name strategies take priority. If a stage has one registered, it applies regardless of the error's type. This means:
- Critical stages can be set to `'stop'` — a failure halts the whole pipeline
- Optional enrichment stages can be set to `'skip'` — a failure is logged and the next stage runs
- External API calls can be set to `'retry'` with backoff

### ActionHandler

Stages that produce side effects have two options:

**Option A (inline, simple):** Call `context.bot.sendMessage(...)` directly inside the stage. Works fine, but makes stages harder to test and mixes declaration with execution.

**Option B (action pattern, preferred):** Return `{ action: 'name', data: {} }` from the stage. Register a handler on `ActionHandler`. The pipeline collects all actions and passes them to `ActionHandler.handleAll()` at the end.

The action pattern makes stages pure functions of `(message, context)` — they declare what should happen without doing it. This makes unit testing trivial.

---

## Adapter Layers

### Transport Adapters

Transport adapters are the bridge between Telegram's wire protocol and TAF's normalized message format.

**`TelegramAdapter`** wraps `node-telegram-bot-api` (Bot API, polling). Use this for standard bots — commands, inline buttons, moderation, welcome messages.

**`MTProtoAdapter`** wraps `telegram` (GramJS, MTProto). Use this for user-account-level access — reading messages the bot isn't a member of, scraping, or operations that require a real phone number.

**`TransportAdapter`** fans a single pipeline out across multiple adapters. Messages from any adapter get `msg.source` stamped with the adapter name, so stages can act differently based on origin.

All three expose the same interface:
```js
adapter.initialize()
adapter.start()
adapter.shutdown()
adapter.on(event, handler)
adapter.sendMessage(chatId, text, options)
adapter.banMember(chatId, userId)
adapter.unbanMember(chatId, userId)
adapter.restrictMember(chatId, userId, permissions)
adapter.getChat(chatId)
```

### Database Adapters

**`PostgreSQLAdapter`** provides a minimal but complete PostgreSQL interface built on `pg` with connection pooling, parameterized queries, transactions, and convenience methods (`insert`, `update`, `delete`, `findById`, `findAll`).

**`CacheAdapter`** wraps any database adapter transparently. Every read is cached; writes invalidate only the affected table's keys — a write to `users` does not clear cached `messages` or `chats`. TTL is configurable at construction time.

```js
const db    = new PostgreSQLAdapter(process.env.DATABASE_URL);
const cache = new RedisCache(redisClient);                    // your own cache wrapper
const cachedDb = new CacheAdapter(db, cache, { ttl: 300 });  // 5-minute TTL

const engine = new BotEngine(adapter, { pipeline, db: cachedDb });
```

---

## Data Flow for a Single Message

Here's exactly what happens when a Telegram message arrives, step by step:

```
1.  Telegram delivers update to long-poll connection
2.  TelegramAdapter.botInstance fires 'message' event
3.  TelegramAdapter._normalizeMessage() converts to TAF format
4.  TelegramAdapter fires its internal 'message' handler
5.  BotEngine._handleMessage() receives the normalized message
6.  BotEngine builds context: { bot, db, logger, config, state: {} }
7.  Pipeline.process(message, context) begins
8.  HookManager emits 'before:pipeline'
9.  For each stage:
    a. HookManager emits 'before:stage'
    b. await stage(message, context) executes
    c. If result has .action, it's pushed to message._actions
    d. HookManager emits 'after:stage'
    e. If result has .stop, break out of loop
    f. If stage throws, ErrorHandler.handle() returns a recovery action
10. HookManager emits 'after:pipeline'
11. ActionHandler.handleAll(result.actions, context) dispatches side effects
12. Message processing complete — ready for next update
```

---

## Multi-Bot Architecture (BotManager)

When you need multiple independent bots running in the same process (e.g. one bot per customer), `BotManager` handles lifecycle:

```js
import { BotManager, BotEngine, TelegramAdapter } from './src/index.js';

const manager = new BotManager();

// Add a bot for client A
await manager.addBot('clientA', { token: tokenA }, BotEngine, (config) => {
  return new TelegramAdapter(config.token);
});

// Hot-swap config without downtime
await manager.updateBot('clientA', { token: newTokenA }, BotEngine, (config) => {
  return new TelegramAdapter(config.token);
});

// Remove when no longer needed
await manager.removeBot('clientA');
```

Each bot runs its own adapter and pipeline completely independently.

---

## Design Decisions

**Why sequential stages and not parallel?**
Parallel execution would mean Stage 2 might act on a message before Stage 1 has checked whether it should be blocked. Ordering guarantees let you build guard stages that protect everything after them.

**Why the action pattern instead of side effects in stages?**
Stages that call `context.bot.sendMessage()` directly are coupled to the transport. Returning `{ action: 'send_welcome' }` means the stage is a pure function — testable with no mocks. The ActionHandler is the only place with coupling to the transport.

**Why per-table cache invalidation?**
A naive `cache.clear()` on any write means a high-write workload kills the cache hit rate across all tables. Scoped invalidation means a flood of `users` writes doesn't evict your cached `chat_settings` or `permission_rules`.
