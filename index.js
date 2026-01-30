import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';

import { createAutoRetryRuntime } from './src/runtime.js';

const SETTINGS_KEY = 'autoretry';
const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  maxRetries: 2,
  cooldownMs: 1000,
  stopOnManualRegen: true,
});

function ensureSettings() {
  if (!extension_settings[SETTINGS_KEY] || typeof extension_settings[SETTINGS_KEY] !== 'object') {
    extension_settings[SETTINGS_KEY] = {};
  }

  const settings = extension_settings[SETTINGS_KEY];
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (settings[key] === undefined) {
      settings[key] = value;
    }
  }

  return settings;
}

function clickRegenerateOption({ markAutoClick }) {
  const el = document.getElementById('option_regenerate');
  if (!el) return;

  markAutoClick(true);
  try {
    el.click();
  } finally {
    queueMicrotask(() => markAutoClick(false));
  }
}

function addSettingsUi(settings) {
  const $root = $('#extensions_settings2');
  if ($root.length === 0) return;

  if ($('#autoretry_container').length > 0) return;

  const html = `
    <div id="autoretry_container" class="extension_container">
      <div class="list-group-item">
        <div class="flex-container alignitemscenter justifySpaceBetween">
          <h3 class="margin0">AutoRetry (正文 Guard)</h3>
        </div>

        <div class="autoretry-row">
          <label class="checkbox_label flexNoGap" for="autoretry_enabled">
            <input id="autoretry_enabled" type="checkbox" />
            <span>Enabled</span>
          </label>
        </div>

        <div class="autoretry-row">
          <label for="autoretry_max_retries">Max retries</label>
          <input id="autoretry_max_retries" type="number" min="0" step="1" class="text_pole" style="max-width: 7em;" />
        </div>

        <div class="autoretry-row">
          <label for="autoretry_cooldown_ms">Cooldown (ms)</label>
          <input id="autoretry_cooldown_ms" type="number" min="0" step="100" class="text_pole" style="max-width: 7em;" />
        </div>

        <div class="autoretry-row">
          <label class="checkbox_label flexNoGap" for="autoretry_stop_on_manual_regen">
            <input id="autoretry_stop_on_manual_regen" type="checkbox" />
            <span>Stop on manual Regenerate</span>
          </label>
        </div>

        <small>
          Auto-regenerates when the last assistant message has no non-empty <code>&lt;正文&gt;...&lt;/正文&gt;</code> or <code>&lt;game&gt;...&lt;/game&gt;</code>.
        </small>
      </div>
    </div>
  `;

  $root.append(html);

  $('#autoretry_enabled').prop('checked', settings.enabled === true);
  $('#autoretry_max_retries').val(String(settings.maxRetries));
  $('#autoretry_cooldown_ms').val(String(settings.cooldownMs));
  $('#autoretry_stop_on_manual_regen').prop('checked', settings.stopOnManualRegen === true);

  $('#autoretry_enabled').on('input', () => {
    settings.enabled = $('#autoretry_enabled').prop('checked');
    saveSettingsDebounced();
  });

  $('#autoretry_max_retries').on('input', () => {
    const value = Number($('#autoretry_max_retries').val());
    settings.maxRetries = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : DEFAULT_SETTINGS.maxRetries;
    saveSettingsDebounced();
  });

  $('#autoretry_cooldown_ms').on('input', () => {
    const value = Number($('#autoretry_cooldown_ms').val());
    settings.cooldownMs = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : DEFAULT_SETTINGS.cooldownMs;
    saveSettingsDebounced();
  });

  $('#autoretry_stop_on_manual_regen').on('input', () => {
    settings.stopOnManualRegen = $('#autoretry_stop_on_manual_regen').prop('checked');
    saveSettingsDebounced();
  });
}

jQuery(() => {
  const settings = ensureSettings();
  addSettingsUi(settings);

  let isAutoClick = false;
  const markAutoClick = (value) => {
    isAutoClick = value;
  };

  const runtime = createAutoRetryRuntime({
    eventBus: eventSource,
    eventTypes: event_types,
    getContext,
    clickRegenerate: () => clickRegenerateOption({ markAutoClick }),
    getSettings: () => ensureSettings(),
    scheduler: window,
    logger: console,
  });

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const sendButton = target.closest('#send_but');
      if (!sendButton) return;

      const textarea = document.getElementById('send_textarea');
      const messageText = textarea instanceof HTMLTextAreaElement ? textarea.value : '';
      const autoContinueSettings = extension_settings?.['auto-continue-timeskip'];

      if (
        runtime.shouldBlockAutoContinueTimeskipSend({
          isTrusted: event.isTrusted,
          messageText,
          autoContinueSettings,
        })
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
      }
    },
    true,
  );

  document.addEventListener(
    'click',
    (event) => {
      if (isAutoClick) return;

      const target = event.target;
      if (!(target instanceof Element)) return;

      const regen = target.closest('#option_regenerate');
      if (!regen) return;

      runtime.notifyManualRegenerate();
    },
    true,
  );
});
