# 🌸 Desktop Pet

A tiny animated companion that lives on top of your screen, visits you every
few minutes, reminds you to drink water and take breaks, and can chat with
you — all running locally on your own computer.

---

## 1. One-time setup

You need **Node.js** installed (this is what runs the app). If you don't have
it already:

1. Go to **https://nodejs.org**
2. Download and install the **LTS** version (just click through the installer
   with default options)
3. Restart your computer if you just installed it for the first time

That's it — you only need to do this once.

## 2. Running the pet

- **Windows:** double-click `launch.bat`
- **Mac:** double-click `launch.command`
  - The first time, macOS may say the file is "from an unidentified
    developer." Right-click the file → **Open** → **Open** to allow it.

The first launch takes a minute to install dependencies. After that it
starts instantly. A small window will pop up briefly — that's normal, it
closes itself and your pet lives in the system tray / menu bar from then on.

You'll see:
- A little **summon button** near the bottom-right of your screen (drag it
  anywhere you like — it'll always stay on screen)
- A **tray icon** (bottom-right on Windows, top menu bar on Mac) with a right
  -click menu: Summon Pet, Chat, Settings, Pause Pet, Quit

The pet itself stays hidden until it's time for a visit (or you summon it),
which keeps things light on your computer's resources.

## 3. Using it

- **Every 5 minutes by default**, the pet walks onto your screen, says a
  quick friendly message in a speech bubble, and leaves again after 10–30
  seconds. Change this in Settings.
- **Click the summon button** (or the tray's "Summon Pet") to bring it out
  any time.
- **Click the pet itself** to open a small chat box beside it.
- **Water reminders** run on their own separate timer — change the frequency
  in Settings.
- **Pause Pet** (tray menu) lets you pause for 30 minutes, 1 hour, or until
  tomorrow. Manually summoning the pet still works while paused.
- **Settings** (tray menu) covers visit/water frequency, check-ins, sound,
  animation speed, pet size, AI chat + API key, launch-at-startup,
  always-on-top, and quiet hours.

### If the pet or summon button ever disappears off-screen

(For example, after unplugging a second monitor.) Double-click:

- **Windows:** `bring-pet-on-screen.bat`
- **Mac:** `bring-pet-on-screen.command`

This snaps the summon button back to the bottom-right corner and brings the
pet on screen. If the app is already running, it just pops back into view —
it won't open a second copy.

## 4. Chat modes

**Basic mode** (default) works completely offline with a set of built-in,
friendly canned responses — no setup needed.

**AI mode** uses OpenAI's API for more natural conversation:

1. Get an API key from https://platform.openai.com/api-keys
2. Open **Settings** → paste the key under "OpenAI API key" → **Save key**
3. Turn on **AI chat mode**

The key is encrypted using your operating system's own secure storage
(Keychain on Mac, Credential Manager on Windows, or the system keyring on
Linux) — it's never written to disk in plain text, and never hard-coded
anywhere in this project. If AI mode has a problem (no internet, invalid
key, etc.), the pet automatically falls back to basic mode for that message
so the chat never just breaks.

The pet's personality lives in a plain text file you can edit any time:
`config/personality.json`. The visit messages and offline chat replies live
in `config/messages.json`. Edit either file and restart the app to see your
changes — no coding required.

## 5. Replacing or adding sprite frames later

Right now the pet is animated purely with code (bobbing, squashing,
blinking, walking bounce, flipping) from a single image:
`assets/sprites/pet.png`. If you want to swap in a different single image,
just replace that file (keep the same filename) — the app will scale and
crop-pad it automatically.

If you'd like to move to real multi-frame sprite animation later (e.g. an
actual walk cycle or blink frames), the animation logic is centralized in:
- `renderer/pet/pet.js` — the state machine sending walk/idle/bubble commands
- `renderer/pet/pet.css` — the CSS transforms driving the current animations
- `lib/petSizes.js` — sizing math shared between the main process and CSS

Swapping `<img id="sprite">` for a small animated sprite-sheet component in
`pet.js` is the natural next step, and everything else (window movement,
scheduling, bubble logic) will keep working unchanged.

## 6. Project structure

```
desktop-pet/
  main.js                 Electron main process — windows, scheduling, tray, IPC
  preload.js               Safe bridge exposing window.api to each renderer
  store.js                 Local JSON settings persistence
  lib/
    basicChat.js            Offline chat reply engine
    ai.js                    OpenAI API call for AI chat mode
    petSizes.js              Shared sizing constants
  config/
    personality.json         Editable AI personality/system prompt
    messages.json             Editable visit messages + offline chat replies
  renderer/
    pet/                      The transparent always-on-top pet window
    summon/                   The draggable summon button window
    chat/                     The compact chat window
    settings/                 The settings screen
  assets/
    sprites/pet.png            Your pet's cutout artwork (background removed)
    icons/                     Tray / summon button / app icons
    sounds/chime.wav            Small notification chime
  launch.bat / launch.command                  Everyday launcher
  bring-pet-on-screen.bat / .command            Recovery launcher
```

## 7. Notes on how it behaves under the hood

- The pet window is **transparent and frameless** — only the character (and,
  briefly, its speech bubble) is ever visible; there's no rectangular app
  window to see.
- It's also **click-through** outside of the character itself, so it never
  blocks clicks to your desktop or other apps — only hovering directly over
  the character re-enables clicks (to open chat).
- The pet is **hidden** (not just invisible, but not rendering) whenever
  it's not actively visiting, which keeps CPU usage effectively at zero in
  the background.
- Settings, reminder timing, pet size, summon button position, and quiet
  hours are all saved locally to a small JSON file in your OS's standard app
  data folder. Chat conversation history is intentionally **not** saved — it
  resets each time you reopen the chat window.

## 8. Optional: packaging as a real .exe / .app

This project runs great with just `npm start`. If you later want a proper
installer (double-click `.exe`/`.app` icon, no Node.js required for the
person using it), you can add
[`electron-builder`](https://www.electron.build/) as a dev dependency and
run its build command — that's a separate, optional step and isn't needed
for everyday personal use.

## 9. Troubleshooting

- **"node" is not recognized / command not found** → Node.js isn't
  installed, or you need to restart your computer after installing it.
- **npm install fails** → check your internet connection and try running
  the launcher again; delete the `node_modules` folder and retry if it gets
  stuck partway.
- **Pet or button missing** → use `bring-pet-on-screen.bat` /
  `.command` (see section 3).
- **Nothing happens when double-clicking on Mac** → right-click the file →
  **Open** the first time, to get past Gatekeeper's "unidentified
  developer" warning.
