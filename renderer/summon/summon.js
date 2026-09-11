const btn = document.getElementById('btn');
const icon = document.getElementById('icon');

let dragging = false;

window.api.summon.onInit((data) => {
  icon.src = data.iconUrl;
});

// Only report drag phases, never our own screen coordinates. The main
// process reads the cursor position itself (screen.getCursorScreenPoint())
// and decides click-vs-drag, since MouseEvent.screenX/Y here can be
// reported in the wrong DPI scale when dragging across monitors that use
// different scaling percentages, which used to make the button snap to the
// wrong spot or refuse to leave the primary monitor.
btn.addEventListener('mousedown', () => {
  dragging = true;
  window.api.summon.drag({ phase: 'start' });
});

window.addEventListener('mousemove', () => {
  if (!dragging) return;
  window.api.summon.drag({ phase: 'move' });
});

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  window.api.summon.drag({ phase: 'end' });
});
