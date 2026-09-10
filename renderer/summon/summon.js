const btn = document.getElementById('btn');
const icon = document.getElementById('icon');

let winX = 0;
let winY = 0;
let dragging = false;
let startScreenX = 0;
let startScreenY = 0;
let startWinX = 0;
let startWinY = 0;
let moved = 0;

window.api.summon.onInit((data) => {
  icon.src = data.iconUrl;
  winX = data.x;
  winY = data.y;
});

btn.addEventListener('mousedown', (e) => {
  dragging = true;
  moved = 0;
  startScreenX = e.screenX;
  startScreenY = e.screenY;
  startWinX = winX;
  startWinY = winY;
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.screenX - startScreenX;
  const dy = e.screenY - startScreenY;
  moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
  const newX = startWinX + dx;
  const newY = startWinY + dy;
  window.api.summon.drag({ phase: 'move', x: newX, y: newY });
});

window.addEventListener('mouseup', (e) => {
  if (!dragging) return;
  dragging = false;
  const dx = e.screenX - startScreenX;
  const dy = e.screenY - startScreenY;
  const finalX = startWinX + dx;
  const finalY = startWinY + dy;

  if (moved < 5) {
    // treat as a click, not a drag
    winX = startWinX;
    winY = startWinY;
    window.api.summon.drag({ phase: 'end', x: startWinX, y: startWinY });
    window.api.summon.click();
  } else {
    winX = finalX;
    winY = finalY;
    window.api.summon.drag({ phase: 'end', x: finalX, y: finalY });
  }
});
