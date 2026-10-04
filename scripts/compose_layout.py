#!/usr/bin/env python3
"""版式对照：按 src/layout.js 的摆放规则把素材拼回长卷，与原画逐段上下对照。

输出 docs/compare-<段>.jpg：上为原画，下为素材按原位拼合的结果（无动画、无光照）。
用来检查每个人物是否落在原作同一个框里、遮挡次序是否与原作一致。
用法：python scripts/compose_layout.py [--scale 0.5]
"""
import argparse
import json
import os
import re

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = os.path.join(ROOT, 'img', 'caef76094b36acafac3550947dd98d1000e99c85.webp')
LAYOUT_JS = os.path.join(ROOT, 'src', 'layout.js')
ATLAS_JS = os.path.join(ROOT, 'src', 'figure-atlas.js')
SILK = (124, 88, 38)


def js_array(txt, name):
    start = txt.index(f'const {name} = [')
    body = txt[txt.index('[', start):]
    depth = 0
    for i, ch in enumerate(body):
        depth += ch == '['
        depth -= ch == ']'
        if depth == 0:
            body = body[:i + 1]
            break
    body = re.sub(r'/\*.*?\*/', '', body, flags=re.S)
    body = re.sub(r'([{,]\s*)(\w+)\s*:', r'\1"\2":', body)
    body = body.replace("'", '"')
    return json.loads(body)


def js_const(txt, name):
    return float(re.search(rf'const {name} = ([\d.]+)', txt).group(1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--scale', type=float, default=0.5)
    args = ap.parse_args()
    lt = open(LAYOUT_JS, encoding='utf-8').read()
    items = js_array(lt, 'ITEMS')
    origin, end, k = js_const(lt, 'ORIGIN'), js_const(lt, 'END'), js_const(lt, 'K')
    at = open(ATLAS_JS, encoding='utf-8').read()
    s0 = at.index('HX.figureAtlas = ') + len('HX.figureAtlas = ')
    atlas = json.loads(at[s0:at.index(';\n})', s0)])

    S = args.scale
    W, H = round((end - origin) * k * S), round(900 * S)
    canvas = Image.new('RGBA', (W, H), SILK + (255,))
    placed = []
    for it in items:
        if 'box' not in it or it['id'] not in atlas:
            continue
        m = atlas[it['id']]
        x0, y0, x1, y1 = it['box']
        c = m['content']
        s = (y1 - y0) * k / (c[3] - c[1]) * S
        cx = ((x0 + x1) / 2 - origin) * k * S
        foot = y1 * k * S
        placed.append((it.get('z', y1), it, m, s, cx, foot))
    for _, it, m, s, cx, foot in sorted(placed, key=lambda p: p[0]):
        sheet = Image.open(os.path.join(ROOT, m['src'])).convert('RGBA')
        body = sheet.crop((0, 0, m['w'], m['h']))
        for pn, p in m['parts'].items():
            sx, sy, pw, ph = p['src']
            body.alpha_composite(sheet.crop((sx, sy, sx + pw, sy + ph)), tuple(p['at']))
        c = m['content']
        img = body.resize((max(1, round(m['w'] * s)), max(1, round(m['h'] * s))), Image.LANCZOS)
        px = round(cx - ((c[0] + c[2]) / 2) * s)
        py = round(foot - c[3] * s)
        canvas.paste(img, (px, py), img)   # 底是不透明的绢色，按 alpha 贴上即等于合成

    orig = Image.open(ORIG).convert('RGB')
    o = orig.crop((int(origin), 0, int(end), 500)).resize((W, H), Image.LANCZOS)
    secs = [('listen', 8730, end), ('dance', 7760, 8730), ('rest', 6890, 7760),
            ('flute', 5300, 6890), ('farewell', origin, 5300)]
    for sid, a, b in secs:
        xa, xb = round((a - origin) * k * S), round((b - origin) * k * S)
        top = o.crop((xa, 0, xb, H))
        bot = canvas.crop((xa, 0, xb, H)).convert('RGB')
        out = Image.new('RGB', (xb - xa, H * 2 + 6), (30, 24, 20))
        out.paste(top, (0, 0))
        out.paste(bot, (0, H + 6))
        out.save(os.path.join(ROOT, 'docs', f'compare-{sid}.jpg'), quality=82)
        print(sid, out.size)


if __name__ == '__main__':
    main()
