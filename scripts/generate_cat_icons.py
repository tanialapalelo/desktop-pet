"""
One-off asset prep script: generates the tray / summon-button / app icons
from one of the cat expression sprites (assets/sprites/cat/greeting.png),
replacing the old (non-cat) character icons.

Not wired into the app / build, run manually with:
  python scripts/generate_cat_icons.py
"""
import os
from PIL import Image

SPRITE = os.path.join(os.path.dirname(__file__), '..', 'assets', 'sprites', 'cat', 'greeting.png')
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'assets', 'icons')
PAD_FRAC = 0.06  # a little transparent breathing room around the character in the square canvas

im = Image.open(SPRITE).convert('RGBA')
bbox = im.getbbox()
trimmed = im.crop(bbox) if bbox else im
tw, th = trimmed.size

side = max(tw, th)
side = int(side * (1 + PAD_FRAC * 2))
canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
canvas.paste(trimmed, ((side - tw) // 2, (side - th) // 2), trimmed)

targets = {
    'icon-16.png': 16,
    'icon-24.png': 24,
    'icon-32.png': 32,
    'icon-48.png': 48,
    'icon-64.png': 64,
    'icon-128.png': 128,
    'icon-256.png': 256,
    'icon-512.png': 512,
    'app-icon.png': 256,
    'tray-icon.png': 32,
    'summon-icon.png': 64,
}

for name, size in targets.items():
    resized = canvas.resize((size, size), Image.LANCZOS)
    resized.save(os.path.join(OUT_DIR, name))

print('wrote', len(targets), 'icons to', OUT_DIR, 'from square canvas', canvas.size)
