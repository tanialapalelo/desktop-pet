# 🌸 Desktop Pet

A tiny animated pixel-art companion that lives on top of your screen. It
walks on-screen every few minutes to check in on you, reminds you to drink
water, wanders around when it feels like it, and can chat with you (offline
by default, or with a real LLM behind an OpenAI key). Everything runs
locally on your own machine: no server, no telemetry, no account.

<p align="center">
  <img src="assets/sprites/pet.png" alt="Desktop Pet character" width="160" />
</p>

Add a GIF or screenshot of the pet walking on screen and the chat bubble
here before sharing this repo. It's the single best thing to lead with.

---

## Table of contents

- [Features](#features)
- [Technical highlights](#technical-highlights)
- [Quick start](#quick-start)
- [Using it](#using-it)
- [Chat modes](#chat-modes)
- [Packaging it as a standalone .exe/.app](#packaging-it-as-a-standalone-exeapp)
- [Customization](#customization)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)

---

## Features

- **Scheduled visits.** Walks in from off-screen on a timer, says a short
  friendly line in a speech bubble, then walks back off. Frequency,
  check-ins, and quiet hours are all configurable.
- **Water/break reminders** on their own independent timer.
- **Idle wandering.** Occasionally pops out just to fidget around and
  leave, no message, just personality.
- **Chat.** Click the character to open a small chat window beside it.
  Works fully offline with built-in canned replies, or can be switched to
  real AI conversation (OpenAI) with one toggle.
- **Multi-monitor aware.** Visits and drag-to-reposition both track
  whichever monitor you're actually using, including mixed-DPI setups
  (a 150%-scaled laptop screen next to a 100% external monitor, for
  example).
- **True desktop overlay.** The window is transparent, frameless, and
  click-through outside of the character itself, so it never blocks
  clicks to your desktop or other apps.
- **Privacy-respecting.** Everything (settings, chat) is local. If you
  turn on AI chat, your API key is encrypted at rest using your OS's own
  secure storage (Keychain, Credential Manager, or libsecret), never
  stored in plain text.
- **Fully configurable without touching code.** Pet size, animation
  speed, sound, always-on-top, visit frequency, personality/system prompt,
  and every line the pet can say are all editable JSON/settings.
- **Packageable into a single .exe/.app.** No Node.js or terminal
  required for the person actually using it.

## Technical highlights

A few things that were the most interesting to build, if you're reading
this as a fellow dev.

**Frameless, transparent, click-through windows.** The pet lives in a
borderless, fully transparent `BrowserWindow` sized just around the
sprite. `setIgnoreMouseEvents()` is toggled on and off live based on
whether the cursor is actually over the opaque character, so the desktop
underneath stays fully clickable everywhere else.

**Window-bounds animation synced with CSS transitions.** Native OS
windows can't be animated with CSS, so walking/entering/leaving is driven
by a small hand-rolled tween loop in the main process (`animateBounds()`
in [main.js](main.js): easing plus `setBounds()` on a roughly 60fps
timer). Where the renderer also animates something with CSS (the speech
bubble fading in and out), the window-bounds tween is timed to match that
transition's duration and easing. Otherwise the two visibly fight each
other and the character appears to jump.

**Multi-monitor and mixed-DPI correctness.** Electron's `screen` module
gives DPI-consistent coordinates across all monitors, but a renderer's
`MouseEvent.screenX/Y` does not once dragging crosses onto a
differently-scaled monitor (a common Windows laptop plus external
monitor setup). Dragging the summon button is resolved entirely in the
main process using `screen.getCursorScreenPoint()` as the single source
of truth. The renderer only ever reports mouse-down/move/up phases.
Scheduled visits pick whichever monitor the cursor is currently on, so
the pet always shows up where you're actually looking.

**Offline-first chat with graceful AI fallback.** Chat defaults to a
small local reply engine, no network and no key needed. Turning on AI
mode calls OpenAI, and any failure (no internet, invalid key, rate limit)
transparently falls back to the offline engine for that message instead
of showing an error. The chat just never breaks.

**Secrets handled properly.** The OpenAI API key is encrypted with
Electron's `safeStorage` (backed by the OS keychain), never written to
disk in plain text or committed anywhere in config.

**Packaging.** Configured with `electron-builder` to produce a Windows
NSIS installer and a portable .exe (plus a .dmg/AppImage on other
platforms) directly from `npm run dist:win`.

## Quick start

You need Node.js installed once (this is what runs the app):

1. Go to **https://nodejs.org**, download and install the LTS version.
2. Restart your computer if you just installed it for the first time.

Then:

- **Windows:** double-click `launch.bat`
- **Mac:** double-click `launch.command` (the first time, right-click and
  choose Open to get past Gatekeeper's "unidentified developer" warning)

The first launch installs dependencies, which takes about a minute. After
that it starts instantly. A small window flashes briefly, that's normal,
then the pet lives in the system tray or menu bar.

You'll see:
- A little summon button near the bottom-right of your screen. Drag it
  anywhere, even onto a second monitor.
- A tray icon with a right-click menu: Summon Pet, Chat, Settings, Pause
  Pet, Quit.

The pet itself stays hidden (not just invisible, not rendering at all)
whenever it's not actively visiting, so it costs effectively zero CPU in
the background.

## Using it

- Every 5 minutes by default, the pet walks on-screen, says something,
  and leaves 10 to 30 seconds later. Change this in Settings.
- Click the summon button (or tray, "Summon Pet") to bring it out any
  time, or send it away early if it's already out.
- Click the pet itself to open the chat window.
- Water reminders run on their own separate timer (Settings).
- Pause Pet (tray menu) pauses for 30 minutes, 1 hour, or until tomorrow.
  Manual summon still works while paused.
- Settings covers visit/water frequency, check-ins, sound, animation
  speed, pet size, AI chat and API key, launch-at-startup, always-on-top,
  and quiet hours.

### If the pet or summon button ever disappears off-screen

Double-click the recovery launcher:

- **Windows:** `bring-pet-on-screen.bat`
- **Mac:** `bring-pet-on-screen.command`

It snaps the summon button back into view (on whichever monitor your
mouse is on) and brings the pet out. If the app is already running, it
just pops back into view instead of opening a second copy, since it's
single-instance locked.

## Chat modes

**Basic mode** (default) is fully offline, with canned but friendly
replies and zero setup.

**AI mode** gives you a real conversation via OpenAI's API:

1. Get an API key from https://platform.openai.com/api-keys
2. In Settings, paste it under "OpenAI API key" and click Save key
3. Turn on AI chat mode

The key is encrypted using your OS's own secure storage and never
touches disk in plain text. If AI mode fails for any reason, that
message quietly falls back to basic mode instead of erroring out.

The pet's personality and system prompt live in
[config/personality.json](config/personality.json). Visit messages and
offline chat replies live in [config/messages.json](config/messages.json).
Edit either and restart the app to see the change, no coding required.

## Packaging it as a standalone .exe/.app

No Node.js, no terminal, no `launch.bat`, just a normal
double-click-to-run app:

```
npm install
npm run dist:win
```

Look in the generated `dist/` folder for:

- `Desktop Pet Setup 1.0.0.exe`, a real installer with a Start
  Menu/Desktop shortcut that installs to `%LOCALAPPDATA%`.
- `Desktop Pet 1.0.0.exe`, a portable single file with no install step.

`npm run dist` builds a .dmg or AppImage on Mac/Linux the same way.

## Customization

**Swap the character art.** Replace `assets/sprites/pet.png` (keep the
same filename) and the app scales and pads it automatically. All
current animation (bob, squash, walk bounce, blink, flip) is pure
CSS/JS driven off that single image.

**Move to a real sprite sheet or frame-by-frame animation later.** The
animation logic is centralized in [renderer/pet/pet.js](renderer/pet/pet.js)
(the state machine for walk/idle/bubble commands),
[renderer/pet/pet.css](renderer/pet/pet.css) (the current CSS
transforms), and [lib/petSizes.js](lib/petSizes.js) (sizing math shared
between the main process and CSS). Swapping the `<img id="sprite">` for
an animated component is the natural next step, and everything else
keeps working unchanged.

**Change what it says or how it talks.**
[config/messages.json](config/messages.json) and
[config/personality.json](config/personality.json), see above.

## Project structure

```
desktop-pet/
  main.js                  Electron main process: windows, scheduling, tray, IPC
  preload.js                Safe bridge exposing window.api to each renderer
  store.js                  Local JSON settings persistence
  lib/
    basicChat.js             Offline chat reply engine
    ai.js                     OpenAI API call for AI chat mode
    petSizes.js               Shared sizing constants
  config/
    personality.json          Editable AI personality/system prompt
    messages.json              Editable visit messages + offline chat replies
  renderer/
    pet/                       The transparent always-on-top pet window
    summon/                    The draggable summon button window
    chat/                      The compact chat window
    settings/                  The settings screen
  assets/
    sprites/pet.png             Pet artwork (background removed)
    icons/                      Tray / summon button / app icons
    sounds/chime.wav             Small notification chime
  launch.bat / launch.command                   Everyday launcher
  bring-pet-on-screen.bat / .command             Recovery launcher
```

### How it behaves under the hood

- The pet window is transparent and frameless. Only the character (and
  briefly its speech bubble) is ever visible; there's no rectangular app
  window.
- It's click-through outside the character, so it never blocks clicks to
  the desktop or other apps.
- It's hidden entirely, not just invisible, whenever it's not actively
  visiting, which keeps background CPU usage effectively zero.
- Settings, reminder timing, pet size, summon button position, and quiet
  hours are saved locally in your OS's standard app data folder. Chat
  history is intentionally not saved; it resets each time you reopen the
  chat window.

## Troubleshooting

- **"node" is not recognized / command not found.** Node.js isn't
  installed, or you need to restart your computer after installing it.
- **npm install fails.** Check your internet connection, and delete
  `node_modules` and retry if it gets stuck partway.
- **Pet or button missing.** Use `bring-pet-on-screen.bat`/`.command`.
- **Nothing happens double-clicking on Mac.** Right-click the file and
  choose Open the first time, to get past Gatekeeper's warning.

---

Built with Electron. Personal project, contributions and forks welcome.
