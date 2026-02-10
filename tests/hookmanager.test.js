import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HookManager } from '../src/core/HookManager.js';

describe('HookManager', () => {
  it('calls a registered listener when hook is emitted', async () => {
    const h = new HookManager();
    let received = null;
    h.on('my:hook', data => { received = data; });

    await h.emit('my:hook', { value: 42 });

    assert.deepEqual(received, { value: 42 });
  });

  it('calls multiple listeners on the same hook in order', async () => {
    const h = new HookManager();
    const order = [];
    h.on('ev', () => order.push(1));
    h.on('ev', () => order.push(2));
    h.on('ev', () => order.push(3));

    await h.emit('ev', {});

    assert.deepEqual(order, [1, 2, 3]);
  });

  it('does nothing when emitting a hook with no listeners', async () => {
    const h = new HookManager();
    await assert.doesNotReject(() => h.emit('unknown:hook', {}));
  });

  it('continues calling remaining listeners if one throws', async () => {
    const h = new HookManager();
    const reached = [];
    h.on('ev', () => { throw new Error('oops'); });
    h.on('ev', () => reached.push('second'));

    await h.emit('ev', {});

    assert.deepEqual(reached, ['second']);
  });

  it('getStatus returns listener counts per hook', () => {
    const h = new HookManager();
    h.on('a', () => {});
    h.on('a', () => {});
    h.on('b', () => {});

    const status = h.getStatus();

    assert.equal(status['a'], 2);
    assert.equal(status['b'], 1);
  });

  it('clear() removes all listeners', async () => {
    const h = new HookManager();
    let called = false;
    h.on('ev', () => { called = true; });
    h.clear();

    await h.emit('ev', {});

    assert.equal(called, false);
    assert.deepEqual(h.getStatus(), {});
  });

  it('on() is chainable', () => {
    const h = new HookManager();
    const returned = h.on('ev', () => {});
    assert.equal(returned, h);
  });
});
