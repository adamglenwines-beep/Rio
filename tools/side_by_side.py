#!/usr/bin/env python3
"""Put images side by side with a caption under each (for the before/after and target comparisons).

  python3 tools/side_by_side.py out.jpg "caption A=a.jpg" "caption B=b.png" [--height 720]
"""
import sys
from PIL import Image, ImageDraw, ImageFont

args = sys.argv[1:]
height = 720
if '--height' in args:
    i = args.index('--height'); height = int(args[i + 1]); del args[i:i + 2]
out, items = args[0], [a.split('=', 1) for a in args[1:]]
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
except OSError:
    font = ImageFont.load_default()
tiles = []
for caption, path in items:
    im = Image.open(path).convert('RGB')
    im = im.resize((round(im.width * height / im.height), height), Image.LANCZOS)
    tiles.append((caption, im))
gap, bar = 12, 40
W = sum(t[1].width for t in tiles) + gap * (len(tiles) - 1)
sheet = Image.new('RGB', (W, height + bar), '#f4efe6')
d = ImageDraw.Draw(sheet)
x = 0
for caption, im in tiles:
    sheet.paste(im, (x, 0))
    d.text((x + 8, height + 8), caption, fill='#3a332b', font=font)
    x += im.width + gap
sheet.save(out, quality=88)
print('saved', out, sheet.size)
