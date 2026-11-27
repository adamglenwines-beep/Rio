#!/usr/bin/env python3
"""Warm-wall lightness of a picture (a game screenshot or an art-target paint-over).

    python3 tools/measure_image.py image.png [x0,y0,x1,y1 as fractions of the picture]

Looks at warm-coloured pixels (hue 10-60 degrees, saturation > 0.2: the plaster
walls; in a crop of the town it also catches some terracotta roof and paving) and
prints the 5th / 10th / 50th / 90th / 95th percentiles of their HSL lightness, the
mean saturation, and how the hues split between red-orange, orange and yellow.
tools/measure_walls.cjs measures the game itself more exactly (it masks the walls);
this is for pictures, so the game and the paint-overs can be compared like for like.
"""
import sys
import numpy as np
from PIL import Image


def hsl(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(-1), rgb.min(-1)
    l = (mx + mn) / 2
    d = mx - mn
    s = np.where(d == 0, 0, d / np.where(l > 0.5, 2 - mx - mn, mx + mn + 1e-9))
    h = np.zeros_like(l)
    m = d > 0
    rc = m & (mx == r); gc = m & (mx == g) & ~rc; bc = m & ~rc & ~gc
    h[rc] = ((g - b)[rc] / d[rc]) % 6
    h[gc] = (b - r)[gc] / d[gc] + 2
    h[bc] = (r - g)[bc] / d[bc] + 4
    return h * 60, s, l


def measure(path, crop=None):
    im = np.asarray(Image.open(path).convert('RGB'), dtype=np.float64) / 255
    H, W = im.shape[:2]
    if crop:
        x0, y0, x1, y1 = crop
        im = im[int(y0 * H):int(y1 * H), int(x0 * W):int(x1 * W)]
    h, s, l = hsl(im)
    warm = (h >= 10) & (h <= 60) & (s > 0.2)
    L = l[warm] * 100
    p = lambda q: float(np.percentile(L, q))
    hw = h[warm]
    return {
        'warm share': round(float(warm.mean()), 3),
        'p5': round(p(5), 1), 'p10': round(p(10), 1), 'p50': round(p(50), 1), 'p90': round(p(90), 1), 'p95': round(p(95), 1),
        'mean saturation': round(float(s[warm].mean()), 3),
        'hue split (10-22 red-orange / 22-36 orange / 36-60 yellow)': [round(float(((hw >= a) & (hw < b)).mean()), 2) for a, b in [(10, 22), (22, 36), (36, 61)]],
    }


if __name__ == '__main__':
    crop = [float(v) for v in sys.argv[2].split(',')] if len(sys.argv) > 2 else None
    print(sys.argv[1], measure(sys.argv[1], crop))
