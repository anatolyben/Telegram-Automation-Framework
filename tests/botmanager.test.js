import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BotManager } from '../src/core/BotManager.js';

// ─── fake BotEngine ──────────────────────────────────────────────────────────

function makeFakeBotEngine(adapter, options) {
  return {
    adapter,
    options,
    started:  false,
    stopped:  false,
    async start() { this.started = true; },
    async stop()  { this.stopped = true; },
  };
}

const FakeBotEngine = function (adapter, options) {
  return makeFakeBotEngine(adapter, options);
};

const createAdapter = (config) => ({ config, name: 'FakeAdapter' });

// ─── tests ───────────────────────────────────────────────────────────────────

describe('BotManager – addBot', () => {
  it('adds a bot, starts it, and marks it running', async () => {
    const mgr = new BotManager();
    const bot = await mgr.addBot('client1', { token: 'abc' }, FakeBotEngine, createAdapter);

    assert.equal(bot.started, true);
    assert.equal(mgr.getStatus('client1'), 'running');
  });

  it('returns the bot instance', async () => {
    const mgr = new BotManager();
    const bot = await mgr.addBot('c1', {}, FakeBotEngine, createAdapter);
    assert.ok(bot);
    assert.equal(bot, mgr.getBot('c1'));
  });

  it('replaces an existing bot when called with same clientId', async () => {
    const mgr = new BotManager();
    const first = await mgr.addBot('c1', { token: 'old' }, FakeBotEngine, createAdapter);
    const second = await mgr.addBot('c1', { token: 'new' }, FakeBotEngine, createAdapter);

    assert.notEqual(first, second);
    assert.equal(first.stopped, true, 'original bot should be stopped');
    assert.equal(mgr.getBot('c1'), second);
  });
});

describe('BotManager – removeBot', () => {
  it('stops the bot and removes it from the map', async () => {
    const mgr = new BotManager();
    const bot = await mgr.addBot('c1', {}, FakeBotEngine, createAdapter);
    await mgr.removeBot('c1');

    assert.equal(bot.stopped, true);
    assert.equal(mgr.getBot('c1'), undefined);
  });

  it('does nothing when removing a non-existent clientId', async () => {
    const mgr = new BotManager();
    await assert.doesNotReject(() => mgr.removeBot('ghost'));
  });
});

describe('BotManager – updateBot', () => {
  it('stops the old bot and starts a new one with new config', async () => {
    const mgr = new BotManager();
    const first = await mgr.addBot('c1', { v: 1 }, FakeBotEngine, createAdapter);
    const second = await mgr.updateBot('c1', { v: 2 }, FakeBotEngine, createAdapter);

    assert.equal(first.stopped, true);
    assert.equal(second.started, true);
    assert.deepEqual(second.options, { v: 2 });
  });
});

describe('BotManager – listBots / getStatus', () => {
  it('listBots returns all active clientIds', async () => {
    const mgr = new BotManager();
    await mgr.addBot('a', {}, FakeBotEngine, createAdapter);
    await mgr.addBot('b', {}, FakeBotEngine, createAdapter);

    assert.deepEqual(mgr.listBots().sort(), ['a', 'b']);
  });

  it('getStatus returns not found for unknown clientId', () => {
    const mgr = new BotManager();
    assert.equal(mgr.getStatus('unknown'), 'not found');
  });

  it('listBots reflects removals', async () => {
    const mgr = new BotManager();
    await mgr.addBot('x', {}, FakeBotEngine, createAdapter);
    await mgr.addBot('y', {}, FakeBotEngine, createAdapter);
    await mgr.removeBot('x');

    assert.deepEqual(mgr.listBots(), ['y']);
  });
});
