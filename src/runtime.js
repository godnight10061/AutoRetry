import { AutoRetryController } from './controller.js';
import { hasValidZhengwenTag } from './core.js';

function defaultLogger() {
  return console;
}

function onEvent(bus, eventName, handler) {
  bus?.on?.(eventName, handler);
}

function onEventMakeLast(bus, eventName, handler) {
  if (typeof bus?.makeLast === 'function') {
    bus.makeLast(eventName, handler);
    return;
  }

  onEvent(bus, eventName, handler);
}

function offEvent(bus, eventName, handler) {
  if (typeof bus?.off === 'function') {
    bus.off(eventName, handler);
    return;
  }

  if (typeof bus?.removeListener === 'function') {
    bus.removeListener(eventName, handler);
  }
}

/**
 * @param {any[]} chat
 * @returns {{index: number, text: string} | null}
 */
function findLatestAssistantMessage(chat) {
  if (!Array.isArray(chat)) return null;

  for (let i = chat.length - 1; i >= 0; i -= 1) {
    const msg = chat[i];
    if (!msg || msg.is_system) continue;
    if (msg.is_user) return null;

    const text = msg.mes;
    if (typeof text === 'string') {
      return { index: i, text };
    }

    return null;
  }

  return null;
}

/**
 * Finds the assistant message index we should validate for the current generation.
 * - If the last non-system message is a user message, the assistant reply is expected at the next index.
 * - If the last non-system message is an assistant message, we assume a regenerate flow and reuse that index.
 * @param {any[]} chat
 * @returns {number | null}
 */
function computeTargetAssistantIndex(chat) {
  if (!Array.isArray(chat)) return null;

  for (let i = chat.length - 1; i >= 0; i -= 1) {
    const msg = chat[i];
    if (!msg || msg.is_system) continue;
    if (msg.is_user) return i + 1;
    return i;
  }

  return 0;
}

/**
 * @param {any[]} chat
 * @param {number} index
 * @returns {string | null}
 */
function readAssistantTextAt(chat, index) {
  if (!Array.isArray(chat)) return null;
  if (!Number.isInteger(index) || index < 0 || index >= chat.length) return null;

  const msg = chat[index];
  if (!msg || msg.is_system || msg.is_user) return null;

  return typeof msg.mes === 'string' ? msg.mes : '';
}

const SETTLE_DELAY_MS = 250;

function isAutoContinueTimeskipSendAttempt(messageText, autoContinueSettings) {
  if (!autoContinueSettings || typeof autoContinueSettings !== 'object') return false;
  if (autoContinueSettings.enabled === false) return false;
  if (autoContinueSettings.autoContinue !== true) return false;

  const normalized = String(messageText ?? '').trim();
  if (!normalized) return false;

  const selectedOption = String(autoContinueSettings.selectedOption ?? '').trim();
  if (selectedOption && normalized === selectedOption) return true;

  const options = autoContinueSettings.timeskipOptions;
  if (Array.isArray(options)) {
    return options.some((opt) => normalized === String(opt ?? '').trim());
  }

  return false;
}

/**
 * @param {object} deps
 * @param {any} deps.eventBus
 * @param {Record<string, string>} deps.eventTypes
 * @param {() => {chatId?: string, chat?: any[]}} deps.getContext
 * @param {() => void} deps.clickRegenerate
 * @param {() => {enabled?: boolean, maxRetries?: number, cooldownMs?: number, stopOnManualRegen?: boolean}} deps.getSettings
 * @param {{setTimeout: (fn: Function, delayMs: number) => any, clearTimeout: (id: any) => void}} deps.scheduler
 * @param {{debug?: Function, info?: Function, warn?: Function, error?: Function}} [deps.logger]
 */
export function createAutoRetryRuntime({
  eventBus,
  eventTypes,
  getContext,
  clickRegenerate,
  getSettings,
  scheduler,
  logger = defaultLogger(),
}) {
  const controller = new AutoRetryController({
    getSettings,
    scheduler,
    requestRegenerate: clickRegenerate,
    logger,
  });

  /** @type {{seq: number, chatId: string | null, targetIndex: number | null, isGenerating: boolean, settleTimerId: any}} */
  const generationSession = {
    seq: 0,
    chatId: null,
    targetIndex: null,
    isGenerating: false,
    settleTimerId: null,
  };

  /**
   * @param {string} chatId
   * @param {number} index
   */
  const makeMessageKey = (chatId, index) => `${chatId}:${index}`;

  /** @type {{chatId: string | null, assistantIndex: number | null, messageKey: string | null, assistantValid: boolean, consumedForMessageKey: string | null}} */
  const autoContinueGate = {
    chatId: null,
    assistantIndex: null,
    messageKey: null,
    assistantValid: true,
    consumedForMessageKey: null,
  };

  /**
   * Updates the Auto-Continue gate from the assistant message we are waiting for.
   * The gate blocks Auto-Continue-Timeskip programmatic sends while the assistant message is invalid,
   * and allows exactly one send once it becomes valid.
   * @param {{chatId: string, assistantIndex: number, assistantText: string}} input
   */
  const updateAutoContinueGate = ({ chatId, assistantIndex, assistantText }) => {
    const messageKey = makeMessageKey(chatId, assistantIndex);

    if (autoContinueGate.messageKey !== messageKey) {
      autoContinueGate.chatId = chatId;
      autoContinueGate.assistantIndex = assistantIndex;
      autoContinueGate.messageKey = messageKey;
      autoContinueGate.consumedForMessageKey = null;
    }

    autoContinueGate.assistantValid = hasValidZhengwenTag(assistantText);
  };

  const cancelSettle = () => {
    if (generationSession.settleTimerId === null) return;
    try {
      scheduler.clearTimeout(generationSession.settleTimerId);
    } catch (err) {
      logger?.error?.(err);
    } finally {
      generationSession.settleTimerId = null;
    }
  };

  const resetGenerationOnly = () => {
    generationSession.seq += 1;
    generationSession.chatId = null;
    generationSession.targetIndex = null;
    generationSession.isGenerating = false;
    cancelSettle();
  };

  const resetGenerationSession = () => {
    resetGenerationOnly();

    autoContinueGate.chatId = null;
    autoContinueGate.assistantIndex = null;
    autoContinueGate.messageKey = null;
    autoContinueGate.assistantValid = true;
    autoContinueGate.consumedForMessageKey = null;
  };

  const onGenerationStarted = () => {
    const context = getContext?.() ?? {};
    const chatId = typeof context.chatId === 'string' ? context.chatId : 'unknown';
    const targetIndex = computeTargetAssistantIndex(context.chat) ?? 0;

    generationSession.seq += 1;
    generationSession.chatId = chatId;
    generationSession.targetIndex = targetIndex;
    generationSession.isGenerating = true;
    cancelSettle();

    updateAutoContinueGate({ chatId, assistantIndex: targetIndex, assistantText: '' });
    logger?.info?.('[AutoRetry]', 'generation started', { chatId, targetIndex });

    controller.onGenerationStarted();
  };

  const onGenerationEnded = () => {
    const context = getContext?.() ?? {};
    const chatId = typeof context.chatId === 'string' ? context.chatId : 'unknown';
    const targetIndex =
      generationSession.chatId === chatId && Number.isInteger(generationSession.targetIndex)
        ? generationSession.targetIndex
        : computeTargetAssistantIndex(context.chat) ?? 0;

    generationSession.chatId = chatId;
    generationSession.targetIndex = targetIndex;
    generationSession.isGenerating = false;

    const textAtTarget = readAssistantTextAt(context.chat, targetIndex);
    if (typeof textAtTarget === 'string') {
      cancelSettle();
      updateAutoContinueGate({ chatId, assistantIndex: targetIndex, assistantText: textAtTarget });
      controller.onGenerationEnded({ messageKey: makeMessageKey(chatId, targetIndex), messageText: textAtTarget });
      return;
    }

    // Sometimes GENERATION_ENDED fires before the assistant message is rendered, or streaming fails and no message is added.
    // Give the UI a brief chance to render the expected assistant message, then treat missing output as invalid and retry.
    const seq = generationSession.seq;
    cancelSettle();
    generationSession.settleTimerId = scheduler.setTimeout(() => {
      generationSession.settleTimerId = null;
      if (generationSession.seq !== seq) return;

      const settledContext = getContext?.() ?? {};
      const settledChatId = typeof settledContext.chatId === 'string' ? settledContext.chatId : 'unknown';
      if (settledChatId !== chatId) return;

      const settledText = readAssistantTextAt(settledContext.chat, targetIndex) ?? '';
      updateAutoContinueGate({ chatId, assistantIndex: targetIndex, assistantText: settledText });
      controller.onGenerationEnded({ messageKey: makeMessageKey(chatId, targetIndex), messageText: settledText });
    }, SETTLE_DELAY_MS);

    logger?.warn?.('[AutoRetry]', 'no assistant message after generation ended', {
      chatId,
      targetIndex,
      settleDelayMs: SETTLE_DELAY_MS,
    });
  };

  const onCharacterMessageRendered = (messageId) => {
    const context = getContext?.() ?? {};
    const chat = context.chat;
    if (!Array.isArray(chat)) return;

    const id = Number(messageId);
    if (!Number.isInteger(id) || id < 0 || id >= chat.length) return;

    const latest = findLatestAssistantMessage(chat);
    if (!latest || latest.index !== id) return;

    const message = chat[id];
    if (!message || message.is_system || message.is_user) return;

    const chatId = typeof context.chatId === 'string' ? context.chatId : 'unknown';
    const messageText = typeof message.mes === 'string' ? message.mes : '';

    if (generationSession.chatId === chatId && generationSession.targetIndex === id) {
      cancelSettle();
      generationSession.isGenerating = false;
    }

    updateAutoContinueGate({ chatId, assistantIndex: id, assistantText: messageText });
    controller.onGenerationEnded({ messageKey: makeMessageKey(chatId, id), messageText });
  };

  const onMessageSent = () => {
    // Do not clear the Auto-Continue gate here: multiple queued Auto-Continue timers may still fire,
    // and we must keep blocking duplicates for the same assistant reply until a new generation updates the gate.
    resetGenerationOnly();
    controller.onUserMessageSent();
  };
  const onChatChanged = () => {
    resetGenerationSession();
    controller.onChatChanged();
  };

  onEvent(eventBus, eventTypes.GENERATION_STARTED, onGenerationStarted);
  onEvent(eventBus, eventTypes.GENERATION_ENDED, onGenerationEnded);
  onEventMakeLast(eventBus, eventTypes.CHARACTER_MESSAGE_RENDERED, onCharacterMessageRendered);
  onEvent(eventBus, eventTypes.MESSAGE_SENT, onMessageSent);
  onEvent(eventBus, eventTypes.CHAT_CHANGED, onChatChanged);

  return {
    controller,
    shouldBlockAutoContinueTimeskipSend: ({ isTrusted, messageText, autoContinueSettings }) => {
      if (isTrusted === true) return false;

      if (!isAutoContinueTimeskipSendAttempt(messageText, autoContinueSettings)) {
        return false;
      }

      // Block Auto-Continue while a generation is in progress or settling (race: GEN_END before render).
      if (generationSession.isGenerating || generationSession.settleTimerId !== null) {
        return true;
      }

      if (!autoContinueGate.messageKey) {
        return false;
      }

      const context = getContext?.() ?? {};
      const chatId = typeof context.chatId === 'string' ? context.chatId : 'unknown';
      if (autoContinueGate.chatId !== chatId) {
        return false;
      }

      const assistantIndex = autoContinueGate.assistantIndex;
      const assistantText =
        typeof assistantIndex === 'number' ? readAssistantTextAt(context.chat, assistantIndex) ?? '' : '';
      if (typeof assistantIndex === 'number') {
        updateAutoContinueGate({ chatId, assistantIndex, assistantText });
      }

      if (!autoContinueGate.assistantValid) {
        return true;
      }

      if (autoContinueGate.consumedForMessageKey === autoContinueGate.messageKey) {
        return true;
      }

      autoContinueGate.consumedForMessageKey = autoContinueGate.messageKey;
      return false;
    },
    notifyManualRegenerate: () => controller.onManualRegenerate(),
    dispose: () => {
      offEvent(eventBus, eventTypes.GENERATION_STARTED, onGenerationStarted);
      offEvent(eventBus, eventTypes.GENERATION_ENDED, onGenerationEnded);
      offEvent(eventBus, eventTypes.CHARACTER_MESSAGE_RENDERED, onCharacterMessageRendered);
      offEvent(eventBus, eventTypes.MESSAGE_SENT, onMessageSent);
      offEvent(eventBus, eventTypes.CHAT_CHANGED, onChatChanged);
      controller.dispose();
    },
  };
}
