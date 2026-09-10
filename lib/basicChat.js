// lib/basicChat.js
// Offline chat mode: simple, fast keyword matching against config/messages.json.
// No API key or network access required.

const fs = require('fs');
const path = require('path');

function loadMessages() {
  const file = path.join(__dirname, '..', 'config', 'messages.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    console.error('[basicChat] failed to load config/messages.json', err);
    return { basicChat: { patterns: [], responses: { fallback: ["I'm here."] } } };
  }
}

function pickRandom(arr) {
  if (!arr || !arr.length) return "I'm here.";
  return arr[Math.floor(Math.random() * arr.length)];
}

function reply(userText) {
  const messages = loadMessages();
  const chat = messages.basicChat || { patterns: [], responses: {} };
  const text = String(userText || '').toLowerCase().trim();

  for (const rule of chat.patterns || []) {
    for (const phrase of rule.match || []) {
      if (text.includes(phrase.toLowerCase())) {
        return pickRandom(chat.responses[rule.category]);
      }
    }
  }

  return pickRandom(chat.responses.fallback);
}

module.exports = { reply, loadMessages, pickRandom };
