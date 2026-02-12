# Telegram Automation Framework (TAF)

An event-driven, middleware-based framework for moderation and workflow automation across multiple Telegram groups.

TAF gives you a composable pipeline where every incoming event — a message, a join request, a button press — flows through a chain of stages you define. Each stage does one job: filter spam, look up a user record, check permissions, enqueue a task. When a stage is done, the next one picks up. The whole thing is testable, observable, and transport-agnostic.

```
Telegram ──► TelegramAdapter ──► BotEngine ──► Pipeline
                                                  │
                                          ┌───────┼───────┐
                                          ▼       ▼       ▼
                                       Stage1  Stage2  Stage3
                                                          │
                                                     ActionHandler
```

---

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Core Concepts](#core-concepts)
- [Configuration](#configuration)
- [Examples](#examples)
- [Running Tests](#running-tests)
- [Documentation](#documentation)
- [License](#license)

---

## Features

- **Pipeline architecture** — chain middleware stages that each do one thing well
- **Early termination** — any stage can halt the pipeline with `{ stop: true }`
- **Action pattern** — stages declare intent (`notify_admin`, `ban_user`); a central handler executes it
- **Hook system** — observe every stage lifecycle event for logging, metrics, and debugging
- **Structured error recovery** — per-stage strategies: `stop`, `skip`, `retry`, or `fallback`
- **Multi-adapter routing** — run a single pipeline across Bot API + MTProto simultaneously
- **Transparent caching** — wrap any DB adapter with automatic, per-table-scoped cache invalidation
- **Zero test dependencies** — test suite runs on Node's built-in `node:test` runner

---

## Requirements

- Node.js ≥ 16
- A Telegram Bot Token ([get one from @BotFather](https://t.me/BotFather))
- PostgreSQL (optional, for persistence)
- Redis (optional, for caching)

---

## Installation

```bash
# npm
npm install telegram-automation-framework

# yarn
yarn add telegram-automation-framework

# pnpm
pnpm add telegram-automation-framework

# bun
bun add telegram-automation-framework
```

Then import in your project:

```js
import { BotEngine, Pipeline, TelegramAdapter } from 'telegram-automation-framework';
```

The only runtime dependencies are `node-telegram-bot-api`, `pg`, and `winston`. Everything else is built-in.

---

## Quick Start

**1. Create your bot file**

```js
// bot.js
import {
  BotEngine,
  Pipeline,
  TelegramAdapter,
} from 'telegram-automation-framework';

// --- Define your pipeline stages ---

async function logMessage(message, context) {
  context.logger.info(`[${message.chatId}] ${message.from?.firstName}: ${message.text}`);
}

async function blockBadWords(message, context) {
  const banned = ['spam', 'scam'];
  if (banned.some(w => message.text?.toLowerCase().includes(w))) {
    await context.bot.deleteMessage(message.chatId, message.id);
    return { stop: true, reason: 'bad_word' };
  }
}

async function greetNewMembers(message, context) {
  if (message.type === 'new_chat_members') {
    const names = message.raw.new_chat_members.map(u => u.first_name).join(', ');
    await context.bot.sendMessage(message.chatId, `👋 Welcome, ${names}!`);
    return { stop: true };
  }
}

// --- Wire it together ---

const adapter  = new TelegramAdapter(process.env.BOT_TOKEN);
const pipeline = new Pipeline();

pipeline
  .use(logMessage)
  .use(greetNewMembers)
  .use(blockBadWords);

const engine = new BotEngine(adapter, { pipeline });
await engine.start();

console.log('Bot is running...');
```

**2. Set your token and run**

```bash
BOT_TOKEN=your_token_here node bot.js
```

That's it. Messages flow through your three stages in order.

---

## Project Structure

```
src/
├── index.js                        # Main entry point — re-exports everything
├── core/
│   ├── BotEngine.js                # Wires adapter → pipeline, handles lifecycle
│   ├── BotManager.js               # Manages multiple bot instances dynamically
│   ├── Pipeline.js                 # Runs stages sequentially, handles stop/retry
│   ├── HookManager.js              # Lifecycle event hooks (before/after each stage)
│   ├── ErrorHandler.js             # Per-stage error recovery strategies
│   └── ActionHandler.js            # Dispatches actions returned by stages
└── adapters/
    ├── transports/
    │   ├── TelegramAdapter.js      # Telegram Bot API (polling)
    │   ├── MTProtoAdapter.js       # Telegram MTProto (user-level access)
    │   └── TransportAdapter.js     # Fan-out across multiple transports
    └── databases/
        ├── PostgreSQLAdapter.js    # PostgreSQL with connection pooling
        └── CacheAdapter.js         # Transparent caching layer for any DB adapter

tests/
├── helpers/mocks.js                # Shared mock factories (no real I/O needed)
├── pipeline.test.js
├── hookmanager.test.js
├── errorhandler.test.js
├── actionhandler.test.js
├── botmanager.test.js
├── transportadapter.test.js
└── cacheadapter.test.js

docs/
├── architecture.md                 # How everything fits together
├── api.md                          # Full API reference
└── guides/
    ├── writing-stages.md           # How to write pipeline stages
    └── adapters.md                 # Working with transport and DB adapters
```

---

## Core Concepts

### Pipeline Stages

A stage is just an async function. It receives the normalized message and a context object, does its work, and optionally returns a result.

```js
async function myStage(message, context) {
  // context.bot    → send messages, ban users, etc.
  // context.db     → database adapter (if configured)
  // context.logger → structured logger
  // context.config → your config object
  // context.state  → shared scratch space for this message
}
```

Return nothing to continue. Return `{ stop: true }` to halt. Return `{ action: 'name', data: {} }` to dispatch a side effect.

### The Context Object

Every stage receives the same context for a given message:

| Property | Type | Description |
|---|---|---|
| `bot` | Adapter | The transport adapter — use it to send replies |
| `db` | Adapter \| null | Database adapter, if provided to BotEngine |
| `logger` | Logger | Structured logger (pino/winston compatible) |
| `config` | Object | Your configuration, passed to BotEngine options |
| `state` | Object | Empty object — stages can share data via this |

### Message Format

All adapters normalize their messages to a common shape before the pipeline sees them:

```js
{
  id:        number,          // message_id
  chatId:    number,          // chat identifier
  chat:      { id, title, type },
  from:      { id, firstName, lastName, username },
  text:      string,
  entities:  [],              // Telegram message entities
  timestamp: Date,
  type:      string,          // 'text' | 'new_chat_members' | 'callback_query' | ...
  raw:       Object,          // original Telegram object, unmodified
  source:    string,          // adapter name (multi-adapter setups)
}
```

---

## Configuration

Pass a `config` object to `BotEngine` and it will be available as `context.config` in every stage:

```js
const engine = new BotEngine(adapter, {
  pipeline,
  db,
  config: {
    adminChatId:    -100123456789,
    warnThreshold:  3,
    allowedDomains: ['example.com'],
  },
  logger: pinoLogger,  // any logger with .info/.warn/.error/.debug
});
```

---

## Examples

### Auto-approve join requests

```js
async function approveJoinRequests(message, context) {
  if (message.type !== 'chat_join_request') return;

  await context.bot.approveChatJoinRequest(message.chat.id, message.user.id);
  return { stop: true };
}
```

### Track users in PostgreSQL

```js
async function upsertUser(message, context) {
  if (!message.from) return;

  await context.db.query(
    `INSERT INTO users (id, username, first_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE
     SET username = $2, first_name = $3, last_seen = NOW()`,
    [message.from.id, message.from.username, message.from.firstName]
  );
}
```

### Return an action instead of executing a side effect

```js
// Stage declares intent
async function flagSpammer(message, context) {
  if (isSpam(message.text)) {
    return { action: 'ban_and_notify', data: { userId: message.from.id } };
  }
}

// ActionHandler executes it
actionHandler.register('ban_and_notify', async ({ userId }, context) => {
  await context.bot.banMember(context.chatId, userId);
  await context.bot.sendMessage(context.config.adminChatId, `Banned ${userId}`);
});
```

### Add error recovery to a risky stage

```js
import { ErrorHandler } from 'telegram-automation-framework';

const errorHandler = new ErrorHandler(logger);

// Retry db lookups up to 3 times, skip on validation failures
errorHandler.registerRecoveryStrategy('fetchUserData', 'retry', { maxRetries: 3, backoffMs: 200 });
errorHandler.registerRecoveryStrategy('validateInput', 'skip');

pipeline.setErrorHandler(errorHandler);
```

### Run two transports through one pipeline

```js
import { TransportAdapter, TelegramAdapter, MTProtoAdapter } from 'telegram-automation-framework';

const botApi  = new TelegramAdapter(process.env.BOT_TOKEN);
const mtproto = new MTProtoAdapter({ apiId, apiHash, sessionString });

const transport = new TransportAdapter([botApi, mtproto]);
const engine    = new BotEngine(transport, { pipeline });
```

---

## Running Tests

```bash
npm test
```

The test suite uses Node's built-in `node:test` runner with no additional dependencies. All tests use in-memory mocks — no Telegram connection, no database, no Redis required.

```
# tests 94
# pass  94
# fail  0
```

---

## Documentation

Full documentation lives in the `docs/` folder:

- [Architecture Overview](docs/architecture.md) — how all the pieces connect
- [Writing Stages Guide](docs/guides/writing-stages.md) — practical patterns for building middleware
- [Adapters Guide](docs/guides/adapters.md) — transport and database adapters in depth
- [API Reference](docs/api.md) — complete method signatures for every class

---

## License

MIT
