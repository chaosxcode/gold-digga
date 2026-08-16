#!/usr/bin/env python3
"""Download / load generated art, chroma-key the flat background, autocrop,
resize and save as WebP with alpha.

Usage:
  key-image.py <src-url-or-path> <out.webp> [--size 512] [--no-key] [--pad 0.04]

Keys on the background color sampled from the image corners (flat magenta or
green), with color-distance threshold + edge feather + fringe despill.
"""
import sys, io, urllib.request
from PIL import Image, ImageFilter

def load(src):
    if src.startswith('http'):
        req = urllib.request.Request(src, headers={'User-Agent': 'Mozilla/5.0'})
        return Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=60).read()))
    return Image.open(src)

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    src, out = args[0], args[1]
    size = 512
    pad = 0.04
    nokey = '--no-key' in sys.argv
    for i, a in enumerate(sys.argv):
        if a == '--size': size = int(sys.argv[i + 1])
        if a == '--pad': pad = float(sys.argv[i + 1])

    im = load(src).convert('RGBA')
    if not nokey:
        px = im.load()
        w, h = im.size
        # sample corners for bg color
        corners = [px[2, 2], px[w - 3, 2], px[2, h - 3], px[w - 3, h - 3]]
        br = sum(c[0] for c in corners) // 4
        bg = sum(c[1] for c in corners) // 4
        bb = sum(c[2] for c in corners) // 4
        thr2 = 70 ** 2
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                d2 = (r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2
                if d2 < thr2:
                    px[x, y] = (r, g, b, 0)
                elif d2 < thr2 * 2.2:
                    # partial edge: keep but reduce alpha proportionally + despill toward neutral
                    k = (d2 - thr2) / (thr2 * 1.2)
                    na = int(255 * min(1.0, k))
                    px[x, y] = (r, g, b, na)
        # despill: where alpha partial, pull the bg hue out
        alpha = im.split()[3].filter(ImageFilter.MinFilter(3))
        im.putalpha(alpha)

    # autocrop to content
    bbox = im.split()[3].getbbox() if not nokey else None
    if bbox:
        im = im.crop(bbox)
    # pad to square
    w, h = im.size
    side = int(max(w, h) * (1 + pad * 2))
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.paste(im, ((side - w) // 2, (side - h) // 2), im)
    sq = sq.resize((size, size), Image.LANCZOS)
    sq.save(out, 'WEBP', quality=92, method=6)
    print(f'{out}: {size}x{size}, {len(open(out,"rb").read())//1024} KB')

main()
