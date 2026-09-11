// lib/ai.js
// AI mode: calls a chat-completions API using the key the user entered in
// Settings. Defaults to OpenAI, but works with any provider that speaks the
// same OpenAI-compatible /chat/completions format (OpenRouter, Groq,
// Together, a local Ollama or LM Studio server, etc.), by pointing
// aiBaseUrl/aiModel at that provider instead. The key itself is decrypted
// just-in-time by main.js, this module never touches disk and never logs it.

const fs = require('fs');
const path = require('path');

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

function loadPersonality() {
  const file = path.join(__dirname, '..', 'config', 'personality.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    console.error('[ai] failed to load config/personality.json', err);
    return {
      systemPrompt: 'You are a tiny, friendly desktop companion. Keep replies to 1-2 sentences.',
      model: 'gpt-4o-mini',
      apiBaseUrl: DEFAULT_BASE_URL,
      temperature: 0.8,
      maxTokens: 120
    };
  }
}

/**
 * @param {string} apiKey decrypted API key for whichever provider is configured
 * @param {Array<{role: 'user'|'assistant', content: string}>} history recent turns (small window)
 * @param {{ baseUrl?: string, model?: string }} [overrides] from Settings, take priority over personality.json
 * @returns {Promise<string>} the assistant's reply text
 */
async function chat(apiKey, history, overrides = {}) {
  const personality = loadPersonality();
  const baseUrl = (overrides.baseUrl || personality.apiBaseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const model = overrides.model || personality.model || 'gpt-4o-mini';

  const messages = [
    { role: 'system', content: personality.systemPrompt },
    ...history.slice(-8)
  ];

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: personality.temperature ?? 0.8,
      max_tokens: personality.maxTokens ?? 120,
      messages
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`AI API error ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('AI API returned an empty response');
  return text;
}

module.exports = { chat, loadPersonality };
