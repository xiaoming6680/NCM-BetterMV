"""Pixel diff of two still folders from the bench (tools/bench/headless.ts stills): per image the largest and mean
difference (0-255) and the share of pixels off by more than 2 and 8 levels; with --heat, a heat map of each pair that
differs visibly, into the second folder's `diff/`.
    python tools/bench/diff.py dev/bench/stills/base dev/bench/stills/new [--heat]
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

a_dir, b_dir = Path(sys.argv[1]), Path(sys.argv[2])
heat = '--heat' in sys.argv
rows = []
for a in sorted(a_dir.glob('*.png')):
    b = b_dir / a.name
    if not b.exists():
        continue
    x = np.asarray(Image.open(a).convert('RGB'), dtype=np.int16)
    y = np.asarray(Image.open(b).convert('RGB'), dtype=np.int16)
    if x.shape != y.shape:
        rows.append((a.stem, 'size', x.shape, y.shape))
        continue
    d = np.abs(x - y).max(axis=2)
    rows.append((a.stem, int(d.max()), float(d.mean()), float((d > 2).mean() * 100), float((d > 8).mean() * 100)))
    if heat and (d > 8).mean() > 0.0005:
        out = b_dir / 'diff'
        out.mkdir(exist_ok=True)
        h = np.clip(d * 8, 0, 255).astype(np.uint8)
        Image.fromarray(np.stack([h, h // 3, 255 - h], axis=2)).save(out / a.name)
print(f"{'still':28} {'max':>4} {'mean':>7} {'>2 %':>7} {'>8 %':>7}")
for r in rows:
    if r[1] == 'size':
        print(f'{r[0]:28} size {r[2]} vs {r[3]}')
    else:
        print(f'{r[0]:28} {r[1]:4d} {r[2]:7.3f} {r[3]:7.3f} {r[4]:7.3f}')
