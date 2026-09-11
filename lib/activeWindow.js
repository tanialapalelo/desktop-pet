// lib/activeWindow.js
// Best-effort lookup of the foreground window (process name, title, screen
// bounds), so the pet can appear on the monitor the user is actually looking
// at (not just wherever the cursor last was) and so study sessions can tell
// what app is focused. Windows-only (uses user32.dll via a PowerShell
// helper process); everywhere else this resolves to null and callers fall
// back to cursor-based behavior.
//
// Implementation note: an earlier version spawned a brand new powershell.exe
// per query and compiled the Add-Type C# snippet every time. That compile
// alone reliably takes well over a second, so a short per-call timeout meant
// every single query silently timed out and resolved null. Instead we keep
// ONE powershell.exe process alive for the app's lifetime, compile Add-Type
// once, then send one request line per query over stdin and read back one
// JSON line per response over stdout.

const { spawn } = require('child_process');
const readline = require('readline');
const os = require('os');

const REQUEST_TIMEOUT_MS = 1500;
// The one-time Add-Type C# compile inside the helper process can take several
// seconds, so a request made before it's finished (e.g. the very first call
// right after app launch, if warmUp() wasn't called early enough) needs a much
// longer grace period than steady-state requests.
const COLD_START_TIMEOUT_MS = 8000;

const SERVER_SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class PetActiveWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
Write-Output "READY"
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    $hwnd = [PetActiveWin]::GetForegroundWindow()
    $rect = New-Object PetActiveWin+RECT
    [void][PetActiveWin]::GetWindowRect($hwnd, [ref]$rect)
    $procId = 0
    [void][PetActiveWin]::GetWindowThreadProcessId($hwnd, [ref]$procId)
    $sb = New-Object System.Text.StringBuilder 256
    [void][PetActiveWin]::GetWindowText($hwnd, $sb, 256)
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    $result = [PSCustomObject]@{
      processName = if ($proc) { $proc.ProcessName } else { $null }
      title = $sb.ToString()
      x = $rect.Left
      y = $rect.Top
      width = $rect.Right - $rect.Left
      height = $rect.Bottom - $rect.Top
    } | ConvertTo-Json -Compress
    [Console]::Out.WriteLine($result)
  } catch {
    [Console]::Out.WriteLine("null")
  }
}
`;

let proc = null;
let rl = null;
let ready = false;
// FIFO queue of pending resolvers, matched to stdout lines in order.
const pending = [];

function teardown() {
  ready = false;
  if (rl) {
    try { rl.close(); } catch (err) { /* ignore */ }
    rl = null;
  }
  if (proc) {
    try { proc.kill(); } catch (err) { /* ignore */ }
    proc = null;
  }
  while (pending.length) {
    const entry = pending.shift();
    clearTimeout(entry.timer);
    entry.resolve(null);
  }
}

function ensureProcess() {
  if (proc) return;

  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', '-'],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
  );
  proc = child;
  ready = false;

  child.stdin.write(SERVER_SCRIPT + '\n');

  rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!ready) {
      if (trimmed === 'READY') ready = true;
      return;
    }
    const entry = pending.shift();
    if (!entry) return;
    clearTimeout(entry.timer);
    if (!trimmed || trimmed === 'null') {
      entry.resolve(null);
      return;
    }
    try {
      entry.resolve(JSON.parse(trimmed));
    } catch (parseErr) {
      entry.resolve(null);
    }
  });

  child.stderr.on('data', () => { /* drain to avoid backpressure; ignored */ });
  child.on('error', teardown);
  child.on('exit', teardown);
}

/** Resolves to { processName, title, x, y, width, height } or null (unsupported
 * platform, or the lookup failed/timed out). Never rejects. */
function getActiveWindowInfo() {
  if (os.platform() !== 'win32') {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      ensureProcess();
    } catch (spawnErr) {
      resolve(null);
      return;
    }

    const entry = {
      resolve,
      timer: setTimeout(() => {
        // Drop this entry from the queue (it may still resolve late otherwise)
        // and tear down; the process may be stuck, respawn fresh next call.
        const idx = pending.indexOf(entry);
        if (idx !== -1) pending.splice(idx, 1);
        resolve(null);
      }, ready ? REQUEST_TIMEOUT_MS : COLD_START_TIMEOUT_MS)
    };
    pending.push(entry);

    try {
      proc.stdin.write('ping\n');
    } catch (writeErr) {
      const idx = pending.indexOf(entry);
      if (idx !== -1) pending.splice(idx, 1);
      clearTimeout(entry.timer);
      teardown();
      resolve(null);
    }
  });
}

/** Starts the helper PowerShell process ahead of time (e.g. at app launch),
 * so the ~4s Add-Type compile is already done by the time a real query
 * comes in. Safe to call multiple times; never rejects. */
function warmUp() {
  if (os.platform() !== 'win32') return;
  try {
    ensureProcess();
  } catch (err) {
    /* ignore, next getActiveWindowInfo() call will retry */
  }
}

function shutdown() {
  teardown();
}

module.exports = { getActiveWindowInfo, warmUp, shutdown };
