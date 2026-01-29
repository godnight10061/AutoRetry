import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createAutoRetryRuntime } from '../../src/runtime.js';

class FakeScheduler {
  #nowMs = 0;
  #nextId = 1;
  #timers = new Map();

  now = () => this.#nowMs;

  setTimeout = (fn, delayMs) => {
    const id = this.#nextId++;
    this.#timers.set(id, { at: this.#nowMs + delayMs, fn });
    return id;
  };

  clearTimeout = (id) => {
    this.#timers.delete(id);
  };

  advanceBy(ms) {
    this.#nowMs += ms;
    for (;;) {
      const due = [...this.#timers.entries()]
        .filter(([, t]) => t.at <= this.#nowMs)
        .sort((a, b) => a[1].at - b[1].at);

      if (due.length === 0) break;

      for (const [id, t] of due) {
        this.#timers.delete(id);
        t.fn();
      }
    }
  }
}

test('e2e: invalid assistant message triggers regenerate up to maxRetries then stops', () => {
  const eventBus = new EventEmitter();
  const scheduler = new FakeScheduler();

  const eventTypes = {
    GENERATION_STARTED: 'generation_started',
    GENERATION_ENDED: 'generation_ended',
    MESSAGE_SENT: 'message_sent',
    CHAT_CHANGED: 'chat_id_changed',
  };

  const context = { chatId: 'chat-a', chat: [] };
  const getContext = () => context;

  let regenClicks = 0;
  const clickRegenerate = () => {
    regenClicks += 1;
    eventBus.emit(eventTypes.GENERATION_STARTED);
  };

  const settings = {
    enabled: true,
    maxRetries: 2,
    cooldownMs: 1000,
    stopOnManualRegen: false,
  };

  const runtime = createAutoRetryRuntime({
    eventBus,
    eventTypes,
    getContext,
    clickRegenerate,
    getSettings: () => settings,
    scheduler,
  });

  context.chat.push({ is_user: true, mes: 'hi' });
  context.chat.push({ is_user: false, is_system: false, mes: 'no tag' });
  eventBus.emit(eventTypes.GENERATION_ENDED);

  assert.equal(regenClicks, 0);
  scheduler.advanceBy(999);
  assert.equal(regenClicks, 0);
  scheduler.advanceBy(1);
  assert.equal(regenClicks, 1);

  context.chat[1].mes = 'still invalid';
  eventBus.emit(eventTypes.GENERATION_ENDED);
  scheduler.advanceBy(1000);
  assert.equal(regenClicks, 2);

  context.chat[1].mes = 'still invalid again';
  eventBus.emit(eventTypes.GENERATION_ENDED);
  scheduler.advanceBy(1000);
  assert.equal(regenClicks, 2);

  runtime.dispose();
});

test('e2e: resets on user message sent', () => {
  const eventBus = new EventEmitter();
  const scheduler = new FakeScheduler();

  const eventTypes = {
    GENERATION_STARTED: 'generation_started',
    GENERATION_ENDED: 'generation_ended',
    MESSAGE_SENT: 'message_sent',
    CHAT_CHANGED: 'chat_id_changed',
  };

  const context = { chatId: 'chat-a', chat: [] };
  const getContext = () => context;

  let regenClicks = 0;
  const clickRegenerate = () => {
    regenClicks += 1;
  };

  const settings = {
    enabled: true,
    maxRetries: 1,
    cooldownMs: 0,
    stopOnManualRegen: false,
  };

  const runtime = createAutoRetryRuntime({
    eventBus,
    eventTypes,
    getContext,
    clickRegenerate,
    getSettings: () => settings,
    scheduler,
  });

  context.chat.push({ is_user: true, mes: 'hi' });
  context.chat.push({ is_user: false, is_system: false, mes: 'invalid' });
  eventBus.emit(eventTypes.GENERATION_ENDED);
  scheduler.advanceBy(0);
  assert.equal(regenClicks, 1);

  eventBus.emit(eventTypes.MESSAGE_SENT);

  context.chat.push({ is_user: false, is_system: false, mes: 'invalid again' });
  eventBus.emit(eventTypes.GENERATION_ENDED);
  scheduler.advanceBy(0);
  assert.equal(regenClicks, 2);

  runtime.dispose();
});

test('e2e: stopOnManualRegen suppresses auto retries until next user message', () => {
  const eventBus = new EventEmitter();
  const scheduler = new FakeScheduler();

  const eventTypes = {
    GENERATION_STARTED: 'generation_started',
    GENERATION_ENDED: 'generation_ended',
    MESSAGE_SENT: 'message_sent',
    CHAT_CHANGED: 'chat_id_changed',
  };

  const context = { chatId: 'chat-a', chat: [] };
  const getContext = () => context;

  let regenClicks = 0;
  const clickRegenerate = () => {
    regenClicks += 1;
  };

  const settings = {
    enabled: true,
    maxRetries: 5,
    cooldownMs: 0,
    stopOnManualRegen: true,
  };

  const runtime = createAutoRetryRuntime({
    eventBus,
    eventTypes,
    getContext,
    clickRegenerate,
    getSettings: () => settings,
    scheduler,
  });

  context.chat.push({ is_user: true, mes: 'hi' });
  context.chat.push({ is_user: false, is_system: false, mes: 'invalid' });

  runtime.notifyManualRegenerate();
  eventBus.emit(eventTypes.GENERATION_ENDED);
  scheduler.advanceBy(0);
  assert.equal(regenClicks, 0);

  eventBus.emit(eventTypes.MESSAGE_SENT);

  context.chat.push({ is_user: false, is_system: false, mes: 'invalid again' });
  eventBus.emit(eventTypes.GENERATION_ENDED);
  scheduler.advanceBy(0);
  assert.equal(regenClicks, 1);

  runtime.dispose();
});

test('e2e: empty assistant message still triggers regenerate', () => {
  const eventBus = new EventEmitter();
  const scheduler = new FakeScheduler();

  const eventTypes = {
    GENERATION_STARTED: 'generation_started',
    GENERATION_ENDED: 'generation_ended',
    MESSAGE_SENT: 'message_sent',
    CHAT_CHANGED: 'chat_id_changed',
  };

  const context = { chatId: 'chat-a', chat: [] };
  const getContext = () => context;

  let regenClicks = 0;
  const clickRegenerate = () => {
    regenClicks += 1;
  };

  const settings = {
    enabled: true,
    maxRetries: 1,
    cooldownMs: 0,
    stopOnManualRegen: false,
  };

  const runtime = createAutoRetryRuntime({
    eventBus,
    eventTypes,
    getContext,
    clickRegenerate,
    getSettings: () => settings,
    scheduler,
  });

  context.chat.push({ is_user: true, mes: 'hi' });
  context.chat.push({ is_user: false, is_system: false, mes: '' });
  eventBus.emit(eventTypes.GENERATION_ENDED);
  scheduler.advanceBy(0);
  assert.equal(regenClicks, 1);

  runtime.dispose();
});
