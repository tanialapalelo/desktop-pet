// lib/petSizes.js
// Shared sizing math so main.js (window bounds) and the renderer (CSS) agree.

const SPRITE_ASPECT = 331 / 422; // width / height of assets/sprites/cat/*.png (all share this canvas)

const SIZE_MULTIPLIER = {
  small: 0.72,
  medium: 1.0,
  large: 1.34
};

const BASE_SPRITE_HEIGHT = 190; // px, at "medium"
const BUBBLE_WIDTH = 210;
const BUBBLE_HEIGHT = 96;
const BUBBLE_GAP = 14;

function getPetDimensions(petSize) {
  const mult = SIZE_MULTIPLIER[petSize] || SIZE_MULTIPLIER.medium;
  const spriteHeight = Math.round(BASE_SPRITE_HEIGHT * mult);
  const spriteWidth = Math.round(spriteHeight * SPRITE_ASPECT);

  // Window is slightly larger than the sprite so bob/squash animation has room
  // without ever clipping. This padding is what keeps the silhouette from
  // ever looking like a "rectangular app window" even though technically the
  // OS window bounds are a rectangle (it's fully transparent outside the sprite).
  const windowWidth = Math.ceil(spriteWidth * 1.2);
  const windowHeight = Math.ceil(spriteHeight * 1.18);

  return { spriteWidth, spriteHeight, windowWidth, windowHeight };
}

module.exports = {
  SPRITE_ASPECT,
  SIZE_MULTIPLIER,
  BUBBLE_WIDTH,
  BUBBLE_HEIGHT,
  BUBBLE_GAP,
  getPetDimensions
};
