const el = (id) => document.getElementById(id);
const savedToast = el('savedToast');

let current = {};

function showSaved() {
  savedToast.classList.remove('hidden');
  savedToast.classList.add('show');
  clearTimeout(showSaved._t);
  showSaved._t = setTimeout(() => savedToast.classList.remove('show'), 1200);
}

async function save(partial) {
  current = await window.api.settings.set(partial);
  showSaved();
}

function populate(settings) {
  current = settings;

  el('enabled').checked = !!settings.enabled;

  const freq = settings.visitFrequencyMinutes;
  const isCustom = freq === 'custom';
  el('visitFrequencyMinutes').value = isCustom ? 'custom' : String(freq);
  el('customVisitRow').style.display = isCustom ? 'flex' : 'none';
  el('visitFrequencyCustomMinutes').value = settings.visitFrequencyCustomMinutes || 15;

  el('checkInsEnabled').checked = !!settings.checkInsEnabled;
  el('waterReminderMinutes').value = settings.waterReminderMinutes;

  el('petSize').value = settings.petSize;
  el('animationSpeedMultiplier').value = settings.animationSpeedMultiplier || 1;
  el('speedLabel').textContent = `${(settings.animationSpeedMultiplier || 1).toFixed(1)}x`;
  el('soundEnabled').checked = !!settings.soundEnabled;

  el('aiChatEnabled').checked = !!settings.aiChatEnabled;

  el('quietHoursEnabled').checked = !!(settings.quietHours && settings.quietHours.enabled);
  el('quietHoursStart').value = (settings.quietHours && settings.quietHours.start) || '22:00';
  el('quietHoursEnd').value = (settings.quietHours && settings.quietHours.end) || '08:00';

  el('launchAtStartup').checked = !!settings.launchAtStartup;
  el('alwaysOnTop').checked = !!settings.alwaysOnTop;
}

async function refreshApiKeyStatus() {
  const has = await window.api.settings.hasApiKey();
  el('apiKeyStatus').textContent = has ? 'Key saved ✓' : 'No key set';
}

async function init() {
  const settings = await window.api.settings.get();
  populate(settings);
  await refreshApiKeyStatus();
}
init();

el('enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }));

el('visitFrequencyMinutes').addEventListener('change', (e) => {
  const v = e.target.value;
  if (v === 'custom') {
    el('customVisitRow').style.display = 'flex';
    save({ visitFrequencyMinutes: 'custom', visitFrequencyCustomMinutes: Number(el('visitFrequencyCustomMinutes').value) || 15 });
  } else {
    el('customVisitRow').style.display = 'none';
    save({ visitFrequencyMinutes: Number(v) });
  }
});
el('visitFrequencyCustomMinutes').addEventListener('change', (e) => {
  save({ visitFrequencyCustomMinutes: Math.max(1, Number(e.target.value) || 15) });
});

el('checkInsEnabled').addEventListener('change', (e) => save({ checkInsEnabled: e.target.checked }));

el('waterReminderMinutes').addEventListener('change', (e) => {
  save({ waterReminderMinutes: Math.max(5, Number(e.target.value) || 45) });
});

el('petSize').addEventListener('change', (e) => save({ petSize: e.target.value }));

el('animationSpeedMultiplier').addEventListener('input', (e) => {
  el('speedLabel').textContent = `${Number(e.target.value).toFixed(1)}x`;
});
el('animationSpeedMultiplier').addEventListener('change', (e) => {
  save({ animationSpeedMultiplier: Number(e.target.value) });
});

el('soundEnabled').addEventListener('change', (e) => save({ soundEnabled: e.target.checked }));

el('aiChatEnabled').addEventListener('change', (e) => save({ aiChatEnabled: e.target.checked }));

el('saveKeyBtn').addEventListener('click', async () => {
  const key = el('apiKeyInput').value.trim();
  if (!key) return;
  await window.api.settings.setApiKey(key);
  el('apiKeyInput').value = '';
  await refreshApiKeyStatus();
  showSaved();
});
el('clearKeyBtn').addEventListener('click', async () => {
  await window.api.settings.clearApiKey();
  el('apiKeyInput').value = '';
  await refreshApiKeyStatus();
  showSaved();
});

el('quietHoursEnabled').addEventListener('change', (e) => {
  save({ quietHours: { ...current.quietHours, enabled: e.target.checked } });
});
el('quietHoursStart').addEventListener('change', (e) => {
  save({ quietHours: { ...current.quietHours, start: e.target.value } });
});
el('quietHoursEnd').addEventListener('change', (e) => {
  save({ quietHours: { ...current.quietHours, end: e.target.value } });
});

el('launchAtStartup').addEventListener('change', (e) => save({ launchAtStartup: e.target.checked }));
el('alwaysOnTop').addEventListener('change', (e) => save({ alwaysOnTop: e.target.checked }));
