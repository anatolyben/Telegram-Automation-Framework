import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Pipeline } from '../src/core/Pipeline.js';
import { HookManager } from '../src/core/HookManager.js';
import { ErrorHandler } from '../src/core/ErrorHandler.js';
import { makeMessage, makeContext } from './helpers/mocks.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeStage(name, result = undefined) {
  const fn = async function (msg, ctx) { fn.calls++; return result; };
  Object.defineProperty(fn, 'name', { value: name });
  fn.calls = 0;
  return fn;
}

// ─── basic flow ─────────────────────────────────────────────────────────────

describe('Pipeline – basic flow', () => {
  it('runs all stages when none stop', async () => {
    const p = new Pipeline();
    const s1 = makeStage('s1');
    const s2 = makeStage('s2');
    p.use(s1).use(s2);

    const result = await p.process(makeMessage(), makeContext());

    assert.equal(s1.calls, 1);
    assert.equal(s2.calls, 1);
    assert.equal(result.stop, false);
  });

  it('returns stop=true and skips remaining stages when a stage returns stop', async () => {
    const p = new Pipeline();
    const s1 = makeStage('s1', { stop: true, reason: 'blocked' });
    const s2 = makeStage('s2');
    p.use(s1).use(s2);

    const result = await p.process(makeMessage(), makeContext());

    assert.equal(result.stop, true);
    assert.equal(s2.calls, 0, 'stage after stop should not run');
  });

  it('initialises _actions on message if missing', async () => {
    const p = new Pipeline();
    p.use(makeStage('s1'));
    const msg = makeMessage();
    delete msg._actions;

    await p.process(msg, makeContext());

    assert.ok(Array.isArray(msg._actions));
  });

  it('collect actions returned by stages', async () => {
    const p = new Pipeline();
    p.use(makeStage('s1', { action: 'notify', data: { x: 1 } }));

    const result = await p.process(makeMessage(), makeContext());

    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].action, 'notify');
    assert.deepEqual(result.actions[0].data, { x: 1 });
  });

  it('inspect returns stage metadata', () => {
    const p = new Pipeline();
    p.use(makeStage('alpha')).use(makeStage('beta'));

    const info = p.inspect();

    assert.equal(info.stageCount, 2);
    assert.deepEqual(info.stages.map(s => s.name), ['alpha', 'beta']);
  });

  it('use() is chainable', () => {
    const p = new Pipeline();
    const returned = p.use(makeStage('s1'));
    assert.equal(returned, p);
  });
});

// ─── error handling ──────────────────────────────────────────────────────────

describe('Pipeline – error handling', () => {
  it('skips to next stage by default when no errorHandler is set', async () => {
    const p = new Pipeline();
    const bad  = async function bad()  { bad.calls++; throw new Error('boom'); };
    bad.calls = 0;
    const good = makeStage('good');
    p.use(bad).use(good);

    const result = await p.process(makeMessage(), makeContext());

    assert.equal(result.stop, false);
    assert.equal(good.calls, 1);
  });

  it('stops pipeline when errorHandler returns stop', async () => {
    const eh = new ErrorHandler();
    eh.registerRecoveryStrategy('badStage', 'stop');
    const p = new Pipeline();
    p.setErrorHandler(eh);

    const badStage = async function badStage() { throw new Error('fail'); };
    const after    = makeStage('after');
    p.use(badStage).use(after);

    const result = await p.process(makeMessage(), makeContext());

    assert.equal(result.stop, true);
    assert.equal(after.calls, 0);
  });

  it('skips a stage when errorHandler returns skip', async () => {
    const eh = new ErrorHandler();
    eh.registerRecoveryStrategy('skipMe', 'skip');
    const p = new Pipeline();
    p.setErrorHandler(eh);

    const skipMe = async function skipMe() { throw new Error('skip this'); };
    const after  = makeStage('after');
    p.use(skipMe).use(after);

    const result = await p.process(makeMessage(), makeContext());

    assert.equal(result.stop, false);
    assert.equal(after.calls, 1, 'stage after skipped one should still run');
  });

  it('retries a stage up to maxRetries before stopping', async () => {
    const eh = new ErrorHandler();
    eh.registerRecoveryStrategy('flakey', 'retry', { maxRetries: 3, backoffMs: 0 });
    const p = new Pipeline();
    p.setErrorHandler(eh);

    const flakey = async function flakey() { flakey.calls++; throw new Error('flake'); };
    flakey.calls = 0;
    p.use(flakey);

    const result = await p.process(makeMessage(), makeContext());

    assert.equal(result.stop, true);
    assert.equal(flakey.calls, 3, 'should attempt exactly maxRetries times');
  });

  it('succeeds after a retry if stage eventually passes', async () => {
    const eh = new ErrorHandler();
    eh.registerRecoveryStrategy('eventuallyOk', 'retry', { maxRetries: 3, backoffMs: 0 });
    const p = new Pipeline();
    p.setErrorHandler(eh);
    const after = makeStage('after');

    let attempt = 0;
    const eventuallyOk = async function eventuallyOk() {
      attempt++;
      if (attempt < 3) throw new Error('not yet');
    };
    p.use(eventuallyOk).use(after);

    const result = await p.process(makeMessage(), makeContext());

    assert.equal(result.stop, false);
    assert.equal(attempt, 3);
    assert.equal(after.calls, 1);
  });
});

// ─── hooks ───────────────────────────────────────────────────────────────────

describe('Pipeline – hooks', () => {
  it('emits before:pipeline and after:pipeline', async () => {
    const hooks = new HookManager();
    const fired = [];
    hooks.on('before:pipeline', () => fired.push('before'));
    hooks.on('after:pipeline',  () => fired.push('after'));

    const p = new Pipeline();
    p.setHooks(hooks);
    p.use(makeStage('s1'));

    await p.process(makeMessage(), makeContext());

    assert.deepEqual(fired, ['before', 'after']);
  });

  it('emits before:stage and after:stage for each stage', async () => {
    const hooks = new HookManager();
    const stages = [];
    hooks.on('before:stage', ({ stageName }) => stages.push(`before:${stageName}`));
    hooks.on('after:stage',  ({ stageName }) => stages.push(`after:${stageName}`));

    const p = new Pipeline();
    p.setHooks(hooks);
    p.use(makeStage('alpha')).use(makeStage('beta'));

    await p.process(makeMessage(), makeContext());

    assert.deepEqual(stages, ['before:alpha', 'after:alpha', 'before:beta', 'after:beta']);
  });

  it('emits error:stage when a stage throws', async () => {
    const hooks = new HookManager();
    const errors = [];
    hooks.on('error:stage', ({ stageName }) => errors.push(stageName));

    const p = new Pipeline();
    p.setHooks(hooks);

    const boom = async function boom() { throw new Error('x'); };
    p.use(boom);

    await p.process(makeMessage(), makeContext());

    assert.deepEqual(errors, ['boom']);
  });
});
