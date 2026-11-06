"""Builds plugin/preview.webp, the plugin store's animated thumbnail, from docs/images/hero.webp.

hero.webp holds four scenes of 2.6 s each (tools/readme-clips.ts). This keeps the middle of each, crops to the store
card's 2:1 and loops. Needs Pillow. Run from the repository root: python tools/store-preview.py
"""
from pathlib import Path

from PIL import Image, ImageSequence

SOURCE = Path("docs/images/hero.webp")
OUTPUT = Path("plugin/preview.webp")
SIZE = (520, 260)
SCENES = 4
KEEP_MS = 1200
QUALITY = 48

image = Image.open(SOURCE)
frames = [frame.convert("RGB").copy() for frame in ImageSequence.Iterator(image)]
frame_ms = image.info.get("duration") or 66
per_scene = len(frames) // SCENES
keep = round(KEEP_MS / frame_ms)
skip = (per_scene - keep) // 2

width, height = frames[0].size
crop_height = width * SIZE[1] // SIZE[0]
top = (height - crop_height) // 2
box = (0, top, width, top + crop_height)

picked = [
    frame.crop(box).resize(SIZE, Image.Resampling.LANCZOS)
    for scene in range(SCENES)
    for frame in frames[scene * per_scene + skip:scene * per_scene + skip + keep]
]
picked[0].save(
    OUTPUT,
    save_all=True,
    append_images=picked[1:],
    duration=frame_ms,
    loop=0,
    quality=QUALITY,
    method=6,
)
print(f"{OUTPUT}: {len(picked)} frames, {len(picked) * frame_ms / 1000:.1f} s, {OUTPUT.stat().st_size / 1024:.0f} KiB")
