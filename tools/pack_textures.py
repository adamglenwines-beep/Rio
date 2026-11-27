#!/usr/bin/env python3
"""
Pack the texture sets listed in assets/textures/web/sets.json into small,
browser-friendly files the game loads into two GPU texture arrays:

  <key>_albedo_<size>.webp  colour (sRGB). AO (if the set has one) is baked in.
                            'grey' sets are desaturated and normalised so the
                            game can tint them (one plaster texture → every pastel).
                            'greyish' sets are toned two-thirds of the way to grey.
  <key>_data_<size>.webp    linear data: R,G = normal map X,Y (OpenGL), B = roughness.
                            (The normal's Z is rebuilt in the shader.)

Also writes manifest.json (layer order, scales, mean colours, byte sizes).
Run from the repo root:  python3 tools/pack_textures.py
"""
import json, os
from PIL import Image, ImageOps, ImageStat, ImageChops

ROOT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'textures')
WEB = os.path.join(ROOT, 'web')
spec = json.load(open(os.path.join(WEB, 'sets.json')))

def load(set_, kind, mode):
    p = os.path.join(ROOT, set_, f'{set_}_{kind}.jpg')
    return Image.open(p).convert(mode) if os.path.exists(p) else None

manifest = {'sizes': spec['sizes'], 'layers': []}
for L in spec['layers']:
    s = L['set']
    col = load(s, 'color', 'RGB'); nor = load(s, 'normal', 'RGB'); rough = load(s, 'roughness', 'L'); ao = load(s, 'ao', 'L')
    assert col and nor and rough, f'missing maps for {s}'
    if ao:   # bake ambient occlusion into the colour, gently
        ao = ao.resize(col.size).point(lambda v: int(255 * (0.35 + 0.65 * (v / 255) ** 0.7)))
        r, g, b = col.split()
        col = Image.merge('RGB', [ImageChops.multiply(ch, ao) for ch in (r, g, b)])
    if L['tone'] == 'grey':
        g = ImageOps.grayscale(col)
        mean = ImageStat.Stat(g).mean[0]
        g = g.point(lambda v: max(0, min(255, int(v * 178 / mean))))   # mean → 0.7
        col = Image.merge('RGB', (g, g, g))
    elif L['tone'] == 'greyish':
        g = ImageOps.grayscale(col).convert('RGB')
        col = Image.blend(col, g, 0.66)
    mean_rgb = [round(v / 255, 3) for v in ImageStat.Stat(col).mean]
    out = {**L, 'mean': mean_rgb, 'files': {}}
    for size in spec['sizes']:
        a = col.resize((size, size), Image.LANCZOS)
        nx, ny, _ = nor.resize((size, size), Image.LANCZOS).split()
        d = Image.merge('RGB', (nx, ny, rough.resize((size, size), Image.LANCZOS)))
        fa = f"{L['key']}_albedo_{size}.webp"; fd = f"{L['key']}_data_{size}.webp"
        a.save(os.path.join(WEB, fa), quality=86, method=6)
        d.save(os.path.join(WEB, fd), quality=92, method=6)
        out['files'][size] = {'albedo': fa, 'data': fd,
                              'bytes': os.path.getsize(os.path.join(WEB, fa)) + os.path.getsize(os.path.join(WEB, fd))}
    manifest['layers'].append(out)
    print(f"{L['key']:13s} {s:24s} {out['files'][1024]['bytes']//1024:5d} KB @1024  {out['files'][512]['bytes']//1024:4d} KB @512")
json.dump(manifest, open(os.path.join(WEB, 'manifest.json'), 'w'), indent=1)
total = sum(l['files'][s]['bytes'] for l in manifest['layers'] for s in spec['sizes'])
print(f'total {total/1e6:.1f} MB')
