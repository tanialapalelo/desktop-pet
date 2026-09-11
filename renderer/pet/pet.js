const stage = document.getElementById('stage');
const figure = document.getElementById('pet-figure');
const sprite = document.getElementById('sprite');
const eyeLeft = document.getElementById('eye-left');
const eyeRight = document.getElementById('eye-right');
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
const chime = document.getElementById('chime');

let soundEnabled = true;
let blinkTimer = null;
let fidgetTimer = null;
let petFigureWidth = 0;
let bubbleGap = 14;

function scheduleBlink() {
  clearTimeout(blinkTimer);
  const delay = 2200 + Math.random() * 3600;
  blinkTimer = setTimeout(() => {
    eyeLeft.classList.remove('blinking');
    eyeRight.classList.remove('blinking');
    // force reflow so the animation can re-trigger
    void eyeLeft.offsetWidth;
    eyeLeft.classList.add('blinking');
    eyeRight.classList.add('blinking');
    scheduleBlink();
  }, delay);
}

function scheduleFidget() {
  clearTimeout(fidgetTimer);
  const delay = 3500 + Math.random() * 4500;
  fidgetTimer = setTimeout(() => {
    if (figure.classList.contains('walking')) {
      scheduleFidget();
      return;
    }
    figure.classList.remove('fidget');
    void figure.offsetWidth;
    figure.classList.add('fidget');
    scheduleFidget();
  }, delay);
}

function playChime() {
  if (!soundEnabled) return;
  try {
    chime.currentTime = 0;
    chime.play().catch(() => {});
  } catch (err) {
    /* ignore */
  }
}

function setDirection(dir) {
  stage.style.setProperty('--dir', dir);
  // when facing left (-1) mirror the sprite; container itself is not flipped,
  // only the sprite + eye overlays, so bubble layout stays correct.
}

window.api.pet.onInit((data) => {
  sprite.src = data.spriteUrl;
  chime.src = data.chimeUrl;
  soundEnabled = data.soundEnabled !== false;

  figure.style.width = data.spriteWidth + 'px';
  figure.style.height = data.spriteHeight + 'px';
  petFigureWidth = data.spriteWidth;
  bubbleGap = data.bubbleGap || 14;

  const speed = data.animationSpeedMultiplier || 1;
  figure.style.setProperty('--speed', speed);

  setDirection(data.direction || 1);

  bubble.classList.add('hidden');
  bubble.classList.remove('visible');

  scheduleBlink();
  scheduleFidget();
});

window.api.pet.onCommand((cmd) => {
  if (cmd.type === 'walk-start') {
    setDirection(cmd.direction);
    figure.classList.add('walking');
    figure.classList.remove('fidget');
  } else if (cmd.type === 'idle-start') {
    figure.classList.remove('walking');
    figure.classList.add('squash');
    setTimeout(() => figure.classList.remove('squash'), 260);
  } else if (cmd.type === 'bubble-show') {
    const isLeft = cmd.side === 'left';
    stage.classList.toggle('side-left', isLeft);
    stage.classList.toggle('side-right', !isLeft);
    // Anchor the bubble directly off the pet's own width instead of letting
    // flexbox distribute the space, that was silently collapsing this box.
    if (isLeft) {
      bubble.style.right = (petFigureWidth + bubbleGap) + 'px';
      bubble.style.left = 'auto';
    } else {
      bubble.style.left = (petFigureWidth + bubbleGap) + 'px';
      bubble.style.right = 'auto';
    }
    bubbleText.textContent = cmd.text;
    bubble.classList.remove('hidden');
    // small delay so the CSS transition actually plays
    requestAnimationFrame(() => requestAnimationFrame(() => bubble.classList.add('visible')));
    playChime();
  } else if (cmd.type === 'bubble-hide') {
    bubble.classList.remove('visible');
    setTimeout(() => bubble.classList.add('hidden'), 220);
  }
});

figure.addEventListener('mouseenter', () => window.api.pet.hover(true));
figure.addEventListener('mouseleave', () => window.api.pet.hover(false));
figure.addEventListener('click', () => window.api.pet.click());
