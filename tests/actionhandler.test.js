import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ActionHandler,
  createAction,
  createActionProcessorMiddleware,
  addAction,
  getActions,
  clearActions,
} from '../src/core/ActionHandler.js';
import { makeLogger, makeContext, makeMessage } from './helpers/mocks.js';

describe('ActionHandler – register & handle', () => {
  it('calls the registered handler with data and context', async () => {
    const ah = new ActionHandler(makeLogger());
    let received = null;
    ah.register('greet', async (data, ctx) => { received = { data, ctx }; });

    const ctx = makeContext();
    await ah.handle('greet', { name: 'Alice' }, ctx);

    assert.deepEqual(received.data, { name: 'Alice' });
    assert.equal(received.ctx, ctx);
  });

  it('returns true when handler exists and runs', async () => {
    const ah = new ActionHandler();
    ah.register('ping', async () => {});
    const result = await ah.handle('ping', {}, makeContext());
    assert.equal(result, true);
  });

  it('returns false when no handler is registered for action', async () => {
    const ah = new ActionHandler(makeLogger());
    const result = await ah.handle('unknown_action', {}, makeContext());
    assert.equal(result, false);
  });

  it('returns false for null/undefined action', async () => {
    const ah = new ActionHandler();
    assert.equal(await ah.handle(null,      {}, makeContext()), false);
    assert.equal(await ah.handle(undefined, {}, makeContext()), false);
  });

  it('re-throws when handler throws', async () => {
    const ah = new ActionHandler(makeLogger());
    ah.register('boom', async () => { throw new Error('handler exploded'); });

    await assert.rejects(
      () => ah.handle('boom', {}, makeContext()),
      /handler exploded/
    );
  });

  it('throws when registering a non-function handler', () => {
    const ah = new ActionHandler();
    assert.throws(() => ah.register('bad', 'not-a-function'), /must be a function/);
  });
});

describe('ActionHandler – handleAll', () => {
  it('processes all actions in order', async () => {
    const ah = new ActionHandler(makeLogger());
    const order = [];
    ah.register('a', async () => order.push('a'));
    ah.register('b', async () => order.push('b'));

    await ah.handleAll([{ action: 'a' }, { action: 'b' }], makeContext());

    assert.deepEqual(order, ['a', 'b']);
  });

  it('continues processing remaining actions if one fails', async () => {
    const ah = new ActionHandler(makeLogger());
    const ran = [];
    ah.register('ok1',  async () => ran.push('ok1'));
    ah.register('boom', async () => { throw new Error('fail'); });
    ah.register('ok2',  async () => ran.push('ok2'));

    await ah.handleAll(
      [{ action: 'ok1' }, { action: 'boom' }, { action: 'ok2' }],
      makeContext()
    );

    assert.deepEqual(ran, ['ok1', 'ok2']);
  });

  it('handles empty array without error', async () => {
    const ah = new ActionHandler();
    await assert.doesNotReject(() => ah.handleAll([], makeContext()));
  });

  it('handles non-array input gracefully', async () => {
    const ah = new ActionHandler();
    await assert.doesNotReject(() => ah.handleAll(null, makeContext()));
  });
});

describe('ActionHandler – stats', () => {
  it('tracks total and per-action call counts', async () => {
    const ah = new ActionHandler();
    ah.register('x', async () => {});
    ah.register('y', async () => {});

    await ah.handle('x', {}, makeContext());
    await ah.handle('x', {}, makeContext());
    await ah.handle('y', {}, makeContext());

    const stats = ah.getStats();
    assert.equal(stats.total, 3);
    assert.equal(stats.byAction['x'], 2);
    assert.equal(stats.byAction['y'], 1);
  });

  it('increments failed count when handler throws', async () => {
    const ah = new ActionHandler(makeLogger());
    ah.register('bad', async () => { throw new Error(); });

    try { await ah.handle('bad', {}, makeContext()); } catch {}

    assert.equal(ah.getStats().failed, 1);
  });

  it('resetStats zeroes all counters', async () => {
    const ah = new ActionHandler();
    ah.register('x', async () => {});
    await ah.handle('x', {}, makeContext());
    ah.resetStats();

    assert.deepEqual(ah.getStats(), { total: 0, byAction: {}, failed: 0 });
  });
});

describe('ActionHandler – helpers', () => {
  it('createAction returns correctly shaped object', () => {
    const action = createAction('notify', { userId: 1 });
    assert.equal(action.action, 'notify');
    assert.deepEqual(action.data, { userId: 1 });
    assert.ok(typeof action.timestamp === 'number');
  });

  it('addAction and getActions work on message', () => {
    const msg = makeMessage();
    addAction(msg, 'flag', { reason: 'spam' });
    addAction(msg, 'log');

    const actions = getActions(msg);
    assert.equal(actions.length, 2);
    assert.equal(actions[0].action, 'flag');
  });

  it('clearActions empties the actions array', () => {
    const msg = makeMessage();
    addAction(msg, 'x');
    clearActions(msg);
    assert.deepEqual(getActions(msg), []);
  });

  it('createActionProcessorMiddleware calls handleAll on message._actions', async () => {
    const ah = new ActionHandler();
    const processed = [];
    ah.register('do_thing', async (data) => processed.push(data));

    const middleware = createActionProcessorMiddleware(ah);
    const msg = makeMessage();
    addAction(msg, 'do_thing', { val: 99 });

    await middleware(msg, makeContext());

    assert.equal(processed.length, 1);
    assert.deepEqual(processed[0], { val: 99 });
  });
});
