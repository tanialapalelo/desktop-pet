// store.js
// A tiny, dependency-free persistent JSON store.
// Everything the app needs to remember between launches lives here:
// settings, reminder timing, pet size, summon button position, quiet hours, etc.
// (Conversation history is intentionally NOT stored here — it only lives in memory
// while the chat window is open, per the app spec.)

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  enabled: true, // master enable/disable for the pet

  visitFrequencyMinutes: 5, // how often the pet auto-visits
  visitFrequencyCustomMinutes: null, // used when visitFrequencyMinutes === 'custom'

  waterReminderMinutes: 45, // independent water-reminder cadence
  checkInsEnabled: true, // greeting/mood check-in visits on/off
  soundEnabled: true,

  animationSpeedMultiplier: 1, // 0.5 = slower, 1 = normal, 1.6 = faster
  petSize: 'medium', // small | medium | large

  aiChatEnabled: false, // AI mode toggle (requires API key)
  apiKeyEncrypted: null, // base64 string, encrypted via Electron safeStorage — never plaintext

  launchAtStartup: false,
  alwaysOnTop: true,

  quietHours: {
    enabled: false,
    start: '22:00', // 24h HH:mm
    end: '08:00'
  },

  summonButtonPos: null, // { x, y } — persisted, clamped to visible screen on load
  petLastX: null, // last resting X position, so it doesn't always appear in the same spot

  pause: {
    mode: null, // null | '30m' | '1h' | 'tomorrow'
    until: null // epoch ms, or null
  }
};

function storeFilePath() {
  return path.join(app.getPath('userData'), 'pet-settings.json');
}

let cache = null;

function deepMerge(base, override) {
  const out = { ...base };
  for (const key of Object.keys(override || {})) {
    if (
      override[key] &&
      typeof override[key] === 'object' &&
      !Array.isArray(override[key]) &&
      base[key] &&
      typeof base[key] === 'object'
    ) {
      out[key] = deepMerge(base[key], override[key]);
    } else {
      out[key] = override[key];
    }
  }
  return out;
}

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(storeFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    cache = deepMerge(DEFAULTS, parsed);
  } catch (err) {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function save(partial) {
  cache = deepMerge(load(), partial);
  try {
    fs.writeFileSync(storeFilePath(), JSON.stringify(cache, null, 2), 'utf-8');
  } catch (err) {
    console.error('[store] failed to save settings:', err);
  }
  return cache;
}

function reset() {
  cache = { ...DEFAULTS };
  save({});
  return cache;
}

module.exports = { load, save, reset, DEFAULTS };
