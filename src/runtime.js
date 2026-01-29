import { AutoRetryController } from './controller.js';

function defaultLogger() {
  return console;
}

function onEvent(bus, eventName, handler) {
  bus?.on?.(eventName, handler);
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

  const onGenerationStarted = () => controller.onGenerationStarted();

  const onGenerationEnded = () => {
    const context = getContext?.() ?? {};
    const latest = findLatestAssistantMessage(context.chat);
    if (!latest) return;

    const chatId = typeof context.chatId === 'string' ? context.chatId : 'unknown';
    const messageKey = `${chatId}:${latest.index}`;

    controller.onGenerationEnded({ messageKey, messageText: latest.text });
  };

  const onMessageSent = () => controller.onUserMessageSent();
  const onChatChanged = () => controller.onChatChanged();

  onEvent(eventBus, eventTypes.GENERATION_STARTED, onGenerationStarted);
  onEvent(eventBus, eventTypes.GENERATION_ENDED, onGenerationEnded);
  onEvent(eventBus, eventTypes.MESSAGE_SENT, onMessageSent);
  onEvent(eventBus, eventTypes.CHAT_CHANGED, onChatChanged);

  return {
    controller,
    notifyManualRegenerate: () => controller.onManualRegenerate(),
    dispose: () => {
      offEvent(eventBus, eventTypes.GENERATION_STARTED, onGenerationStarted);
      offEvent(eventBus, eventTypes.GENERATION_ENDED, onGenerationEnded);
      offEvent(eventBus, eventTypes.MESSAGE_SENT, onMessageSent);
      offEvent(eventBus, eventTypes.CHAT_CHANGED, onChatChanged);
      controller.dispose();
    },
  };
}
