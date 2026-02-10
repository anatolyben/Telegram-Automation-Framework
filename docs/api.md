# API Reference

Complete method signatures for every exported class.

---

## Core

### `BotEngine`

The top-level orchestrator. Connects a transport adapter to a processing pipeline.

```js
import { BotEngine } from './src/index.js';

const engine = new BotEngine(adapter, options);
```

**Constructor**

| Parameter | Type | Description |
|---|---|---|
| `adapter` | Adapter | A `TelegramAdapter`, `MTProtoAdapter`, or `TransportAdapter` |
| `options.pipeline` | `Pipeline` | The pipeline to process messages through |
| `options.db` | Adapter \| null | Optional database adapter |
| `options.logger` | Logger | Any logger with `.info/.warn/.error`. Defaults to `console` |
| `options.config` | Object | Arbitrary config passed to every stage as `context.config` |

**Methods**

```js
await engine.start()
// Initializes adapter and DB, starts polling, attaches event listeners.
// Calls process.exit(1) on startup failure.

await engine.stop()
// Shuts down adapter and disconnects DB cleanly.

engine.status()
// → { running: boolean, adapter: string, pipeline: object }
```

---

### `Pipeline`

Runs stages sequentially. A stage can halt the pipeline or pass control to the next.

```js
import { Pipeline } from './src/index.js';

const pipeline = new Pipeline();
```

**Constructor**

```js
new Pipeline(stages?)   // optional initial array of stage functions
```

**Methods**

```js
pipeline.use(stageFn)
// Appends a stage. stageFn must be a named async function.
// Returns `this` for chaining.

pipeline.setHooks(hookManager)
// Attaches a HookManager to emit lifecycle events.
// Returns `this` for chaining.

pipeline.setErrorHandler(errorHandler)
// Attaches an ErrorHandler for per-stage recovery strategies.
// Returns `this` for chaining.

await pipeline.process(message, context)
// Runs all stages. Returns:
// {
//   stop:     boolean,          // true if any stage returned { stop: true } or an error halted it
//   actions:  ActionEntry[],    // all collected { action, data, stage, timestamp } objects
//   metadata: object,           // merged from the stop signal return value
//   error?:   Error,            // set if pipeline stopped due to an error
//   errorStage?: string         // name of the stage that threw
// }

pipeline.inspect()
// Returns metadata about the pipeline without running it:
// {
//   stageCount: number,
//   stages: [{ name: string }],
//   hasHooks: boolean,
//   hookStats: object,
//   hasErrorHandler: boolean,
//   errorStats: object
// }
```

**`createPipeline(stages?)`** — factory function, equivalent to `new Pipeline(stages)`. Provided for backward compatibility.

---

### `HookManager`

Registers and emits lifecycle hooks. Used by `Pipeline` internally; attach via `pipeline.setHooks(hooks)`.

```js
import { HookManager } from './src/index.js';

const hooks = new HookManager();
```

**Methods**

```js
hooks.on(hookName, callback)
// Registers a listener. Multiple listeners per hook are supported.
// callback is async (data) => void.
// Returns `this` for chaining.

await hooks.emit(hookName, data)
// Calls all registered listeners for hookName with data.
// Errors thrown by listeners are caught and logged — they do not stop the pipeline.

hooks.getStatus()
// → { [hookName]: listenerCount }

hooks.clear()
// Removes all listeners.
// Returns `this` for chaining.
```

**Available hook names**

| Hook | `data` shape |
|---|---|
| `before:pipeline` | `{ message }` |
| `after:pipeline` | `{ message, result }` |
| `before:stage` | `{ message, stageName }` |
| `after:stage` | `{ message, stageName, result }` |
| `error:stage` | `{ message, stageName, error }` |

---

### `ErrorHandler`

Centralizes error recovery for pipeline stages. Attach via `pipeline.setErrorHandler(eh)`.

```js
import { ErrorHandler } from './src/index.js';

const errorHandler = new ErrorHandler(logger?);
```

**Methods**

```js
errorHandler.registerRecoveryStrategy(stageName, strategy, options?)
// Registers a recovery strategy for a named stage.
//
// strategy: 'stop' | 'skip' | 'retry' | 'fallback'
// options:
//   maxRetries?:  number   (default 3, for 'retry' strategy)
//   backoffMs?:   number   (default 100ms, for 'retry' strategy)

errorHandler.registerErrorHandler(errorType, handlerFn)
// Registers a custom handler for a specific error class name.
// errorType: string (e.g. 'TypeError', 'DatabaseError')
// handlerFn: async (error, stageName, context) => { action: string, reason?: string }

await errorHandler.handle(error, stageName, context)
// Called by Pipeline internally on stage errors.
// Returns { action: 'stop'|'skip'|'retry'|'fallback', reason?: string }

errorHandler.getStats()
// → { total: number, byType: {}, byStage: {} }

errorHandler.resetStats()
```

**Built-in error type handlers**

| Error constructor name | Behaviour |
|---|---|
| `StageError` | Defers to registered recovery strategy for the stage |
| `DatabaseError` with `code === 'ECONNREFUSED'` | Returns `stop` |
| `DatabaseError` with `code === 'QUERY_CANCELLED'` | Returns `skip` |
| `DatabaseError` (other codes) | Returns `skip` |
| `ValidationError` | Returns `skip` |
| Any other type | Returns `stop` (unknown error fallback) |

**Recovery action priority:** If a stage has a registered recovery strategy, it applies to *any* error thrown by that stage — the error type handler is bypassed. This lets you say "always retry this stage, regardless of what it throws."

---

### `ActionHandler`

Registers and dispatches named actions returned by pipeline stages.

```js
import { ActionHandler } from './src/index.js';

const actionHandler = new ActionHandler(logger?);
```

**Methods**

```js
actionHandler.register(actionType, handlerFn)
// Registers a handler for an action type.
// handlerFn: async (data, context) => void
// Throws if handlerFn is not a function.

await actionHandler.handle(actionType, data?, context)
// Runs the handler for actionType.
// Returns true if handled, false if no handler registered.
// Re-throws if the handler throws.

await actionHandler.handleAll(actions, context)
// Processes an array of { action, data } objects in order.
// Errors in individual handlers are caught and logged — processing continues.

actionHandler.getRegistered()
// → string[]  (list of registered action type names)

actionHandler.getStats()
// → { total: number, byAction: {}, failed: number }

actionHandler.resetStats()
actionHandler.clear()  // removes all registered handlers
```

**Helper functions**

```js
import {
  createAction,
  createActionProcessorMiddleware,
  addAction,
  getActions,
  clearActions,
} from './src/index.js';

createAction(action, data?)
// → { action, data, timestamp }

addAction(message, action, data?)
// Pushes an action onto message._actions directly (without returning from a stage)

getActions(message)
// → message._actions ?? []

clearActions(message)
// Sets message._actions = []

createActionProcessorMiddleware(actionHandler)
// Returns a pipeline stage function that calls actionHandler.handleAll()
// on message._actions. Add as the last stage in your pipeline.
```

---

### `BotManager`

Manages the lifecycle of multiple bot instances — one per client, tenant, or configuration.

```js
import { BotManager } from './src/index.js';

const manager = new BotManager();
```

**Methods**

```js
await manager.addBot(clientId, config, BotEngine, createAdapter)
// Creates and starts a new BotEngine for clientId.
// If a bot already exists for clientId, it is stopped first.
// createAdapter: (config) => AdapterInstance
// Returns the bot instance.

await manager.updateBot(clientId, newConfig, BotEngine, createAdapter)
// Stops the existing bot for clientId and starts a new one with newConfig.
// Returns the new bot instance.

await manager.removeBot(clientId)
// Stops and removes the bot for clientId. No-op if clientId doesn't exist.

manager.getBot(clientId)
// → BotEngine instance or undefined

manager.listBots()
// → string[]  (all active clientIds)

manager.getStatus(clientId)
// → 'running' | 'stopped' | 'not found'
```

---

## Transport Adapters

### `TelegramAdapter`

```js
new TelegramAdapter(botToken, options?)
```

| Parameter | Type | Description |
|---|---|---|
| `botToken` | string | Bot API token from @BotFather |
| `options` | object | Passed through to `node-telegram-bot-api` constructor |

**Methods**

```js
await adapter.initialize()
await adapter.start()
await adapter.shutdown()
adapter.on(eventName, handler)   // 'message' | 'callback_query' | 'chat_join_request'

await adapter.sendMessage(chatId, text, options?)
await adapter.editMessage(chatId, messageId, text, options?)
await adapter.deleteMessage(chatId, messageId)
await adapter.banMember(chatId, userId)
await adapter.unbanMember(chatId, userId)
await adapter.restrictMember(chatId, userId, permissions)
await adapter.approveChatJoinRequest(chatId, userId)
await adapter.declineChatJoinRequest(chatId, userId)
await adapter.sendPoll(chatId, question, options[], extra?)
await adapter.getChat(chatId)
```

---

### `MTProtoAdapter`

```js
new MTProtoAdapter(options)
```

| Option | Type | Description |
|---|---|---|
| `apiId` | number | From my.telegram.org |
| `apiHash` | string | From my.telegram.org |
| `sessionString` | string | Saved session (empty string for first run) |
| `phoneNumber` | string | Required for first-time authentication |

**Methods**

```js
await adapter.initialize()
await adapter.shutdown()
adapter.on(eventName, handler)   // 'message' | 'groupMessage' | 'editedMessage'

await adapter.sendMessage(chatId, text, options?)
await adapter.editMessage(chatId, messageId, text, options?)
await adapter.deleteMessage(chatId, messageId)
await adapter.banMember(chatId, userId)
await adapter.unbanMember(chatId, userId)
await adapter.restrictMember(chatId, userId, permissions)
await adapter.getUserInfo(userId)
await adapter.getChatInfo(chatId)
await adapter.getChatMembers(chatId)
adapter.getSessionString()   // → string | null — save this for future runs
```

---

### `TransportAdapter`

```js
new TransportAdapter(adapters[])
```

**Methods**

```js
await transport.initialize()
await transport.start()
await transport.shutdown()
transport.on(eventName, handler)

await transport.sendMessage(chatId, text, options?)          // uses first adapter
await transport.sendMessageVia(adapterName, chatId, text, options?)
await transport.sendPoll(chatId, question, options[], extra?)

await transport.banMember(chatId, userId)
await transport.unbanMember(chatId, userId)
await transport.restrictMember(chatId, userId, permissions)
await transport.approveChatJoinRequest(chatId, userId)
await transport.declineChatJoinRequest(chatId, userId)
await transport.getChat(chatId)

transport.getAdapter(name)   // → adapter instance or undefined
```

Delegation methods (`banMember`, `sendPoll`, etc.) find the first child adapter that implements the method. `sendMessage` always uses the first adapter unless `sendMessageVia` is called.

---

## Database Adapters

### `PostgreSQLAdapter`

```js
new PostgreSQLAdapter(connectionString, poolOptions?)
```

**Methods**

```js
await db.connect()
await db.disconnect()
await db.ping()   // → boolean

await db.query(sql, params?)          // → { rows: [] }
await db.queryOne(sql, params?)       // → row object or null
await db.queryAll(sql, params?)       // → row array

await db.insert(table, data)          // → inserted row
await db.update(table, data, where)   // → updated row
await db.delete(table, where)         // → pg result
await db.findById(table, id)          // → row or null
await db.findAll(table)               // → row array

await db.transaction(async (client) => { ... })
// client exposes .query(sql, params) within a BEGIN/COMMIT block
// Automatically rolls back on throw
```

---

### `CacheAdapter`

```js
new CacheAdapter(db, cache, options?)
```

| Parameter | Type | Description |
|---|---|---|
| `db` | Adapter | Any adapter implementing the DB interface above |
| `cache` | object | Must have `get(key)`, `set(key, value, ttl)`. Optionally `del(key)` and `clear()` |
| `options.ttl` | number | Default cache TTL in seconds. Defaults to `3600` |

**Methods** — identical to the underlying DB adapter. All reads are automatically cached; all writes automatically invalidate relevant cache keys.

```js
await cache.connect()
await cache.disconnect()
await cache.ping()

await cache.query(sql, params?)
await cache.queryOne(sql, params?)
await cache.queryAll(sql, params?)

await cache.insert(table, data)          // writes DB, invalidates table cache
await cache.update(table, data, where)   // writes DB, invalidates table cache
await cache.delete(table, where)         // writes DB, invalidates table cache
await cache.findById(table, id)          // cache-aware
await cache.findAll(table)               // cache-aware

await cache.transaction(callback)        // writes DB, clears full cache after
```
