#!/usr/bin/env python3
"""站点图标：一方白文朱印「夜」。

朱色取页面的 --vermilion，隶书字填绢色；大尺寸带一点印泥不匀和边缘残损，
16/32 像素只留干净的方印与字，免得糊成一团。
输出 favicon.ico（16/32/48）、assets/icons/apple-touch-icon.png（180，铺满不透明）、
assets/icons/icon-192.png 与 icon-512.png。
用法：python scripts/build_icons.py
"""
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, 'assets', 'icons')
VERMILION = (158, 59, 46)
SILK = (231, 220, 196)
FONTS = ['STLITI.TTF', 'SIMLI.TTF', 'simkai.ttf']
CHAR = '夜'
SS = 4


def font(px):
    for name in FONTS:
        path = os.path.join(os.environ.get('WINDIR', 'C:/Windows'), 'Fonts', name)
        if os.path.exists(path):
            return ImageFont.truetype(path, px)
    raise SystemExit('找不到隶书或楷体字体')


def seal(size, worn, bleed=False):
    """worn: 0..1 残损程度；bleed: 印面铺满整张（主屏图标不能透明）。"""
    n = size * SS
    rng = np.random.default_rng(size)
    margin = 0 if bleed else round(n * (0.04 if size <= 32 else 0.06))
    radius = round(n * (0.0 if bleed else 0.08))

    face = Image.new('L', (n, n), 0)
    d = ImageDraw.Draw(face)
    d.rounded_rectangle([margin, margin, n - 1 - margin, n - 1 - margin], radius, fill=255)

    # 白文：字填绢色而不镂空，深色标签栏上也认得出
    inner = n - 2 * margin
    f = font(round(inner * (0.9 if size <= 32 else 0.84)))
    glyph = Image.new('L', (n, n), 0)
    gd = ImageDraw.Draw(glyph)
    x0, y0, x1, y1 = gd.textbbox((0, 0), CHAR, font=f)
    gd.text(((n - (x1 - x0)) / 2 - x0, (n - (y1 - y0)) / 2 - y0), CHAR, font=f, fill=255)
    if size <= 32:
        glyph = glyph.filter(ImageFilter.MaxFilter(SS + 1))  # 小图把笔画加粗一点
    a = np.array(face, np.float32) / 255
    ink = 1 - np.array(glyph, np.float32) / 255

    if worn > 0:
        # 边缘残损：越靠边越容易被低频噪声咬掉，缺口稀疏、形状不规则
        low = rng.normal(0, 1, (10, 10)).astype(np.float32)
        low = np.array(Image.fromarray(low).resize((n, n), Image.BICUBIC))
        fine = rng.normal(0, 1, (40, 40)).astype(np.float32)
        fine = np.array(Image.fromarray(fine).resize((n, n), Image.BICUBIC))
        yy, xx = np.mgrid[0:n, 0:n]
        edge = np.minimum.reduce([xx - margin, yy - margin, n - 1 - margin - xx, n - 1 - margin - yy])
        a[low + 0.35 * fine - edge / (n * 0.012) > 1.8 - 0.5 * worn] = 0
        # 印泥不匀：零星细孔
        speck = rng.random((n, n)) < 0.0005 * worn
        speck = np.array(Image.fromarray((speck * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5)))
        ink[speck > 0] *= 0.4

    tone = np.array(Image.new('RGB', (n, n), VERMILION), np.float32)
    if worn > 0:
        mott = rng.normal(0, 1, (8, 8)).astype(np.float32)
        mott = np.array(Image.fromarray(mott).resize((n, n), Image.BICUBIC))[..., None]
        tone = tone * (1 + 0.06 * worn * mott)
    k = ink[..., None]
    col = tone * k + np.array(SILK, np.float32) * (1 - k)
    rgb = Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)).resize((size, size), Image.LANCZOS)
    alpha = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).resize((size, size), Image.LANCZOS)

    if bleed:
        out = Image.new('RGB', (size, size), VERMILION)
        out.paste(rgb, (0, 0), alpha)
        return out
    out = rgb.convert('RGBA')
    out.putalpha(alpha)
    return out


def main():
    os.makedirs(ICONS, exist_ok=True)
    small = [seal(s, 0) for s in (16, 32)] + [seal(48, 0.4)]
    small[-1].save(os.path.join(ROOT, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)],
                   append_images=small[:-1])
    seal(180, 0.8, bleed=True).save(os.path.join(ICONS, 'apple-touch-icon.png'))
    seal(192, 0.8).save(os.path.join(ICONS, 'icon-192.png'))
    seal(512, 1).save(os.path.join(ICONS, 'icon-512.png'))
    print('favicon.ico, assets/icons/{apple-touch-icon,icon-192,icon-512}.png')


if __name__ == '__main__':
    main()
