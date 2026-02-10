# Writing Pipeline Stages

Stages are the building blocks of TAF. Every piece of your bot's logic — filtering, enrichment, moderation, logging — lives in a stage. This guide covers how to write them well.

---

## The Stage Contract

A stage is an `async function` that receives `(message, context)` and optionally returns a result object.

```js
async function myStage(message, context) {
  // do something
  // optionally return a signal
}
```

**The function name matters.** The pipeline uses `stage.name` in logs, hook events, and error messages. Always use named function expressions — never anonymous arrow functions for stages.

```js
// ✅ Good — named, inspectable
async function filterSpam(message, context) { ... }

// ❌ Avoid — anonymous, shows as 'anonymous' in logs
pipeline.use(async (message, context) => { ... });
```

---

## Return Values

### Continue (return nothing)

Returning `undefined` (or nothing) signals "I'm done, proceed to the next stage."

```js
async function logMessage(message, context) {
  context.logger.info({ chatId: message.chatId }, message.text);
  // implicit return undefined — pipeline continues
}
```

### Stop the pipeline

Return `{ stop: true }` to halt. No further stages run for this message.

```js
async function blockAnonymousForwarded(message, context) {
  if (message.raw?.forward_sender_name === 'Forwarded') {
    await context.bot.deleteMessage(message.chatId, message.id);
    return { stop: true, reason: 'anonymous_forward' };
  }
}
```

You can attach any extra properties alongside `stop: true` — they get merged into `result.metadata` and passed through the `after:pipeline` hook.

### Declare an action

Return `{ action: 'name', data: {} }` to queue a side effect for the ActionHandler to process. The pipeline collects all actions across all stages and runs them at the end.

```js
async function detectSpamLinks(message, context) {
  if (containsSuspiciousLink(message.text)) {
    return {
      action: 'quarantine_user',
      data: { userId: message.from.id, chatId: message.chatId, reason: 'spam_link' }
    };
  }
}
```

---

## The Context Object

| Property | What it gives you |
|---|---|
| `context.bot` | The transport adapter — `sendMessage`, `banMember`, `deleteMessage`, etc. |
| `context.db` | Your database adapter (or `null` if not configured) |
| `context.logger` | Structured logger |
| `context.config` | Your config object passed to BotEngine |
| `context.state` | Empty `{}` per-message — use it to pass data between stages |

### Passing data between stages with `context.state`

```js
async function fetchUser(message, context) {
  if (!message.from) return;
  context.state.user = await context.db.queryOne(
    'SELECT * FROM users WHERE id = $1',
    [message.from.id]
  );
}

async function checkBanList(message, context) {
  // context.state.user was set by the previous stage
  if (context.state.user?.is_banned) {
    await context.bot.banMember(message.chatId, message.from.id);
    return { stop: true };
  }
}
```

This avoids fetching the same data twice and keeps each stage focused on a single concern.

---

## Handling Specific Message Types

Check `message.type` to react to specific event kinds:

```js
async function handleJoinRequests(message, context) {
  if (message.type !== 'chat_join_request') return;

  const user = message.user;
  const isVerified = await context.db.queryOne(
    'SELECT 1 FROM verified_users WHERE id = $1', [user.id]
  );

  if (isVerified) {
    await context.bot.approveChatJoinRequest(message.chat.id, user.id);
  } else {
    await context.bot.declineChatJoinRequest(message.chat.id, user.id);
  }

  return { stop: true };
}
```

Common `message.type` values:

| Type | Description |
|---|---|
| `text` | Regular text message |
| `new_chat_members` | User(s) joined |
| `left_chat_member` | User left |
| `chat_join_request` | Join request awaiting approval |
| `callback_query` | Inline keyboard button press |

---

## Handling Callback Queries (Inline Buttons)

Callback queries have a slightly different shape. Access them via `message.data` and `message.from`:

```js
async function handleCallbackQuery(message, context) {
  if (message.type !== 'callback_query') return;

  if (message.data === 'approve_user') {
    const userId = parseInt(message.data.split(':')[1]);
    await context.bot.approveChatJoinRequest(message.chat.id, userId);
    // Answer the callback to remove the loading state in Telegram UI
    await context.bot.botInstance.answerCallbackQuery(message.id);
  }

  return { stop: true };
}
```

---

## Stage Composition Patterns

### Guard stages

Put filtering stages first. They protect everything that comes after them.

```js
pipeline
  .use(ignoreBotsAndChannels)   // 1. filter non-user traffic
  .use(ignoreOldMessages)       // 2. filter replayed/stale updates
  .use(requireGroupContext)     // 3. ignore DMs if bot is groups-only
  .use(fetchUser)               // 4. now safe to do DB work
  .use(checkBanList)            // 5. early out for banned users
  .use(handleCommands)          // 6. actual logic
  .use(handleJoinRequests)
  .use(detectSpam);
```

### Enrichment stages

These stages add data to `context.state` without making decisions. Keep them fast and side-effect-free.

```js
async function enrichWithUserRecord(message, context) {
  if (!message.from?.id) return;
  context.state.user = await context.db.queryOne(
    'SELECT * FROM users WHERE telegram_id = $1', [message.from.id]
  );
}

async function enrichWithChatSettings(message, context) {
  context.state.chatSettings = await context.db.queryOne(
    'SELECT * FROM chat_settings WHERE chat_id = $1', [message.chatId]
  );
}
```

### Configurable stages via factory

When a stage needs configuration, wrap it in a factory function:

```js
function createWordFilter(bannedWords) {
  return async function wordFilter(message, context) {
    const text = message.text?.toLowerCase() ?? '';
    if (bannedWords.some(w => text.includes(w))) {
      await context.bot.deleteMessage(message.chatId, message.id);
      return { stop: true, reason: 'banned_word' };
    }
  };
}

// Usage
const wordFilter = createWordFilter(['spam', 'scam', 'crypto']);
pipeline.use(wordFilter);
```

The inner function (`wordFilter`) has a name, so it shows up correctly in logs.

---

## Using the Action Pattern

Prefer returning actions over calling `context.bot` directly. Stages that return actions are pure functions — they're trivial to unit test.

```js
// ✅ Stage declares intent
async function enforceSlowMode(message, context) {
  const user = context.state.user;
  if (!user) return;

  const lastMessage = await context.db.queryOne(
    'SELECT created_at FROM messages WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [user.id]
  );

  const elapsed = Date.now() - new Date(lastMessage?.created_at ?? 0).getTime();
  if (elapsed < context.config.slowModeMs) {
    return {
      action: 'delete_and_warn',
      data: { userId: user.id, chatId: message.chatId, messageId: message.id }
    };
  }
}

// ✅ ActionHandler executes the side effect
actionHandler.register('delete_and_warn', async ({ userId, chatId, messageId }, context) => {
  await context.bot.deleteMessage(chatId, messageId);
  await context.bot.sendMessage(chatId,
    `⏱ Slow down! You're sending messages too quickly.`,
    { reply_to_message_id: messageId }
  );
});
```

To use `ActionHandler`, add it as the final pipeline stage:

```js
import { ActionHandler, createActionProcessorMiddleware } from './src/index.js';

const actionHandler = new ActionHandler(logger);

// Register your action handlers...
actionHandler.register('delete_and_warn', ...);
actionHandler.register('quarantine_user', ...);

// Add as the last stage
pipeline.use(createActionProcessorMiddleware(actionHandler));
```

---

## Error Handling in Stages

By default, if a stage throws an unhandled error, the pipeline logs it and skips to the next stage. To change this behaviour, register a recovery strategy:

```js
import { ErrorHandler } from './src/index.js';

const errorHandler = new ErrorHandler(logger);

// DB failures should retry (network hiccups)
errorHandler.registerRecoveryStrategy('fetchUser', 'retry', {
  maxRetries: 3,
  backoffMs: 100
});

// Enrichment is optional — skip on failure
errorHandler.registerRecoveryStrategy('enrichWithExternalData', 'skip');

// Permission checks are critical — stop everything if they fail
errorHandler.registerRecoveryStrategy('checkPermissions', 'stop');

pipeline.setErrorHandler(errorHandler);
```

| Strategy | Behaviour |
|---|---|
| `'stop'` | Halt the pipeline, set `result.stop = true` |
| `'skip'` | Log and move to the next stage |
| `'retry'` | Re-run the stage, up to `maxRetries` times with `backoffMs` delay |
| `'fallback'` | Move to next stage with `result.fallbackValue = null` |

---

## Observing Stage Execution with Hooks

Add hooks when you need visibility without touching stage code — useful for metrics, tracing, and debugging.

```js
import { HookManager } from './src/index.js';

const hooks = new HookManager();

hooks.on('before:stage', ({ stageName }) => {
  metrics.increment(`stage.start.${stageName}`);
});

hooks.on('after:stage', ({ stageName, result }) => {
  metrics.increment(`stage.end.${stageName}`);
  if (result?.stop) metrics.increment(`stage.stop.${stageName}`);
});

hooks.on('error:stage', ({ stageName, error }) => {
  logger.error({ stage: stageName, err: error }, 'Stage error');
  metrics.increment(`stage.error.${stageName}`);
});

pipeline.setHooks(hooks);
```

---

## Testing Stages

Stages are plain async functions — test them directly with no framework setup needed.

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { blockBannedWords } from './stages/moderation.js';

describe('blockBannedWords', () => {
  it('returns stop for a message containing a banned word', async () => {
    const message = { chatId: 1, id: 99, text: 'buy crypto now' };
    const context = {
      bot:    { deleteMessage: async () => {} },
      config: { bannedWords: ['crypto'] },
      state:  {},
      logger: console,
    };

    const result = await blockBannedWords(message, context);

    assert.equal(result?.stop, true);
  });

  it('returns nothing for clean messages', async () => {
    const message = { chatId: 1, id: 99, text: 'hello world' };
    const context = { bot: {}, config: { bannedWords: ['crypto'] }, state: {}, logger: console };

    const result = await blockBannedWords(message, context);

    assert.equal(result, undefined);
  });
});
```
