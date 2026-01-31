import { hasValidZhengwenTag } from './core.js';

export class AutoRetryController {
  #getSettings;
  #scheduler;
  #requestRegenerate;
  #logger;

  #disposed = false;
  #isGenerating = false;
  #pendingTimerId = null;

  #retryCount = 0;
  #lastMessageKey = null;
  #suppressedByManualRegen = false;
  #loggedMaxRetriesMessageKey = null;
  #loggedCheckMessageKey = null;
  #loggedCheckValid = null;

  /**
   * @param {object} deps
   * @param {() => {enabled?: boolean, maxRetries?: number, cooldownMs?: number, stopOnManualRegen?: boolean}} deps.getSettings
   * @param {{setTimeout: (fn: Function, delayMs: number) => any, clearTimeout: (id: any) => void}} deps.scheduler
   * @param {() => void} deps.requestRegenerate
   * @param {{debug?: Function, info?: Function, warn?: Function, error?: Function}} [deps.logger]
   */
  constructor({ getSettings, scheduler, requestRegenerate, logger = console }) {
    this.#getSettings = getSettings;
    this.#scheduler = scheduler;
    this.#requestRegenerate = requestRegenerate;
    this.#logger = logger;
  }

  dispose() {
    this.#disposed = true;
    this.#cancelPending();
  }

  onGenerationStarted() {
    this.#isGenerating = true;
    this.#cancelPending();
  }

  /**
   * @param {{messageKey: string, messageText: string}} event
   */
  onGenerationEnded(event) {
    this.#isGenerating = false;
    if (this.#disposed) return;

    const settings = this.#readSettings();
    if (!settings.enabled) {
      this.#cancelPending();
      return;
    }

    if (settings.stopOnManualRegen && this.#suppressedByManualRegen) {
      return;
    }

    const messageKey = typeof event?.messageKey === 'string' ? event.messageKey : '';
    const messageText = typeof event?.messageText === 'string' ? event.messageText : '';

    if (!messageKey) return;

    if (this.#lastMessageKey !== messageKey) {
      this.#retryCount = 0;
      this.#lastMessageKey = messageKey;
      this.#loggedMaxRetriesMessageKey = null;
      this.#cancelPending();
    }

    const valid = hasValidZhengwenTag(messageText);
    if (this.#loggedCheckMessageKey !== messageKey || this.#loggedCheckValid !== valid) {
      this.#loggedCheckMessageKey = messageKey;
      this.#loggedCheckValid = valid;
      this.#logger?.info?.('[AutoRetry]', 'check', {
        messageKey,
        valid,
        retryCount: this.#retryCount,
        maxRetries: settings.maxRetries,
      });
    }

    if (valid) {
      this.#retryCount = 0;
      this.#loggedMaxRetriesMessageKey = null;
      this.#cancelPending();
      return;
    }

    if (this.#pendingTimerId !== null) {
      return;
    }

    if (this.#retryCount >= settings.maxRetries) {
      if (this.#loggedMaxRetriesMessageKey !== messageKey) {
        this.#loggedMaxRetriesMessageKey = messageKey;
        this.#logger?.warn?.('[AutoRetry]', 'max retries reached', {
          messageKey,
          maxRetries: settings.maxRetries,
        });
      }
      return;
    }

    if (this.#isGenerating) {
      return;
    }

    this.#retryCount += 1;
    const attempt = this.#retryCount;
    const cooldownMs = settings.cooldownMs;

    this.#logger?.info?.('[AutoRetry]', 'retry scheduled', {
      messageKey,
      attempt,
      maxRetries: settings.maxRetries,
      cooldownMs,
    });

    this.#pendingTimerId = this.#scheduler.setTimeout(() => {
      this.#pendingTimerId = null;
      if (this.#disposed) return;

      const latestSettings = this.#readSettings();
      if (!latestSettings.enabled) return;
      if (latestSettings.stopOnManualRegen && this.#suppressedByManualRegen) return;

      try {
        this.#logger?.info?.('[AutoRetry]', 'regen click', {
          messageKey,
          attempt,
        });
        this.#requestRegenerate();
      } catch (err) {
        this.#logger?.error?.(err);
      }
    }, cooldownMs);
  }

  onUserMessageSent() {
    this.#reset('user message sent');
  }

  onChatChanged() {
    this.#reset('chat changed');
  }

  onManualRegenerate() {
    const settings = this.#readSettings();
    if (!settings.stopOnManualRegen) return;

    this.#suppressedByManualRegen = true;
    this.#retryCount = 0;
    this.#loggedMaxRetriesMessageKey = null;
    this.#loggedCheckMessageKey = null;
    this.#loggedCheckValid = null;
    this.#cancelPending();

    this.#logger?.info?.('[AutoRetry]', 'manual regenerate detected', {
      stopOnManualRegen: true,
    });
  }

  #cancelPending() {
    if (this.#pendingTimerId === null) return;

    try {
      this.#scheduler.clearTimeout(this.#pendingTimerId);
    } catch (err) {
      this.#logger?.error?.(err);
    } finally {
      this.#pendingTimerId = null;
    }
  }

  #reset(_reason) {
    this.#retryCount = 0;
    this.#lastMessageKey = null;
    this.#suppressedByManualRegen = false;
    this.#isGenerating = false;
    this.#loggedMaxRetriesMessageKey = null;
    this.#loggedCheckMessageKey = null;
    this.#loggedCheckValid = null;
    this.#cancelPending();
  }

  #readSettings() {
    const settings = this.#getSettings?.() ?? {};
    const maxRetries = Number(settings.maxRetries);
    const cooldownMs = Number(settings.cooldownMs);

    return {
      enabled: settings.enabled === true,
      maxRetries: Number.isFinite(maxRetries) ? Math.max(0, Math.floor(maxRetries)) : 0,
      cooldownMs: Number.isFinite(cooldownMs) ? Math.max(0, Math.floor(cooldownMs)) : 0,
      stopOnManualRegen: settings.stopOnManualRegen === true,
    };
  }
}
