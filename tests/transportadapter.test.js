import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TransportAdapter } from '../src/adapters/transports/TransportAdapter.js';
import { makeAdapter } from './helpers/mocks.js';

describe('TransportAdapter – initialization', () => {
  it('initializes all child adapters', async () => {
    const a1 = makeAdapter('A');
    const a2 = makeAdapter('B');
    const t = new TransportAdapter([a1, a2]);

    await t.initialize();

    assert.equal(a1.initialized, true);
    assert.equal(a2.initialized, true);
  });

  it('starts all child adapters', async () => {
    const a1 = makeAdapter('A');
    const a2 = makeAdapter('B');
    const t = new TransportAdapter([a1, a2]);

    await t.start();

    assert.equal(a1.started, true);
    assert.equal(a2.started, true);
  });
});

describe('TransportAdapter – event routing', () => {
  it('registers the same handler on all adapters via on()', () => {
    const a1 = makeAdapter('A');
    const a2 = makeAdapter('B');
    const t = new TransportAdapter([a1, a2]);
    const received = [];

    t.on('message', msg => received.push(msg));

    // simulate messages arriving on each adapter
    a1.emit('message', { text: 'from A' });
    a2.emit('message', { text: 'from B' });

    assert.equal(received.length, 2);
  });

  it('stamps source adapter name onto the message', () => {
    const a1 = makeAdapter('TelegramAdapter');
    const t = new TransportAdapter([a1]);
    let captured = null;

    t.on('message', msg => { captured = msg; });
    a1.emit('message', { text: 'hi' });

    assert.equal(captured.source, 'TelegramAdapter');
  });

  it('sets msg.type to eventName for non-message events that lack a type', () => {
    const a1 = makeAdapter('A');
    const t = new TransportAdapter([a1]);
    let captured = null;

    t.on('chat_join_request', msg => { captured = msg; });
    a1.emit('chat_join_request', { user: 'Bob' }); // no .type

    assert.equal(captured.type, 'chat_join_request');
  });

  it('does not overwrite type on non-message events that already have one', () => {
    const a1 = makeAdapter('A');
    const t = new TransportAdapter([a1]);
    let captured = null;

    t.on('custom_event', msg => { captured = msg; });
    a1.emit('custom_event', { type: 'already_set' });

    assert.equal(captured.type, 'already_set');
  });
});

describe('TransportAdapter – sendMessage', () => {
  it('sends via the first adapter by default', async () => {
    const a1 = makeAdapter('First');
    const a2 = makeAdapter('Second');
    const t = new TransportAdapter([a1, a2]);

    await t.sendMessage(100, 'hello');

    assert.equal(a1.sent.length, 1);
    assert.equal(a2.sent.length, 0);
  });

  it('throws when no adapters are configured', async () => {
    const t = new TransportAdapter([]);
    await assert.rejects(() => t.sendMessage(1, 'x'), /No adapters configured/);
  });

  it('sendMessageVia sends via the named adapter', async () => {
    const a1 = makeAdapter('Alpha');
    const a2 = makeAdapter('Beta');
    const t = new TransportAdapter([a1, a2]);

    await t.sendMessageVia('Beta', 200, 'from beta');

    assert.equal(a1.sent.length, 0);
    assert.equal(a2.sent.length, 1);
    assert.equal(a2.sent[0].chatId, 200);
  });

  it('sendMessageVia throws for unknown adapter name', async () => {
    const t = new TransportAdapter([makeAdapter('A')]);
    await assert.rejects(() => t.sendMessageVia('Ghost', 1, 'x'), /Ghost/);
  });
});

describe('TransportAdapter – delegation methods', () => {
  it('getChat delegates to first adapter with getChat', async () => {
    const a = makeAdapter('A');
    const t = new TransportAdapter([a]);

    const chat = await t.getChat(555);

    assert.deepEqual(chat, { id: 555 });
  });

  it('getChat throws when no adapter has getChat', async () => {
    const a = makeAdapter('A');
    delete a.getChat;
    const t = new TransportAdapter([a]);
    await assert.rejects(() => t.getChat(1), /getChat/);
  });

  it('approveChatJoinRequest delegates correctly', async () => {
    const a = makeAdapter('A');
    const t = new TransportAdapter([a]);
    await assert.doesNotReject(() => t.approveChatJoinRequest(1, 2));
  });

  it('declineChatJoinRequest delegates correctly', async () => {
    const a = makeAdapter('A');
    const t = new TransportAdapter([a]);
    await assert.doesNotReject(() => t.declineChatJoinRequest(1, 2));
  });

  it('banMember delegates correctly', async () => {
    const a = makeAdapter('A');
    const t = new TransportAdapter([a]);
    await assert.doesNotReject(() => t.banMember(1, 2));
  });

  it('unbanMember delegates correctly', async () => {
    const a = makeAdapter('A');
    const t = new TransportAdapter([a]);
    await assert.doesNotReject(() => t.unbanMember(1, 2));
  });

  it('restrictMember delegates correctly', async () => {
    const a = makeAdapter('A');
    const t = new TransportAdapter([a]);
    await assert.doesNotReject(() => t.restrictMember(1, 2, {}));
  });

  it('sendPoll delegates to adapter with sendPoll', async () => {
    const a = makeAdapter('A');
    const t = new TransportAdapter([a]);
    await assert.doesNotReject(() => t.sendPoll(1, 'Q?', ['Yes', 'No']));
  });

  it('getAdapter returns adapter by name', () => {
    const a1 = makeAdapter('Foo');
    const a2 = makeAdapter('Bar');
    const t = new TransportAdapter([a1, a2]);

    assert.equal(t.getAdapter('Bar'), a2);
    assert.equal(t.getAdapter('Nope'), undefined);
  });
});
