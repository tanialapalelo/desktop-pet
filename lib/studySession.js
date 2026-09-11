// lib/studySession.js
// Runtime state machine for a study-goal session: a total goal duration split
// into work/break intervals (pomodoro-style). Intentionally not persisted,
// starting a new session always starts fresh even across app restarts.

let tickHandle = null;
let session = null; // { workMs, breakMs, phase, phaseEndsAt, totalEndsAt }
const listeners = {}; // event -> callback

function on(event, cb) {
  listeners[event] = cb;
}

function emit(event, payload) {
  if (listeners[event]) listeners[event](payload);
}

function isActive() {
  return !!session;
}

function getStatus() {
  if (!session) return { active: false };
  const now = Date.now();
  return {
    active: true,
    phase: session.phase,
    phaseRemainingMs: Math.max(0, session.phaseEndsAt - now),
    totalRemainingMs: Math.max(0, session.totalEndsAt - now)
  };
}

function tick() {
  if (!session) return;
  const now = Date.now();
  if (now >= session.totalEndsAt) {
    stop();
    emit('completed');
    return;
  }
  if (now >= session.phaseEndsAt) {
    if (session.phase === 'work') {
      session.phase = 'break';
      session.phaseEndsAt = now + session.breakMs;
    } else {
      session.phase = 'work';
      session.phaseEndsAt = now + session.workMs;
    }
    emit('phaseChange', { phase: session.phase });
  }
  emit('tick', getStatus());
}

function start({ totalMinutes, workMinutes, breakMinutes }) {
  stop();
  const now = Date.now();
  const workMs = Math.max(1, workMinutes) * 60000;
  session = {
    workMs,
    breakMs: Math.max(1, breakMinutes) * 60000,
    phase: 'work',
    phaseEndsAt: now + workMs,
    totalEndsAt: now + Math.max(1, totalMinutes) * 60000
  };
  tickHandle = setInterval(tick, 1000);
  return getStatus();
}

function stop() {
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = null;
  const wasActive = !!session;
  session = null;
  if (wasActive) emit('stopped');
}

module.exports = { on, start, stop, isActive, getStatus };
