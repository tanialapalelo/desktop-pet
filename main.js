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
const activeWindow = require('./lib/activeWindow');
const studySession = require('./lib/studySession');
const { getPetDimensions, BUBBLE_WIDTH, BUBBLE_GAP } = require('./lib/petSizes');

const ASSETS = path.join(__dirname, 'assets');
const CAT_SPRITES_DIR = path.join(ASSETS, 'sprites', 'cat');
const CHIME_PATH = path.join(ASSETS, 'sounds', 'chime.wav');

// One expression per visit "kind"/message category, all cropped to the same
// canvas size (see scripts/extract_cat_sprites.py) so switching between them
// never changes the pet window's aspect ratio.
const MOOD_SPRITES = {
  idle: 'idle.png',
  greeting: 'greeting.png',
  water: 'water.png',
  stretch: 'stretch.png',
  break: 'break_happy.png',
  mood: 'mood.png',
  distraction: 'distraction.png',
  breakTime: 'break_happy.png',
  backToWork: 'back_to_work.png',
  goalComplete: 'goal_complete.png',
  wander: 'wander.png'
};

function spriteUrlForMood(mood) {
  const file = MOOD_SPRITES[mood] || MOOD_SPRITES.idle;
  return 'file://' + path.join(CAT_SPRITES_DIR, file).replace(/\\/g, '/');
}

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
  visitWorkArea: null, // the monitor's workArea locked in for the current visit, so it can't drift mid-visit if the cursor moves to another monitor
  currentBubbleText: null, // whatever the speech bubble is showing right now, if any; carried into chat so clicking mid-message doesn't lose it
  chatPinningPet: false, // true while chat is open, suppresses auto-leave
  pendingLeaveTimer: null,
  bubbleHideTimer: null
};

let visitTimerHandle = null;
let waterTimerHandle = null;
let stretchTimerHandle = null;
let wanderTimerHandle = null;
let summonDragStart = null; // { cursorX, cursorY, winX, winY }, set while the summon button is being dragged

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// Multi-monitor aware: the pet/chat/visits should show up on whichever
// monitor the summon button currently lives on (that's where the user put
// it), not always the OS's "primary" display.
function workArea() {
  const saved = store.load().summonButtonPos;
  if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
    return screen.getDisplayNearestPoint({ x: saved.x, y: saved.y }).workArea;
  }
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
}

// Resolves the monitor the user's active/focused window is actually on
// (falls back to cursor position when that can't be determined, e.g. on
// non-Windows platforms). Preferred over pure cursor position because the
// cursor can rest on another monitor (e.g. near the summon button) while the
// user is actively typing/working on a different one.
async function activeMonitorWorkArea() {
  const info = await activeWindow.getActiveWindowInfo();
  if (info && Number.isFinite(info.width) && info.width > 0 && Number.isFinite(info.height) && info.height > 0) {
    const center = { x: Math.round(info.x + info.width / 2), y: Math.round(info.y + info.height / 2) };
    return screen.getDisplayNearestPoint(center).workArea;
  }
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
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

  const step = () => {
    if (!win || win.isDestroyed()) return;
    const elapsed = Date.now() - start;
    const t = clamp(elapsed / duration, 0, 1);
    const e = easing(t);
    const x = Math.round(from.x + (to.x - from.x) * e);
    const y = Math.round(from.y + (to.y - from.y) * e);
    const width = Math.round(from.width + (to.width - from.width) * e);
    const height = Math.round(from.height + (to.height - from.height) * e);
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

function sendPetInit(mood) {
  if (!petWin || petWin.isDestroyed()) return;
  const settings = store.load();
  const dims = getPetDimensions(settings.petSize);
  petWin.webContents.send('pet:init', {
    spriteUrl: spriteUrlForMood(mood),
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

function bubbleSideAndBounds(wa, restX, windowWidth, windowHeight) {
  const fitsRight = restX + windowWidth + BUBBLE_GAP + BUBBLE_WIDTH + 16 <= wa.x + wa.width;
  const side = fitsRight ? 'right' : 'left';
  const grownWidth = windowWidth + BUBBLE_GAP + BUBBLE_WIDTH;
  let x = side === 'right' ? restX : restX - (BUBBLE_GAP + BUBBLE_WIDTH);

  // Clamp so the widened window always stays fully inside this monitor's
  // work area. Without this, on a narrow/secondary monitor (or with the pet
  // parked close to an edge) the window could extend past the display's
  // actual pixel space, that overflow is never rendered anywhere, which is
  // what made the bubble look cut off (only its corner/pointer still on-screen).
  const width = Math.min(grownWidth, wa.width);
  x = clamp(x, wa.x, wa.x + wa.width - width);

  return { side, bounds: { x, width } };
}

// Every kind of visit (scheduled or manually summoned) shows up on
// whichever monitor the user is actually looking at right now (their
// focused window's monitor), so the pet never appears on a screen you're
// not using.
async function resolveVisitWorkArea() {
  return activeMonitorWorkArea();
}

/**
 * Full visit sequence: walk on → (optional bubble) → walk off.
 * kind: 'auto' | 'water' | 'manual' | 'wander'
 */
async function runVisit(kind) {
  if (state.petVisible || state.petBusy) return;
  state.petBusy = true; // set synchronously so overlapping triggers can't slip in while we await below
  const settings = store.load();
  const win = ensurePetWindow();
  const dims = getPetDimensions(settings.petSize);
  const wa = await resolveVisitWorkArea();
  state.visitWorkArea = wa;

  state.petVisible = true;
  state.currentBubbleText = null;

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

  const showBubble = kind !== 'wander';
  const directCategories = ['water', 'stretch', 'distraction', 'breakTime', 'backToWork', 'goalComplete'];
  const category = kind === 'wander' ? 'wander' : (directCategories.includes(kind) ? kind : weightedRandomCategory());

  win.setBounds({ x: startX, y: restY, width: dims.windowWidth, height: dims.windowHeight });
  sendPetInit(category);
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

      if (showBubble) {
        const text = pickVisitMessage(category);
        state.currentBubbleText = text;
        const { side, bounds } = bubbleSideAndBounds(wa, restX, dims.windowWidth, dims.windowHeight);

        win.webContents.send('pet:command', { type: 'bubble-show', text, side });
        // Animate the widen-for-bubble bounds change in step with the CSS
        // fade-in (0.22s, see #bubble.visible in pet.css) instead of
        // snapping instantly, which made the character visibly hop sideways.
        animateBounds(
          win,
          { x: restX, y: restY, width: dims.windowWidth, height: dims.windowHeight },
          { x: bounds.x, y: restY, width: bounds.width, height: dims.windowHeight },
          220,
          easeInOutQuad,
          null,
          null
        );

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
  // Animate the shrink-back-to-just-the-pet bounds change in step with the
  // CSS fade-out (0.22s) instead of snapping instantly, which made the
  // character visibly hop sideways right as it disappears.
  const current = win.getBounds();
  animateBounds(
    win,
    current,
    { x: restX, y: restY, width: dims.windowWidth, height: dims.windowHeight },
    220,
    easeInOutQuad,
    null,
    () => setTimeout(() => leavePet(win, dims, restX, restY), 40)
  );
}

function leavePet(win, dims, restX, restY) {
  if (!win || win.isDestroyed()) return;
  if (state.chatPinningPet) return; // safety: never walk off while chat is open
  // Use the same monitor the visit started on, not wherever the cursor
  // happens to be now (it may have moved to another monitor mid-visit).
  const wa = state.visitWorkArea || workArea();
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
      state.visitWorkArea = null;
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

  const size = 56;
  const saved = store.load().summonButtonPos;
  // Clamp against the display the saved position actually belongs to, not
  // always the primary display, otherwise the button snaps back to monitor 1
  // on every restart whenever it was last placed on a second monitor.
  const wa = saved && typeof saved.x === 'number'
    ? screen.getDisplayNearestPoint({ x: saved.x, y: saved.y }).workArea
    : workArea();
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
  // Clamp to whichever monitor (x, y) is currently over, so dragging the
  // button across to a second monitor actually sticks there.
  const wa = screen.getDisplayNearestPoint({ x, y }).workArea;
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
      // Position relative to the monitor the pet actually walked onto for
      // this visit (may differ from the summon button's monitor if this
      // was an automatic visit), falling back to the general helper.
      const wa = state.visitWorkArea || workArea();
      const fitsRight = restX + dims.windowWidth + 14 + chatWidth <= wa.x + wa.width;
      const x = fitsRight ? restX + dims.windowWidth + 14 : Math.max(wa.x, restX - chatWidth - 14);
      // Anchor the top of the chat panel level with the pet's head (restY),
      // not its feet, so it opens upward beside the head instead of hovering
      // low around the feet.
      const y = clamp(restY, wa.y, wa.y + wa.height - chatHeight);

      chatWin = new BrowserWindow({
        width: chatWidth,
        height: chatHeight,
        x,
        y,
        show: false,
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
        // If the pet's speech bubble was still showing something when it was
        // clicked, carry that exact message into chat instead of losing it,
        // so the user still gets to read it, just now inside the chat panel.
        const greeting = state.currentBubbleText || personality.greetingWhenChatOpens || "Hi! What's up?";
        state.currentBubbleText = null;
        chatWin.webContents.send('chat:init', {
          greeting,
          aiMode: !!store.load().aiChatEnabled
        });
        // Only reveal the window once its content is ready to paint, so it
        // never flashes blank/default-positioned for a frame first.
        if (chatWin && !chatWin.isDestroyed()) chatWin.showInactive();
      });

      chatWin.on('closed', () => {
        chatWin = null;
        chatHistory = [];
        unpinPetAfterChat();
      });
    };

    // The speech bubble may still be showing, which widens the pet window
    // past its base size. Collapse it back first so the chat window doesn't
    // open on top of the still-expanded pet/bubble. Animated (rather than an
    // instant setBounds) so the character doesn't visibly hop sideways.
    if (petWin && !petWin.isDestroyed() && state.restBounds) {
      petWin.webContents.send('pet:command', { type: 'bubble-hide' });
      const current = petWin.getBounds();
      animateBounds(
        petWin,
        current,
        { x: restX, y: restY, width: dims.windowWidth, height: dims.windowHeight },
        220,
        easeInOutQuad,
        null,
        createChatWindow
      );
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

function scheduleNextStretch() {
  if (stretchTimerHandle) clearTimeout(stretchTimerHandle);
  const minutes = Number(store.load().stretchReminderMinutes) || 30;
  const base = minutes * 60 * 1000;
  const jitter = base * 0.1;
  const delay = base + randomBetween(-jitter, jitter);
  stretchTimerHandle = setTimeout(() => {
    if (!isAutoSuppressed()) {
      runVisit('stretch');
    }
    scheduleNextStretch();
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
// Study goal / pomodoro session
// ---------------------------------------------------------------------------

let distractionCheckHandle = null;
let lastDistractionNagAt = 0;
const DISTRACTION_CHECK_MS = 20000;
const DISTRACTION_NAG_COOLDOWN_MS = 3 * 60 * 1000;

function startStudySession(overrides) {
  const settings = store.load();
  const cfg = { ...settings.studyGoal, ...(overrides || {}) };
  store.save({ studyGoal: cfg });
  studySession.start(cfg);
  if (!distractionCheckHandle) {
    distractionCheckHandle = setInterval(checkForDistraction, DISTRACTION_CHECK_MS);
  }
}

function stopStudySession() {
  studySession.stop();
  if (distractionCheckHandle) {
    clearInterval(distractionCheckHandle);
    distractionCheckHandle = null;
  }
}

// Only fires for apps/titles the user listed, so a false positive (e.g. a
// coincidental substring match) is on the user's own configured keywords.
async function checkForDistraction() {
  const status = studySession.getStatus();
  if (!status.active || status.phase !== 'work') return;
  if (isAutoSuppressed()) return;
  if (Date.now() - lastDistractionNagAt < DISTRACTION_NAG_COOLDOWN_MS) return;

  const info = await activeWindow.getActiveWindowInfo();
  if (!info) return;
  const keywords = (store.load().studyGoal.distractionKeywords || [])
    .map((k) => String(k).toLowerCase().trim())
    .filter(Boolean);
  if (!keywords.length) return;

  const haystack = `${info.processName || ''} ${info.title || ''}`.toLowerCase();
  if (!keywords.some((k) => haystack.includes(k))) return;

  lastDistractionNagAt = Date.now();
  runVisit('distraction');
}

studySession.on('phaseChange', ({ phase }) => {
  if (!isAutoSuppressed()) runVisit(phase === 'break' ? 'breakTime' : 'backToWork');
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('study:status', studySession.getStatus());
  }
});

studySession.on('stopped', () => {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('study:status', studySession.getStatus());
  }
});

studySession.on('completed', () => {
  if (!isAutoSuppressed()) runVisit('goalComplete');
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('study:status', studySession.getStatus());
  }
});

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

  // Coordinates come from screen.getCursorScreenPoint() (main process),
  // never from the renderer's MouseEvent.screenX/Y. On Windows, mixed-DPI
  // multi-monitor setups (e.g. laptop at 150% + external monitor at 100%)
  // report renderer screenX/Y in the wrong scale once the cursor is on a
  // different-scaled monitor than the window, which made dragging across
  // monitors jump to the wrong place or snap back. The main process's
  // screen module is DPI-consistent across all monitors, so we use it as
  // the single source of truth for the whole drag gesture.
  ipcMain.on('summon:drag', (event, { phase }) => {
    if (!summonWin || summonWin.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();

    if (phase === 'start') {
      const bounds = summonWin.getBounds();
      summonDragStart = { cursorX: cursor.x, cursorY: cursor.y, winX: bounds.x, winY: bounds.y };
      return;
    }
    if (!summonDragStart) return;

    const dx = cursor.x - summonDragStart.cursorX;
    const dy = cursor.y - summonDragStart.cursorY;
    const x = summonDragStart.winX + dx;
    const y = summonDragStart.winY + dy;

    if (phase === 'move') {
      summonWin.setBounds({ x: Math.round(x), y: Math.round(y), width: 56, height: 56 });
    } else if (phase === 'end') {
      const movedDistance = Math.abs(dx) + Math.abs(dy);
      if (movedDistance < 5) {
        // Barely moved, treat as a click rather than a drag: snap back to
        // the exact start position and trigger a summon instead.
        summonWin.setBounds({ x: summonDragStart.winX, y: summonDragStart.winY, width: 56, height: 56 });
        triggerManualSummon();
      } else {
        const clamped = clampSummonToScreen(x, y);
        summonWin.setBounds({ x: clamped.x, y: clamped.y, width: 56, height: 56 });
        store.save({ summonButtonPos: clamped });
      }
      summonDragStart = null;
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
          const reply = await ai.chat(key, chatHistory, { baseUrl: settings.aiBaseUrl, model: settings.aiModel });
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
    if (Object.prototype.hasOwnProperty.call(partial, 'stretchReminderMinutes')) {
      scheduleNextStretch();
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

  ipcMain.handle('study:start', (event, cfg) => {
    startStudySession(cfg);
    return studySession.getStatus();
  });

  ipcMain.handle('study:stop', () => {
    stopStudySession();
    return studySession.getStatus();
  });

  ipcMain.handle('study:getStatus', () => studySession.getStatus());
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

/** Resets the summon button to a sane default position and brings the pet
 * on screen. Triggered by the "bring pet on screen" recovery launcher. */
function bringOnScreen() {
  // Use whichever monitor the mouse is on right now, this is a recovery
  // action so the old saved (possibly off-screen/wrong-monitor) position
  // must not be trusted.
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
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
    activeWindow.warmUp();

    scheduleNextVisit();
    scheduleNextWater();
    scheduleNextStretch();
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
    if (stretchTimerHandle) clearTimeout(stretchTimerHandle);
    if (wanderTimerHandle) clearTimeout(wanderTimerHandle);
    if (state.bubbleHideTimer) clearTimeout(state.bubbleHideTimer);
    stopStudySession();
    activeWindow.shutdown();
  });
}
