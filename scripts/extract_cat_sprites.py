"""
One-off asset prep script: slices the 4x3 "cat with various expressions"
mockup grid into individual sprites, color-keys the flat background to
transparency, and pads every cell onto one shared canvas (same width/height
for all 12) so switching expression sprites in the app never changes the
window's aspect ratio.

Grid cell boundaries are auto-detected (by finding background-only gutter
rows/columns) instead of assumed to be perfectly even, because several
poses (raised paws, wide ears) extend closer to the true cell edges than
others and a naive equal-width split truncated them.

Not wired into the app / build, run manually with:
  python scripts/extract_cat_sprites.py
"""
import os
import numpy as np
from PIL import Image

SRC = os.path.join(os.path.dirname(__file__), '..', 'pilihan asset',
                    'vecteezy_set-of-costume-cat-with-various-expressions_7534486.jpg')
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'assets', 'sprites', 'cat')
COLS, ROWS = 4, 3
BG_TOLERANCE = 36  # per-channel tolerance for the flat yellow bg
GUTTER_FRAC = 0.995  # a row/col counts as "pure gutter" if this fraction of its pixels are bg
MIN_BAND_PX = 60  # ignore spurious bands narrower than this (noise/antialiasing)
CANVAS_PAD = 14  # transparent breathing room around the tightest content bbox
BOTTOM_PAD = 6  # extra bit of floor room so feet don't touch the canvas edge

os.makedirs(OUT_DIR, exist_ok=True)

im = Image.open(SRC).convert('RGB')
arr = np.array(im).astype(int)
h, w, _ = arr.shape
bg = arr[2, 2]
print('image size', (w, h), 'bg sample', tuple(bg))

diff = np.abs(arr - bg).sum(axis=2)
is_bg = diff <= BG_TOLERANCE * 3


def find_content_bands(frac, min_band):
    bands = []
    in_band = False
    start = 0
    n = len(frac)
    for i in range(n):
        empty = frac[i] > GUTTER_FRAC
        if not empty and not in_band:
            in_band, start = True, i
        elif empty and in_band:
            in_band = False
            if i - start >= min_band:
                bands.append((start, i))
    if in_band and n - start >= min_band:
        bands.append((start, n))
    return bands


col_bands = find_content_bands(is_bg.mean(axis=0), MIN_BAND_PX)
row_bands = find_content_bands(is_bg.mean(axis=1), MIN_BAND_PX)
print('detected column bands', col_bands)
print('detected row bands', row_bands)
assert len(col_bands) == COLS, f'expected {COLS} column bands, found {len(col_bands)}'
assert len(row_bands) == ROWS, f'expected {ROWS} row bands, found {len(row_bands)}'


def key_out_bg(cell_rgb):
    cell_rgba = cell_rgb.convert('RGBA')
    pixels = cell_rgba.load()
    cw, ch = cell_rgba.size
    for y in range(ch):
        for x in range(cw):
            r, g, b, a = pixels[x, y]
            if abs(r - bg[0]) <= BG_TOLERANCE and abs(g - bg[1]) <= BG_TOLERANCE and abs(b - bg[2]) <= BG_TOLERANCE:
                pixels[x, y] = (r, g, b, 0)
    return cell_rgba


# Small outward slack so the detected band edge (which sits right at the
# gutter) doesn't clip anti-aliased pixels right at the true content edge.
EDGE_SLACK = 8

trimmed_cells = []
for (rt, rb) in row_bands:
    for (cl, cr) in col_bands:
        box = (
            max(0, cl - EDGE_SLACK), max(0, rt - EDGE_SLACK),
            min(w, cr + EDGE_SLACK), min(h, rb + EDGE_SLACK)
        )
        cell = im.crop(box)
        keyed = key_out_bg(cell)
        bbox = keyed.getbbox()
        trimmed = keyed.crop(bbox) if bbox else keyed
        trimmed_cells.append(trimmed)

max_w = max(c.size[0] for c in trimmed_cells) + CANVAS_PAD * 2
max_h = max(c.size[1] for c in trimmed_cells) + CANVAS_PAD * 2 + BOTTOM_PAD
print('shared output canvas size', (max_w, max_h))

names = [
    'greeting',      # row1 col1: peace-sign happy
    'break_happy',   # row1 col2: winking thumbs-up
    'idle',          # row1 col3: plain smile (default)
    'mood',          # row1 col4: blush wink + heart hand
    'distraction',   # row2 col1: angry, arms crossed, fangs
    'back_to_work',  # row2 col2: fierce/determined angry
    'stretch',       # row2 col3: worried/sore
    'wander',        # row2 col4: surprised + cheerful, hands up
    'tired',         # row3 col1: x-eyes / fainted (spare, unused for now)
    'water',         # row3 col2: pleading/open-mouth hands up
    'goal_complete',  # row3 col3: content, holding heart
    'love',          # row3 col4: heart eyes (spare, unused for now)
]

for name, cell in zip(names, trimmed_cells):
    canvas = Image.new('RGBA', (max_w, max_h), (0, 0, 0, 0))
    cw, ch = cell.size
    x = (max_w - cw) // 2
    y = max_h - BOTTOM_PAD - ch  # bottom-align so every pose's feet share one baseline
    canvas.paste(cell, (x, y), cell)
    canvas.save(os.path.join(OUT_DIR, f'{name}.png'))

print('wrote', len(names), 'sprites to', OUT_DIR)

