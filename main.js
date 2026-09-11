// main.js, the Electron main process.
// Owns every window, the tray, all scheduling (visits / water / wandering),
// the walk/bubble animation sequencing, and all IPC. Renderers never talk to
// each other directly, everything routes through here.

const path = require('path');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  screen,
  nativeImage,
  safeStorage
} = require('electron');

const store = require('./store');
const basicChat = require('./lib/basicChat');
const ai = require('./lib/ai');
const { getPetDimensions, BUBBLE_WIDTH, BUBBLE_GAP } = require('./lib/petSizes');

const ASSETS = path.join(__dirname, 'assets');
const PET_SPRITE_PATH = path.join(ASSETS, 'sprites', 'pet.png');
const CHIME_PATH = path.join(ASSETS, 'sounds', 'chime.wav');

app.setName('desktop-pet'); // locks the userData folder name regardless of productName

// Only one copy of the pet should ever run. If the user double-clicks the
// launcher (or the "bring pet on screen" recovery launcher) while it's
// already running, we don't start a second instance, instead we nudge the
// existing one to reset and show itself.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let tray = null;
let petWin = null;
let summonWin = null;
let chatWin = null;
let settingsWin = null;

let chatHistory = []; // in-memory only, cleared whenever the chat window closes

const state = {
  petVisible: false,
  petBusy: false, // true for the whole visit (walk-in → idle/bubble → walk-out); blocks overlapping runVisit() triggers
  animating: false, // true ONLY while the window is actively mid-walk (bounds tweening); false while idle/bubble-showing
  direction: 1, // 1 = facing right, -1 = facing left
  restBounds: null, // current resting {x,y,width,height} of petWin while visible
  chatPinningPet: false, // true while chat is open, suppresses auto-leave
  pendingLeaveTimer: null,
  bubbleHideTimer: null
};

let visitTimerHandle = null;
let waterTimerHandle = null;
let wanderTimerHandle = null;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function workArea() {
  return screen.getPrimaryDisplay().workArea;
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function animateBounds(win, from, to, duration, easing, onUpdate, onDone) {
  if (!win || win.isDestroyed()) return;
  const start = Date.now();
  const width = from.width;
  const height = from.height;

  const step = () => {
    if (!win || win.isDestroyed()) return;
    const elapsed = Date.now() - start;
    const t = clamp(elapsed / duration, 0, 1);
    const e = easing(t);
    const x = Math.round(from.x + (to.x - from.x) * e);
    const y = Math.round(from.y + (to.y - from.y) * e);
    win.setBounds({ x, y, width, height });
    if (onUpdate) onUpdate(t);
    if (t < 1) {
      setTimeout(step, 16);
    } else if (onDone) {
      onDone();
    }
  };
  step();
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function weightedRandomCategory() {
  const messages = basicChat.loadMessages();
  const weights = messages.visitCategoryWeights || {};
  const entries = Object.entries(weights);
  if (!entries.length) return 'greeting';
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [cat, w] of entries) {
    r -= w;
    if (r <= 0) return cat;
  }
  return entries[0][0];
}

function pickVisitMessage(category) {
  const messages = basicChat.loadMessages();
  const pool = (messages.visitCategories && messages.visitCategories[category]) || ['Hi!'];
  return basicChat.pickRandom(pool);
}

// ---------------------------------------------------------------------------
// Pause / quiet hours
// ---------------------------------------------------------------------------

function isPausedNow() {
  const { pause } = store.load();
  if (!pause || !pause.until) return false;
  if (Date.now() >= pause.until) {
    // expired, clear it
    store.save({ pause: { mode: null, until: null } });
    refreshTrayMenu();
    return false;
  }
  return true;
}

function isQuietHoursNow() {
  const { quietHours } = store.load();
  if (!quietHours || !quietHours.enabled) return false;
  const [sh, sm] = (quietHours.start || '22:00').split(':').map(Number);
  const [eh, em] = (quietHours.end || '08:00').split(':').map(Number);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (startMin <= endMin) {
    return nowMin >= startMin && nowMin < endMin;
  }
  // wraps past midnight
  return nowMin >= startMin || nowMin < endMin;
}

function isAutoSuppressed() {
  const s = store.load();
  return !s.enabled || isPausedNow() || isQuietHoursNow();
}

function pauseFor(mode) {
  let until;
  if (mode === '30m') until = Date.now() + 30 * 60 * 1000;
  else if (mode === '1h') until = Date.now() + 60 * 60 * 1000;
  else if (mode === 'tomorrow') {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(7, 0, 0, 0); // resumes 7am tomorrow
    until = d.getTime();
  } else {
    return resumePet();
  }
  store.save({ pause: { mode, until } });
  refreshTrayMenu();
}

function resumePet() {
  store.save({ pause: { mode: null, until: null } });
  refreshTrayMenu();
}

// ---------------------------------------------------------------------------
// Pet window
// ---------------------------------------------------------------------------

function ensurePetWindow() {
  if (petWin && !petWin.isDestroyed()) return petWin;

  const { windowWidth, windowHeight } = getPetDimensions(store.load().petSize);

  petWin = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: -windowWidth - 50,
    y: 0,
    transparent: true,
    frame: false,
    show: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: store.load().alwaysOnTop !== false,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (store.load().alwaysOnTop !== false) {
    petWin.setAlwaysOnTop(true, 'screen-saver');
  }
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Default: mostly click-through so the pet never blocks the desktop.
  // The renderer tells us (via pet:hover) when the cursor is actually over
  // the opaque character, and we toggle this off just for that moment.
  petWin.setIgnoreMouseEvents(true, { forward: true });

  petWin.loadFile(path.join(__dirname, 'renderer', 'pet', 'pet.html'));

  petWin.on('closed', () => {
    petWin = null;
  });

  return petWin;
}

function sendPetInit() {
  if (!petWin || petWin.isDestroyed()) return;
  const settings = store.load();
  const dims = getPetDimensions(settings.petSize);
  petWin.webContents.send('pet:init', {
    spriteUrl: 'file://' + PET_SPRITE_PATH.replace(/\\/g, '/'),
    ...dims,
    direction: state.direction,
    soundEnabled: settings.soundEnabled,
    chimeUrl: 'file://' + CHIME_PATH.replace(/\\/g, '/'),
    animationSpeedMultiplier: settings.animationSpeedMultiplier || 1
  });
}

function walkDurationFor(distance) {
  const speed = 0.42 * (store.load().animationSpeedMultiplier || 1); // px/ms
  const ms = Math.abs(distance) / speed;
  return clamp(ms, 450, 1700);
}

function bubbleSideAndBounds(restX, windowWidth, windowHeight) {
  const wa = workArea();
  const fitsRight = restX + windowWidth + BUBBLE_GAP + BUBBLE_WIDTH + 16 <= wa.x + wa.width;
  const side = fitsRight ? 'right' : 'left';
  const grownWidth = windowWidth + BUBBLE_GAP + BUBBLE_WIDTH;
  const x = side === 'right' ? restX : Math.max(wa.x, restX - (BUBBLE_GAP + BUBBLE_WIDTH));
  return { side, bounds: { x, width: grownWidth } };
}

/**
 * Full visit sequence: walk on → (optional bubble) → walk off.
 * kind: 'auto' | 'water' | 'manual' | 'wander'
 */
function runVisit(kind) {
  if (state.petVisible || state.petBusy) return;
  const settings = store.load();
  const win = ensurePetWindow();
  const dims = getPetDimensions(settings.petSize);
  const wa = workArea();

  state.petBusy = true;
  state.petVisible = true;

  const enterFromLeft = Math.random() < 0.5;
  state.direction = enterFromLeft ? 1 : -1;

  const restY = wa.y + wa.height - dims.windowHeight - 8;
  const margin = 24;
  const restX = clamp(
    Math.round(randomBetween(wa.x + margin, wa.x + wa.width - dims.windowWidth - margin)),
    wa.x + margin,
    wa.x + wa.width - dims.windowWidth - margin
  );
  const startX = enterFromLeft ? wa.x - dims.windowWidth - 20 : wa.x + wa.width + 20;

  win.setBounds({ x: startX, y: restY, width: dims.windowWidth, height: dims.windowHeight });
  sendPetInit();
  win.showInactive();
  win.webContents.send('pet:command', { type: 'walk-start', direction: state.direction });

  const enterDuration = walkDurationFor(restX - startX);
  state.animating = true;

  animateBounds(
    win,
    { x: startX, y: restY, width: dims.windowWidth, height: dims.windowHeight },
    { x: restX, y: restY, width: dims.windowWidth, height: dims.windowHeight },
    enterDuration,
    easeOutCubic,
    null,
    () => {
      state.animating = false;
      state.restBounds = { x: restX, y: restY, width: dims.windowWidth, height: dims.windowHeight };
      win.webContents.send('pet:command', { type: 'idle-start' });

      const showBubble = kind !== 'wander';
      if (showBubble) {
        const category = kind === 'water' ? 'water' : weightedRandomCategory();
        const text = pickVisitMessage(category);
        const { side, bounds } = bubbleSideAndBounds(restX, dims.windowWidth, dims.windowHeight);

        win.setBounds({
          x: bounds.x,
          y: restY,
          width: bounds.width,
          height: dims.windowHeight
        });
        win.webContents.send('pet:command', { type: 'bubble-show', text, side });

        const bubbleDuration = randomBetween(10000, 30000);
        state.bubbleHideTimer = setTimeout(() => {
          hideBubbleAndLeave(win, dims, restX, restY);
        }, bubbleDuration);
      } else {
        // Wander: brief idle fidget, no bubble, then leave.
        setTimeout(() => leavePet(win, dims, restX, restY), randomBetween(2200, 4200));
      }
    }
  );
}

function hideBubbleAndLeave(win, dims, restX, restY) {
  if (!win || win.isDestroyed()) return;
  if (state.chatPinningPet) return; // chat is open, stay until it closes
  win.webContents.send('pet:command', { type: 'bubble-hide' });
  // shrink window back to just the pet before walking off
  win.setBounds({ x: restX, y: restY, width: dims.windowWidth, height: dims.windowHeight });
  setTimeout(() => leavePet(win, dims, restX, restY), 260);
}

function leavePet(win, dims, restX, restY) {
  if (!win || win.isDestroyed()) return;
  if (state.chatPinningPet) return; // safety: never walk off while chat is open
  const wa = workArea();
  const exitX = state.direction === 1 ? wa.x + wa.width + 20 : wa.x - dims.windowWidth - 20;
  win.webContents.send('pet:command', { type: 'walk-start', direction: state.direction });
  const duration = walkDurationFor(exitX - restX);
  state.animating = true;
  animateBounds(
    win,
    { x: restX, y: restY, width: dims.windowWidth, height: dims.windowHeight },
    { x: exitX, y: restY, width: dims.windowWidth, height: dims.windowHeight },
    duration,
    easeOutCubic,
    null,
    () => {
      win.hide();
      state.animating = false;
      state.petVisible = false;
      state.petBusy = false;
      state.restBounds = null;
    }
  );
}

/** Cancels any pending bubble/leave timers for the current visit (used when chat opens). */
function pinPetForChat() {
  state.chatPinningPet = true;
  if (state.bubbleHideTimer) {
    clearTimeout(state.bubbleHideTimer);
    state.bubbleHideTimer = null;
  }
}

function unpinPetAfterChat() {
  state.chatPinningPet = false;
  if (!petWin || petWin.isDestroyed() || !state.restBounds) return;
  const settings = store.load();
  const dims = getPetDimensions(settings.petSize);
  setTimeout(() => {
    if (!state.restBounds) return;
    hideBubbleAndLeave(petWin, dims, state.restBounds.x, state.restBounds.y);
  }, 1800);
}

/**
 * Makes sure the pet is on screen (summoning it if needed) and calls back
 * once it has finished walking in and is idle.
 */
function ensurePetVisible(onReady) {
  // Pin immediately (synchronously) so any pending auto-leave is cancelled
  // right away, no matter what state the pet is currently in.
  pinPetForChat();

  if (state.petVisible && state.restBounds && !state.animating) {
    onReady();
    return;
  }

  if (state.petVisible) {
    // Currently mid walk-in/out, wait for it to settle into idle, then proceed.
    let attempts = 0;
    const check = setInterval(() => {
      attempts++;
      if (state.restBounds && !state.animating) {
        clearInterval(check);
        onReady();
      } else if (attempts > 40) {
        // It left before we could catch it (rare race), summon fresh.
        clearInterval(check);
        ensurePetVisible(onReady);
      }
    }, 120);
    return;
  }

  // Not visible at all, summon it manually (bubble still shows; pinning
  // above ensures it won't auto-leave once the bubble timer would fire).
  if (visitTimerHandle) clearTimeout(visitTimerHandle);
  runVisit('manual');
  scheduleNextVisit();
  let attempts = 0;
  const check = setInterval(() => {
    attempts++;
    if (state.restBounds && !state.animating) {
      clearInterval(check);
      onReady();
    } else if (attempts > 40) {
      clearInterval(check); // give up gracefully rather than hang forever
    }
  }, 120);
}

// ---------------------------------------------------------------------------
// Summon button window
// ---------------------------------------------------------------------------

function ensureSummonWindow() {
  if (summonWin && !summonWin.isDestroyed()) return summonWin;

  const wa = workArea();
  const size = 56;
  const saved = store.load().summonButtonPos;
  const x = clamp(saved?.x ?? wa.x + wa.width - size - 24, wa.x, wa.x + wa.width - size);
  const y = clamp(saved?.y ?? wa.y + wa.height - size - 24, wa.y, wa.y + wa.height - size);

  summonWin = new BrowserWindow({
    width: size,
    height: size,
    x,
    y,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  summonWin.setAlwaysOnTop(true, 'screen-saver');
  summonWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  summonWin.loadFile(path.join(__dirname, 'renderer', 'summon', 'summon.html'));

  summonWin.webContents.once('did-finish-load', () => {
    summonWin.webContents.send('summon:init', {
      iconUrl: 'file://' + path.join(ASSETS, 'icons', 'summon-icon.png').replace(/\\/g, '/'),
      x,
      y
    });
  });

  summonWin.on('closed', () => {
    summonWin = null;
  });

  return summonWin;
}

function clampSummonToScreen(x, y, size = 56) {
  const wa = workArea();
  return {
    x: clamp(x, wa.x, wa.x + wa.width - size),
    y: clamp(y, wa.y, wa.y + wa.height - size)
  };
}

// ---------------------------------------------------------------------------
// Chat window
// ---------------------------------------------------------------------------

function openChat() {
  ensurePetVisible(() => {
    if (chatWin && !chatWin.isDestroyed()) {
      chatWin.focus();
      return;
    }
    const dims = getPetDimensions(store.load().petSize);
    const restX = state.restBounds ? state.restBounds.x : workArea().x + 40;
    const restY = state.restBounds ? state.restBounds.y : workArea().y + workArea().height - 300;

    const createChatWindow = () => {
      const chatWidth = 300;
      const chatHeight = 360;
      const wa = workArea();
      const fitsRight = restX + dims.windowWidth + 14 + chatWidth <= wa.x + wa.width;
      const x = fitsRight ? restX + dims.windowWidth + 14 : Math.max(wa.x, restX - chatWidth - 14);
      const y = clamp(restY + dims.windowHeight - chatHeight, wa.y, wa.y + wa.height - chatHeight);

      chatWin = new BrowserWindow({
        width: chatWidth,
        height: chatHeight,
        x,
        y,
        transparent: true,
        frame: false,
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: true,
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false
        }
      });
      chatWin.setAlwaysOnTop(true, 'screen-saver');
      chatWin.loadFile(path.join(__dirname, 'renderer', 'chat', 'chat.html'));

      chatWin.webContents.once('did-finish-load', () => {
        const personality = ai.loadPersonality();
        chatHistory = [];
        chatWin.webContents.send('chat:init', {
          greeting: personality.greetingWhenChatOpens || "Hi! What's up?",
          aiMode: !!store.load().aiChatEnabled
        });
      });

      chatWin.on('closed', () => {
        chatWin = null;
        chatHistory = [];
        unpinPetAfterChat();
      });
    };

    // The speech bubble may still be showing, which widens the pet window
    // past its base size. Collapse it back first so the chat window doesn't
    // open on top of the still-expanded pet/bubble.
    if (petWin && !petWin.isDestroyed() && state.restBounds) {
      petWin.webContents.send('pet:command', { type: 'bubble-hide' });
      petWin.setBounds({ x: restX, y: restY, width: dims.windowWidth, height: dims.windowHeight });
      setTimeout(createChatWindow, 200);
    } else {
      createChatWindow();
    }
  });
}

// ---------------------------------------------------------------------------
// Settings window
// ---------------------------------------------------------------------------

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 460,
    height: 640,
    title: 'Desktop Pet - Settings',
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings', 'settings.html'));
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

function buildTrayMenu() {
  const settings = store.load();
  const paused = isPausedNow();
  const pauseLabel = paused
    ? `Paused (${settings.pause.mode === 'tomorrow' ? 'until tomorrow' : settings.pause.mode})`
    : 'Pause Pet';

  return Menu.buildFromTemplate([
    { label: 'Summon Pet', click: () => triggerManualSummon() },
    { label: 'Chat', click: () => openChat() },
    { label: 'Settings', click: () => openSettings() },
    { type: 'separator' },
    {
      label: pauseLabel,
      submenu: [
        { label: 'Pause 30 minutes', type: 'radio', checked: paused && settings.pause.mode === '30m', click: () => pauseFor('30m') },
        { label: 'Pause 1 hour', type: 'radio', checked: paused && settings.pause.mode === '1h', click: () => pauseFor('1h') },
        { label: 'Pause until tomorrow', type: 'radio', checked: paused && settings.pause.mode === 'tomorrow', click: () => pauseFor('tomorrow') },
        { type: 'separator' },
        { label: 'Resume', type: 'radio', checked: !paused, click: () => resumePet() }
      ]
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
}

function refreshTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ASSETS, 'icons', 'tray-icon.png'));
  tray = new Tray(icon.resize({ width: 20, height: 20 }));
  tray.setToolTip('Desktop Pet');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => refreshTrayMenu());
}

function triggerManualSummon() {
  if (!store.load().enabled) return;
  if (state.petVisible) {
    dismissPetNow(); // pet is already out, treat this click as "send it away"
    return;
  }
  if (visitTimerHandle) clearTimeout(visitTimerHandle);
  runVisit('manual');
  scheduleNextVisit();
}

/** Sends the pet away immediately, skipping the rest of its bubble timer. */
function dismissPetNow() {
  if (state.chatPinningPet) return; // chat is open, let that flow finish on its own
  if (!petWin || petWin.isDestroyed() || !state.restBounds || state.animating) return;
  if (state.bubbleHideTimer) {
    clearTimeout(state.bubbleHideTimer);
    state.bubbleHideTimer = null;
  }
  const dims = getPetDimensions(store.load().petSize);
  hideBubbleAndLeave(petWin, dims, state.restBounds.x, state.restBounds.y);
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

function visitIntervalMs() {
  const s = store.load();
  const minutes = s.visitFrequencyMinutes === 'custom'
    ? (s.visitFrequencyCustomMinutes || 5)
    : Number(s.visitFrequencyMinutes) || 5;
  return minutes * 60 * 1000;
}

function scheduleNextVisit() {
  if (visitTimerHandle) clearTimeout(visitTimerHandle);
  const base = visitIntervalMs();
  const jitter = base * 0.1;
  const delay = base + randomBetween(-jitter, jitter);
  visitTimerHandle = setTimeout(() => {
    if (!isAutoSuppressed() && store.load().checkInsEnabled) {
      runVisit('auto');
    }
    scheduleNextVisit();
  }, delay);
}

function scheduleNextWater() {
  if (waterTimerHandle) clearTimeout(waterTimerHandle);
  const minutes = Number(store.load().waterReminderMinutes) || 45;
  const base = minutes * 60 * 1000;
  const jitter = base * 0.1;
  const delay = base + randomBetween(-jitter, jitter);
  waterTimerHandle = setTimeout(() => {
    if (!isAutoSuppressed()) {
      runVisit('water');
    }
    scheduleNextWater();
  }, delay);
}

function scheduleNextWander() {
  if (wanderTimerHandle) clearTimeout(wanderTimerHandle);
  const delay = randomBetween(3 * 60 * 1000, 8 * 60 * 1000);
  wanderTimerHandle = setTimeout(() => {
    if (!isAutoSuppressed()) {
      runVisit('wander');
    }
    scheduleNextWander();
  }, delay);
}

// ---------------------------------------------------------------------------
// API key handling (encrypted at rest via Electron's OS-level safeStorage)
// ---------------------------------------------------------------------------

function setApiKey(rawKey) {
  if (!rawKey) {
    store.save({ apiKeyEncrypted: null });
    return;
  }
  if (safeStorage.isEncryptionAvailable()) {
    const buf = safeStorage.encryptString(rawKey);
    store.save({ apiKeyEncrypted: buf.toString('base64') });
  } else {
    // Rare fallback (e.g. no OS keychain available), still better than hardcoding.
    store.save({ apiKeyEncrypted: Buffer.from(rawKey, 'utf-8').toString('base64') });
  }
}

function getDecryptedApiKey() {
  const enc = store.load().apiKeyEncrypted;
  if (!enc) return null;
  try {
    const buf = Buffer.from(enc, 'base64');
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buf);
    }
    return buf.toString('utf-8');
  } catch (err) {
    console.error('[main] failed to decrypt API key:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpc() {
  ipcMain.on('pet:hover', (event, isHover) => {
    if (!petWin || petWin.isDestroyed()) return;
    if (isHover) petWin.setIgnoreMouseEvents(false);
    else petWin.setIgnoreMouseEvents(true, { forward: true });
  });

  ipcMain.on('pet:click', () => openChat());

  ipcMain.on('summon:click', () => triggerManualSummon());

  ipcMain.on('summon:drag', (event, { phase, x, y }) => {
    if (!summonWin || summonWin.isDestroyed()) return;
    if (phase === 'move') {
      summonWin.setBounds({ x: Math.round(x), y: Math.round(y), width: 56, height: 56 });
    } else if (phase === 'end') {
      const clamped = clampSummonToScreen(x, y);
      summonWin.setBounds({ x: clamped.x, y: clamped.y, width: 56, height: 56 });
      store.save({ summonButtonPos: clamped });
    }
  });

  ipcMain.on('chat:close', () => {
    if (chatWin && !chatWin.isDestroyed()) chatWin.close();
  });

  ipcMain.handle('chat:send', async (event, text) => {
    chatHistory.push({ role: 'user', content: String(text).slice(0, 2000) });
    const settings = store.load();

    if (settings.aiChatEnabled) {
      const key = getDecryptedApiKey();
      if (key) {
        try {
          const reply = await ai.chat(key, chatHistory);
          chatHistory.push({ role: 'assistant', content: reply });
          return { reply, mode: 'ai' };
        } catch (err) {
          console.error('[main] AI chat failed, falling back to basic mode:', err.message);
          const reply = basicChat.reply(text);
          chatHistory.push({ role: 'assistant', content: reply });
          return { reply, mode: 'ai-fallback' };
        }
      }
    }

    const reply = basicChat.reply(text);
    chatHistory.push({ role: 'assistant', content: reply });
    return { reply, mode: 'basic' };
  });

  ipcMain.handle('settings:get', () => store.load());

  ipcMain.handle('settings:set', (event, partial) => {
    const updated = store.save(partial);

    if (Object.prototype.hasOwnProperty.call(partial, 'visitFrequencyMinutes') ||
        Object.prototype.hasOwnProperty.call(partial, 'visitFrequencyCustomMinutes') ||
        Object.prototype.hasOwnProperty.call(partial, 'checkInsEnabled')) {
      scheduleNextVisit();
    }
    if (Object.prototype.hasOwnProperty.call(partial, 'waterReminderMinutes')) {
      scheduleNextWater();
    }
    if (Object.prototype.hasOwnProperty.call(partial, 'launchAtStartup')) {
      app.setLoginItemSettings({ openAtLogin: !!partial.launchAtStartup });
    }
    if (Object.prototype.hasOwnProperty.call(partial, 'alwaysOnTop') && petWin && !petWin.isDestroyed()) {
      petWin.setAlwaysOnTop(!!partial.alwaysOnTop, 'screen-saver');
    }
    if (Object.prototype.hasOwnProperty.call(partial, 'enabled')) {
      refreshTrayMenu();
    }
    return updated;
  });

  ipcMain.handle('settings:setApiKey', (event, key) => {
    setApiKey(key);
    return { ok: true };
  });

  ipcMain.handle('settings:clearApiKey', () => {
    setApiKey(null);
    return { ok: true };
  });

  ipcMain.handle('settings:hasApiKey', () => !!store.load().apiKeyEncrypted);

  ipcMain.on('settings:close', () => {
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
  });

  ipcMain.handle('pause:set', (event, mode) => {
    pauseFor(mode);
    return store.load().pause;
  });

  ipcMain.handle('pause:get', () => ({ ...store.load().pause, active: isPausedNow() }));
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

/** Resets the summon button to a sane default position and brings the pet
 * on screen. Triggered by the "bring pet on screen" recovery launcher. */
function bringOnScreen() {
  const wa = workArea();
  const size = 56;
  const defaultPos = { x: wa.x + wa.width - size - 24, y: wa.y + wa.height - size - 24 };
  store.save({ summonButtonPos: defaultPos });

  if (summonWin && !summonWin.isDestroyed()) {
    summonWin.setBounds({ x: defaultPos.x, y: defaultPos.y, width: size, height: size });
    summonWin.showInactive();
  } else {
    ensureSummonWindow();
  }

  triggerManualSummon();
}

if (gotLock) {
  app.whenReady().then(() => {
    app.setLoginItemSettings({ openAtLogin: !!store.load().launchAtStartup });

    registerIpc();
    createTray();
    ensureSummonWindow();
    ensurePetWindow();

    scheduleNextVisit();
    scheduleNextWater();
    scheduleNextWander();

    if (process.argv.includes('--bring-on-screen')) {
      setTimeout(bringOnScreen, 400);
    }
  });

  app.on('second-instance', () => {
    bringOnScreen();
  });

  app.on('window-all-closed', (event) => {
    // This app lives in the tray, never quit just because a window closed.
    event.preventDefault?.();
  });

  app.on('before-quit', () => {
    if (visitTimerHandle) clearTimeout(visitTimerHandle);
    if (waterTimerHandle) clearTimeout(waterTimerHandle);
    if (wanderTimerHandle) clearTimeout(wanderTimerHandle);
    if (state.bubbleHideTimer) clearTimeout(state.bubbleHideTimer);
  });
}
