const messagesEl = document.getElementById('messages');
const input = document.getElementById('text-input');
const sendBtn = document.getElementById('send-btn');
const closeBtn = document.getElementById('close-btn');
const modeBadge = document.getElementById('mode-badge');

function addMessage(text, who) {
  const div = document.createElement('div');
  div.className = `msg ${who}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function setBusy(busy) {
  input.disabled = busy;
  sendBtn.disabled = busy;
}

async function sendCurrentText() {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  addMessage(text, 'user');
  setBusy(true);

  const typingEl = addMessage('...', 'pet typing');

  try {
    const { reply, mode } = await window.api.chat.send(text);
    typingEl.remove();
    addMessage(reply, 'pet');
    if (mode === 'ai') modeBadge.textContent = 'ai';
    else if (mode === 'ai-fallback') modeBadge.textContent = 'offline (ai error)';
    else modeBadge.textContent = 'basic';
  } catch (err) {
    typingEl.remove();
    addMessage("Sorry, I couldn't respond just now.", 'pet');
  } finally {
    setBusy(false);
    input.focus();
  }
}

sendBtn.addEventListener('click', sendCurrentText);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendCurrentText();
});
closeBtn.addEventListener('click', () => window.api.chat.close());

window.api.chat.onInit((data) => {
  modeBadge.textContent = data.aiMode ? 'ai' : 'basic';
  addMessage(data.greeting || "Hi! What's up?", 'pet');
  input.focus();
});
