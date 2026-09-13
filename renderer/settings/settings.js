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
  el('stretchReminderMinutes').value = settings.stretchReminderMinutes;

  el('petSize').value = settings.petSize;
  el('animationSpeedMultiplier').value = settings.animationSpeedMultiplier || 1;
  el('speedLabel').textContent = `${(settings.animationSpeedMultiplier || 1).toFixed(1)}x`;
  el('soundEnabled').checked = !!settings.soundEnabled;

  el('aiChatEnabled').checked = !!settings.aiChatEnabled;
  el('aiBaseUrl').value = settings.aiBaseUrl || '';
  el('aiModel').value = settings.aiModel || '';

  el('quietHoursEnabled').checked = !!(settings.quietHours && settings.quietHours.enabled);
  el('quietHoursStart').value = (settings.quietHours && settings.quietHours.start) || '22:00';
  el('quietHoursEnd').value = (settings.quietHours && settings.quietHours.end) || '08:00';

  el('launchAtStartup').checked = !!settings.launchAtStartup;
  el('alwaysOnTop').checked = !!settings.alwaysOnTop;
  el('showSummonButton').checked = settings.showSummonButton !== false;

  const studyGoal = settings.studyGoal || {};
  el('studyTotalMinutes').value = studyGoal.totalMinutes || 120;
  el('studyWorkMinutes').value = studyGoal.workMinutes || 25;
  el('studyBreakMinutes').value = studyGoal.breakMinutes || 5;
  el('studyDistractionKeywords').value = (studyGoal.distractionKeywords || []).join(', ');
}

async function refreshApiKeyStatus() {
  const has = await window.api.settings.hasApiKey();
  el('apiKeyStatus').textContent = has ? 'Key saved ✓' : 'No key set';
}

async function init() {
  const settings = await window.api.settings.get();
  populate(settings);
  await refreshApiKeyStatus();
  await refreshStudyStatus();
}
init();
setInterval(refreshStudyStatus, 1000);
window.api.study.onStatus(renderStudyStatus);

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

el('stretchReminderMinutes').addEventListener('change', (e) => {
  save({ stretchReminderMinutes: Math.max(5, Number(e.target.value) || 30) });
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

el('aiBaseUrl').addEventListener('change', (e) => save({ aiBaseUrl: e.target.value.trim() }));
el('aiModel').addEventListener('change', (e) => save({ aiModel: e.target.value.trim() }));

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
el('showSummonButton').addEventListener('change', (e) => save({ showSummonButton: e.target.checked }));

function currentStudyGoalConfig() {
  return {
    totalMinutes: Math.max(1, Number(el('studyTotalMinutes').value) || 120),
    workMinutes: Math.max(1, Number(el('studyWorkMinutes').value) || 25),
    breakMinutes: Math.max(1, Number(el('studyBreakMinutes').value) || 5),
    distractionKeywords: el('studyDistractionKeywords').value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  };
}

function renderStudyStatus(status) {
  const startBtn = el('studyStartBtn');
  const stopBtn = el('studyStopBtn');
  if (!status || !status.active) {
    el('studyStatus').textContent = 'No session running.';
    startBtn.disabled = false;
    stopBtn.disabled = true;
    return;
  }
  startBtn.disabled = true;
  stopBtn.disabled = false;
  const fmt = (ms) => {
    const totalSec = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };
  const phaseLabel = status.phase === 'break' ? 'Break' : 'Work';
  el('studyStatus').textContent = `${phaseLabel} — ${fmt(status.phaseRemainingMs)} left (goal ${fmt(status.totalRemainingMs)})`;
}

async function refreshStudyStatus() {
  const status = await window.api.study.getStatus();
  renderStudyStatus(status);
}

el('studyTotalMinutes').addEventListener('change', (e) => {
  save({ studyGoal: { ...current.studyGoal, totalMinutes: Math.max(1, Number(e.target.value) || 120) } });
});
el('studyWorkMinutes').addEventListener('change', (e) => {
  save({ studyGoal: { ...current.studyGoal, workMinutes: Math.max(1, Number(e.target.value) || 25) } });
});
el('studyBreakMinutes').addEventListener('change', (e) => {
  save({ studyGoal: { ...current.studyGoal, breakMinutes: Math.max(1, Number(e.target.value) || 5) } });
});
el('studyDistractionKeywords').addEventListener('change', (e) => {
  const keywords = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
  save({ studyGoal: { ...current.studyGoal, distractionKeywords: keywords } });
});

el('studyStartBtn').addEventListener('click', async () => {
  const status = await window.api.study.start(currentStudyGoalConfig());
  renderStudyStatus(status);
});
el('studyStopBtn').addEventListener('click', async () => {
  const status = await window.api.study.stop();
  renderStudyStatus(status);
});
