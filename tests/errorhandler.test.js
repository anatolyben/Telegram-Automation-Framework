import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ErrorHandler } from '../src/core/ErrorHandler.js';
import { makeLogger } from './helpers/mocks.js';

// Custom error types for testing
class DatabaseError extends Error { constructor(msg, code) { super(msg); this.name = 'DatabaseError'; this.code = code; } }
class ValidationError extends Error { constructor(msg) { super(msg); this.name = 'ValidationError'; } }
class StageError extends Error { constructor(msg) { super(msg); this.name = 'StageError'; } }

describe('ErrorHandler – dispatch', () => {
  it('dispatches to registered handler by error type', async () => {
    const eh = new ErrorHandler(makeLogger());
    let handled = null;
    eh.registerErrorHandler('TypeError', async (err) => {
      handled = err.message;
      return { action: 'skip' };
    });

    await eh.handle(new TypeError('bad type'), 'myStage', {});

    assert.equal(handled, 'bad type');
  });

  it('falls back to handleUnknownError for unregistered error types', async () => {
    const eh = new ErrorHandler(makeLogger());
    class WeirdError extends Error { constructor() { super('weird'); this.name = 'WeirdError'; } }

    const result = await eh.handle(new WeirdError(), 'someStage', {});

    assert.equal(result.action, 'stop');
    assert.equal(result.reason, 'unknown_error');
  });

  it('tracks stats per error type and stage', async () => {
    const eh = new ErrorHandler(makeLogger());

    await eh.handle(new TypeError('a'), 'stageA', {});
    await eh.handle(new TypeError('b'), 'stageA', {});
    await eh.handle(new RangeError('c'), 'stageB', {});

    const stats = eh.getStats();
    assert.equal(stats.total, 3);
    assert.equal(stats.byType['TypeError'], 2);
    assert.equal(stats.byType['RangeError'], 1);
    assert.equal(stats.byStage['stageA'], 2);
    assert.equal(stats.byStage['stageB'], 1);
  });

  it('resetStats clears all counters', async () => {
    const eh = new ErrorHandler();
    await eh.handle(new TypeError(), 'st', {});
    eh.resetStats();

    assert.deepEqual(eh.getStats(), { total: 0, byType: {}, byStage: {} });
  });
});

describe('ErrorHandler – recovery strategies', () => {
  it('returns stop when strategy is stop', async () => {
    const eh = new ErrorHandler(makeLogger());
    eh.registerRecoveryStrategy('blocker', 'stop');
    const blocker = new StageError('stop me');

    const result = await eh.handle(blocker, 'blocker', {});

    assert.equal(result.action, 'stop');
  });

  it('returns skip when strategy is skip', async () => {
    const eh = new ErrorHandler(makeLogger());
    eh.registerRecoveryStrategy('skipper', 'skip');
    const err = new StageError('skip me');

    const result = await eh.handle(err, 'skipper', {});

    assert.equal(result.action, 'skip');
  });

  it('returns retry when attempt < maxRetries', async () => {
    const eh = new ErrorHandler(makeLogger());
    eh.registerRecoveryStrategy('retrier', 'retry', { maxRetries: 3, backoffMs: 0 });
    const err = new StageError('retry me');

    const result = await eh.handle(err, 'retrier', { attempt: 1 });

    assert.equal(result.action, 'retry');
  });

  it('returns stop when attempt >= maxRetries', async () => {
    const eh = new ErrorHandler(makeLogger());
    eh.registerRecoveryStrategy('retrier', 'retry', { maxRetries: 3, backoffMs: 0 });
    const err = new StageError('retry me');

    const result = await eh.handle(err, 'retrier', { attempt: 3 });

    assert.equal(result.action, 'stop');
    assert.equal(result.reason, 'max_retries');
  });

  it('stops with no_strategy reason when no strategy registered', async () => {
    const eh = new ErrorHandler(makeLogger());
    const err = new StageError('unregistered stage');

    const result = await eh.handle(err, 'notRegistered', {});

    assert.equal(result.action, 'stop');
    assert.equal(result.reason, 'no_strategy');
  });
});

describe('ErrorHandler – built-in handlers', () => {
  it('handles ECONNREFUSED DatabaseError as stop', async () => {
    const eh = new ErrorHandler(makeLogger());
    const err = new DatabaseError('refused', 'ECONNREFUSED');

    const result = await eh.handle(err, 'dbStage', {});

    assert.equal(result.action, 'stop');
    assert.equal(result.reason, 'db_connection_failed');
  });

  it('handles QUERY_CANCELLED DatabaseError as skip', async () => {
    const eh = new ErrorHandler(makeLogger());
    const err = new DatabaseError('cancelled', 'QUERY_CANCELLED');

    const result = await eh.handle(err, 'dbStage', {});

    assert.equal(result.action, 'skip');
    assert.equal(result.reason, 'db_timeout');
  });

  it('handles ValidationError as skip', async () => {
    const eh = new ErrorHandler(makeLogger());
    const err = new ValidationError('bad input');

    const result = await eh.handle(err, 'validateStage', {});

    assert.equal(result.action, 'skip');
    assert.equal(result.reason, 'validation_failed');
  });
});
