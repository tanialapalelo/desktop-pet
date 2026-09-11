// lib/ai.js
// AI mode: calls the OpenAI Chat Completions API using the key the user entered
// in Settings. The key itself is decrypted just-in-time by main.js, this module
// never touches disk and never logs the key.

const fs = require('fs');
const path = require('path');

function loadPersonality() {
  const file = path.join(__dirname, '..', 'config', 'personality.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    console.error('[ai] failed to load config/personality.json', err);
    return {
      systemPrompt: 'You are a tiny, friendly desktop companion. Keep replies to 1-2 sentences.',
      model: 'gpt-4o-mini',
      temperature: 0.8,
      maxTokens: 120
    };
  }
}

/**
 * @param {string} apiKey decrypted OpenAI API key
 * @param {Array<{role: 'user'|'assistant', content: string}>} history recent turns (small window)
 * @returns {Promise<string>} the assistant's reply text
 */
async function chat(apiKey, history) {
  const personality = loadPersonality();

  const messages = [
    { role: 'system', content: personality.systemPrompt },
    ...history.slice(-8)
  ];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: personality.model || 'gpt-4o-mini',
      temperature: personality.temperature ?? 0.8,
      max_tokens: personality.maxTokens ?? 120,
      messages
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`OpenAI API error ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('OpenAI API returned an empty response');
  return text;
}

module.exports = { chat, loadPersonality };
