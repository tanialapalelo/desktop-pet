#!/usr/bin/env python3
"""scripts/generate_icons.py

Rasterizes assets/sprites/cat/greeting.png into every PNG icon the app/build
needs (tray, summon button, app/installer icons at every size).

The big, app-facing icons (128/256/512/app-icon) keep the full sitting pose.
The small ones (16-64px, tray-icon, summon-icon) use a tight bust/face crop
instead of just shrinking the full body - fine facial detail doesn't survive
being shrunk that far, so a close crop keeps the icon readable.

Requires: Pillow (pip install pillow). Not wired into the app or build; run
manually with:
    python3 scripts/generate_icons.py
"""
import numpy as np
from PIL import Image
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets/sprites/cat/greeting.png"
ICON_DIR = ROOT / "assets/icons"

FACE_CROP_FRAC = 0.60  # fraction of the sprite's content height that is face/head
FULL_MARGIN = 0.05
FACE_MARGIN = 0.08

SIZES_FULL = {
    "icon-128.png": 128,
    "icon-256.png": 256,
    "icon-512.png": 512,
    "app-icon.png": 256,
}
SIZES_FACE = {
    "icon-16.png": 16,
    "icon-24.png": 24,
    "icon-32.png": 32,
    "icon-48.png": 48,
    "icon-64.png": 64,
    "tray-icon.png": 32,
    "summon-icon.png": 64,
}


def square_pad(im, margin_frac):
    w, h = im.size
    side = int(max(w, h) / (1 - 2 * margin_frac))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - w) // 2, (side - h) // 2), im)
    return canvas


def main():
    img = Image.open(SRC).convert("RGBA")

    full_square = square_pad(img, FULL_MARGIN)

    alpha = np.asarray(img)[..., 3]
    ys, xs = np.where(alpha > 8)
    top, bottom = ys.min(), ys.max()
    left, right = xs.min(), xs.max()
    content_h = bottom - top
    face_bottom = top + int(content_h * FACE_CROP_FRAC)
    face_crop = img.crop((left, top, right + 1, face_bottom))
    face_square = square_pad(face_crop, FACE_MARGIN)

    ICON_DIR.mkdir(parents=True, exist_ok=True)
    for name, size in SIZES_FULL.items():
        full_square.resize((size, size), Image.LANCZOS).save(ICON_DIR / name)
        print(f"wrote {name} ({size}x{size})")
    for name, size in SIZES_FACE.items():
        face_square.resize((size, size), Image.LANCZOS).save(ICON_DIR / name)
        print(f"wrote {name} ({size}x{size})")
    print("done")


if __name__ == "__main__":
    main()
