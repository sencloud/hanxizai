#!/usr/bin/env python3
"""人物与陈设素材流水线：生成的白底工笔立绘 → 可演出的分层素材。

素材按原画（img/ 下的《韩熙载夜宴图》全卷）逐段对照生成：每个人物、每组陈设
都以原作同一位置的局部为参考图重画，朝向、衣色、姿态与原作一致，背景留白。
本脚本把这些白底图做成运行时可用的图层：

  1. 抠底：从四边泛洪，只去掉与画框连通的白底；被轮廓围住的纯白空洞另行判定。
     边缘按就近墨线亮度求覆盖率，并反解前景色，深色绢底上不留白边。
  2. 做旧：把生成图的纯白与高饱和压向原作的旧绢色调，并加一层极淡的绢纹颗粒，
     否则人物贴在褐色绢地上会像剪纸。
  3. 分件：一张图里有几个人（同一参考局部里并肩站立的宾客）时，按竖线切开，
     每人一份素材，方便在原位逐一摆放。
  4. 变体：同一张立绘按色相换衫色，得到另一位乐女（离线完成，运行时不再取像素）。
  5. 拆层：头部（按肤色自动定位）与 parts 多边形剪成独立图层；身体层在挖空处
     补底，部件转动时露出的是衣料而不是空洞。
  6. 矢量遮罩：外轮廓多边形，运行时用来命中测试、高亮描边与贴图未就绪时的剪影。
  7. 输出：assets/figures/<id>.webp（身体 + 部件横排的图集）与 src/figure-atlas.js
     （file:// 下也能直接加载的元数据）。

坐标一律写原图像素（720×1280 / 864×1152 / 1152×864 / 1280×720）。
用法：python scripts/build_figures.py [--debug] [--only a,b]
"""
import argparse
import json
import os
import zlib

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'assets', 'figures', 'raw')
OUT = os.path.join(ROOT, 'assets', 'figures')
DEBUG = os.path.join(ROOT, 'assets', 'figures', 'debug')
ATLAS_JS = os.path.join(ROOT, 'src', 'figure-atlas.js')

SCALE = 0.8          # 输出相对原图的缩放
PAD = 6

# 旧绢色调：生成图的纯白落到约 (226, 205, 166)，与原作泛黄的白衣相近
AGED_TONE = np.array([0.93, 0.85, 0.69], np.float32)
AGED_LIFT = 12.0
AGED_GRAIN = 3.2


# kind: fig 人物（会动）/ prop 陈设（静止）
# src: 原图文件名（默认与 id 相同）；crop: 只取原图的 [x0, x1) 竖条
# mirror: 生成图朝向与原作相反时左右翻转（在 crop 之后；parts/anchors 按翻转后的坐标写）
# head: 'auto' 按肤色定位并拆出头层；False 不拆（群像、舞者、手与乐器贴着脸）
# parts: 额外可动部件 {名: {poly, pivot}}
# anchors: 供烟、光与交互吸附的点（原图像素）；atlas_anchors: 同上，但直接写图集像素
# hue: 换色变体 [(h0, h1, s_min, 目标色相, 饱和系数)]，色相为 OpenCV 0..180
SPEC = {
    # 其一 · 听乐
    'l-bed':         dict(kind='prop'),
    'l-couch':       dict(kind='prop'),
    'l-tables':      dict(kind='prop', anchors={'ewer-a': (1040, 296), 'ewer-b': (1131, 286)}),
    'l-han':         dict(kind='fig', head='auto'),
    'l-langcan':     dict(kind='fig', head='auto'),
    'l-lady':        dict(kind='fig', head='auto'),
    'l-limei':       dict(kind='fig', head='auto', anchors={'bridge': (386, 470), 'nut': (648, 276)},
                          parts={'hand': dict(poly=[(306, 500), (340, 492), (396, 496), (432, 520),
                                                    (426, 542), (382, 556), (330, 568), (306, 562)],
                                              pivot=(312, 532))}),
    'l-guest-brown': dict(kind='fig', head='auto'),
    'l-guest-chair': dict(kind='fig', head='auto'),
    'l-man-1':       dict(kind='fig', head='auto', src='l-standers', crop=(190, 495)),
    'l-man-2':       dict(kind='fig', head='auto', src='l-standers', crop=(495, 772)),
    'l-man-3':       dict(kind='fig', head='auto', src='l-standers', crop=(772, 1090)),
    'l-pink':        dict(kind='fig', head='auto', src='l-women', crop=(250, 612)),
    'l-girl':        dict(kind='fig', head='auto', src='l-women', crop=(612, 940)),
    # 其二 · 观舞
    'd-drum':        dict(kind='prop', atlas_anchors={'skin': (240, 88)}),
    'd-han-drum':    dict(kind='fig', head='auto',
                          parts={'stick': dict(poly=[(78, 316), (316, 326), (318, 380), (236, 402),
                                                     (152, 404), (112, 382), (78, 352)],
                                               pivot=(176, 398))}),
    'd-man-stand':   dict(kind='fig', head='auto'),
    'd-youth':       dict(kind='fig', head='auto'),
    'd-langcan':     dict(kind='fig', head='auto'),
    'd-monk':        dict(kind='fig', head='auto'),
    'd-clapper':     dict(kind='fig', head='auto'),
    'd-dancer':      dict(kind='fig', head=False),
    'd-dancer-b':    dict(kind='fig', head=False),
    'd-clap-woman':  dict(kind='fig', head='auto'),
    # 其三 · 歇息
    'r-couch':       dict(kind='prop'),
    'r-bed':         dict(kind='prop'),
    'r-han':         dict(kind='fig', head='auto',
                          parts={'hands': dict(poly=[(518, 770), (560, 760), (600, 736), (642, 738),
                                                     (692, 774), (714, 800), (724, 842), (712, 872),
                                                     (668, 882), (660, 896), (600, 882), (540, 862),
                                                     (518, 830)],
                                               pivot=(530, 800))}),
    'r-women':       dict(kind='fig', head=False),
    'r-maid-front':  dict(kind='fig', head='auto', mirror=True),
    'r-pipa-girl':   dict(kind='fig', head=False),
    'r-tray-maid':   dict(kind='fig', head=False),
    # 其四 · 清吹
    'f-screen-pine': dict(kind='prop'),
    'f-woman-shawl': dict(kind='fig', head='auto'),
    'f-guest-stand': dict(kind='fig', head='auto', src='f-han-stand'),
    'f-clapper':     dict(kind='fig', head='auto'),
    'f-bili':        dict(kind='fig', head=False),
    'f-flute-1':     dict(kind='fig', head=False),
    'f-flute-2':     dict(kind='fig', head=False, src='f-flute-1',
                          hue=[(62, 98, 30, 104, 0.8)]),
    'f-flute-3':     dict(kind='fig', head=False),
    'f-flute-4':     dict(kind='fig', head=False, src='f-flute-3',
                          hue=[(0, 7, 110, 17, 0.55), (172, 180, 110, 17, 0.55)]),
    'f-lady':        dict(kind='fig', head='auto'),
    'f-han-fan':     dict(kind='fig', head='auto',
                          parts={'fan': dict(poly=[(188, 194), (338, 194), (338, 372), (302, 378),
                                                   (292, 462), (264, 462), (262, 378), (188, 370)],
                                             pivot=(280, 444))}),
    'f-maid-fan':    dict(kind='fig', head='auto'),
    'f-maid-back':   dict(kind='fig', head='auto'),
    # 其五 · 送别
    'b-couple':      dict(kind='fig', head=False),
    'b-han':         dict(kind='fig', head='auto',
                          parts={'hand': dict(poly=[(510, 422), (570, 260), (602, 264), (576, 400),
                                                    (568, 440), (550, 472), (534, 496), (516, 494),
                                                    (508, 466)],
                                              pivot=(514, 466))}),
    'b-chair-group': dict(kind='fig', head=False),
}


# ---------------------------------------------------------------- 抠底

def key_background(rgb, tol=26.0):
    f = rgb.astype(np.float32)
    border = np.concatenate([f[0], f[-1], f[:, 0], f[:, -1]])
    bg = np.median(border, axis=0)
    dist = np.sqrt(((f - bg) ** 2).sum(axis=2))
    near = dist < tol
    lab, n = ndimage.label(near)
    edge_labels = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    edge_labels = edge_labels[edge_labels > 0]
    background = np.isin(lab, edge_labels)
    # 被轮廓围住的空洞：几乎就是纯底色、且有一定面积的连通块（琵琶颈后、椅背镂空、臂弯）
    holes = []
    if n:
        idx = np.arange(1, n + 1)
        areas = ndimage.sum(near, lab, idx)
        means = ndimage.mean(dist, lab, idx)
        for i, a, m in zip(idx, areas, means):
            if i in edge_labels:
                continue
            if a >= 120 and m < 7.0:
                background |= lab == i
                holes.append(int(a))
    fg = ~background
    flab, n2 = ndimage.label(fg)
    if n2 > 1:
        sizes = ndimage.sum(fg, flab, range(1, n2 + 1))
        keep = np.zeros(n2 + 1, bool)
        keep[1:] = sizes >= max(400, sizes.max() * 0.004)
        fg = keep[flab]
    alpha = fg.astype(np.float32)
    band = ndimage.binary_dilation(fg, iterations=2) & ndimage.binary_dilation(~fg, iterations=2)
    lum = f.mean(axis=2)
    lbg = float(bg.mean())
    ink = ndimage.minimum_filter(np.where(fg, lum, 255.0), size=5)
    local = np.clip((lbg - lum) / np.maximum(lbg - ink, 30.0), 0, 1)
    soft = np.where(ink < 200, local, np.clip((dist - 10.0) / 70.0, 0, 1))
    alpha[band] = soft[band]
    alpha = cv2.GaussianBlur(alpha, (0, 0), 0.5)
    return np.clip(alpha, 0, 1), bg, holes


def decontaminate(rgb, alpha, bg):
    f = rgb.astype(np.float32)
    a = alpha[..., None]
    out = f.copy()
    edge = (alpha > 0.02) & (alpha < 0.98)
    fg = (f - (1 - a) * bg) / np.maximum(a, 0.12)
    out[edge] = fg[edge]
    return np.clip(out, 0, 255)


def poly_mask(shape, poly):
    m = Image.new('L', (shape[1], shape[0]), 0)
    ImageDraw.Draw(m).polygon([tuple(map(float, p)) for p in poly], fill=255)
    return np.array(m) > 0


def inpaint(rgb, alpha, region, radius=7):
    """在 region 内补底：颜色与覆盖率都按周围外推。"""
    m = (ndimage.binary_dilation(region, iterations=2)).astype(np.uint8) * 255
    col = cv2.inpaint(rgb.astype(np.uint8), m, radius, cv2.INPAINT_TELEA)
    a8 = (alpha * 255).astype(np.uint8)
    a2 = cv2.inpaint(a8, m, radius, cv2.INPAINT_TELEA).astype(np.float32) / 255
    out_a = alpha.copy()
    out_a[m > 0] = a2[m > 0]
    return col.astype(np.float32), out_a


# ---------------------------------------------------------------- 做旧与换色

def age(col, name):
    rng = np.random.default_rng(zlib.crc32(name.encode()))
    h, w = col.shape[:2]
    out = AGED_LIFT + col * AGED_TONE * (1 - AGED_LIFT / 255)
    # 绢纹：细颗粒 + 低频斑驳，两者都很淡
    grain = rng.normal(0, AGED_GRAIN, (h, w)).astype(np.float32)
    mott = cv2.GaussianBlur(rng.normal(0, 1, (h // 8 + 1, w // 8 + 1)).astype(np.float32), (0, 0), 2)
    mott = cv2.resize(mott, (w, h), interpolation=cv2.INTER_CUBIC) * 9.0
    out = out + (grain + mott)[..., None]
    return np.clip(out, 0, 255)


def hue_variant(col, alpha, rules):
    hsv = cv2.cvtColor(col.astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
    h, s = hsv[..., 0], hsv[..., 1]
    for h0, h1, smin, target, sk in rules:
        m = (h >= h0) & (h <= h1) & (s >= smin) & (alpha > 0.3)
        m = ndimage.binary_opening(m, iterations=1)
        m = ndimage.binary_closing(m, iterations=2)
        soft = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 1.0)
        hsv[..., 0] = np.where(soft > 0.5, target, h)
        hsv[..., 1] = s * (1 - soft) + s * sk * soft
    rgb = cv2.cvtColor(np.clip(hsv, 0, 255).astype(np.uint8), cv2.COLOR_HSV2RGB)
    return rgb.astype(np.float32)


# ---------------------------------------------------------------- 头部定位

def find_face(rgb, alpha):
    hsv = cv2.cvtColor(rgb.astype(np.uint8), cv2.COLOR_RGB2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    skin = (h >= 3) & (h <= 24) & (s >= 28) & (s <= 150) & (v >= 140) & (alpha > 0.9)
    skin = ndimage.binary_opening(skin, iterations=2)
    lab, n = ndimage.label(skin)
    best = None
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        area = int((lab[sl] == i).sum())
        if area < 1500:
            continue
        y0, y1 = sl[0].start, sl[0].stop
        x0, x1 = sl[1].start, sl[1].stop
        if best is None or y0 < best[1]:
            best = (x0, y0, x1, y1)
    return best


def head_poly(face, opts):
    fx0, fy0, fx1, fy1 = face
    fw, fh = fx1 - fx0, fy1 - fy0
    cut = opts.get('cut', fy1 + 4)
    x0 = opts.get('x0', fx0 - 1.35 * fw)
    x1 = opts.get('x1', fx1 + 1.05 * fw)
    mid = fy0 + 0.55 * fh
    poly = [(x0, 0), (x1, 0), (x1, mid), (fx1 + 6, cut), (fx0 - 6, cut), (x0, mid)]
    pivot = opts.get('pivot', (fx0 + 0.42 * fw, cut))
    return poly, pivot


# ---------------------------------------------------------------- 输出工具

def resize_rgba(col, alpha, scale):
    h, w = alpha.shape
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    pre = col * alpha[..., None]
    pre_r = cv2.resize(pre, (nw, nh), interpolation=cv2.INTER_AREA)
    a_r = cv2.resize(alpha, (nw, nh), interpolation=cv2.INTER_AREA)
    c_r = pre_r / np.maximum(a_r[..., None], 1e-4)
    return np.clip(c_r, 0, 255), np.clip(a_r, 0, 1)


def bbox(alpha, thr=0.02):
    ys, xs = np.where(alpha > thr)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def contour_poly(alpha, eps=1.6):
    m = (alpha > 0.5).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in sorted(cs, key=cv2.contourArea, reverse=True):
        if cv2.contourArea(c) < 300:
            continue
        ap = cv2.approxPolyDP(c, eps, True).reshape(-1, 2)
        out.append([round(float(v), 1) for p in ap for v in p])
    return out


def to_rgba8(col, alpha):
    return np.dstack([np.clip(col, 0, 255), np.clip(alpha * 255, 0, 255)]).astype(np.uint8)


def max_part_alpha(part_imgs, H, W):
    acc = np.zeros((H, W), np.float32)
    for _, (_, pa, (ox, oy)) in part_imgs.items():
        ph, pw = pa.shape
        acc[oy:oy + ph, ox:ox + pw] = np.maximum(acc[oy:oy + ph, ox:ox + pw], pa)
    return acc


# ---------------------------------------------------------------- 主流程

def build(name, spec, debug):
    src = spec.get('src', name)
    rgb = np.array(Image.open(os.path.join(RAW, src + '.jpg')).convert('RGB'))
    if spec.get('crop'):
        cx0, cx1 = spec['crop']
        rgb = np.ascontiguousarray(rgb[:, cx0:cx1])
    if spec.get('mirror'):
        rgb = np.ascontiguousarray(rgb[:, ::-1])
    alpha, bg, holes = key_background(rgb)
    col = decontaminate(rgb, alpha, bg)
    if spec.get('hue'):
        col = hue_variant(col, alpha, spec['hue'])
    face = find_face(col, alpha)
    col = age(col, name)

    parts = {}
    if spec.get('head'):
        if face is None:
            print(f'  ! {name}: 找不到脸，不拆头层')
        else:
            opts = spec['head'] if isinstance(spec['head'], dict) else {}
            poly, pivot = head_poly(face, opts)
            parts['head'] = dict(poly=poly, pivot=pivot)
    for pn, p in spec.get('parts', {}).items():
        parts[pn] = dict(poly=p['poly'], pivot=p['pivot'])

    # 拆层：部件从原画剪下，身体在挖空处补底
    layers = {}
    body_col, body_a = col.copy(), alpha.copy()
    for pn, p in parts.items():
        region = poly_mask(alpha.shape, p['poly'])
        pa = np.where(region, alpha, 0.0)
        if pa.max() < 0.05:
            continue
        layers[pn] = (col.copy(), pa)
        body_col, body_a = inpaint(body_col, body_a, region & (alpha > 0.02))

    # 统一裁边（身体与部件共用同一坐标系）
    union = body_a.copy()
    for _, (_, pa) in layers.items():
        union = np.maximum(union, pa)
    x0, y0, x1, y1 = bbox(union)
    x0, y0 = max(0, x0 - PAD), max(0, y0 - PAD)
    x1, y1 = min(alpha.shape[1], x1 + PAD), min(alpha.shape[0], y1 + PAD)

    def tr(pt):
        return [round((pt[0] - x0) * SCALE, 1), round((pt[1] - y0) * SCALE, 1)]

    bc, ba = resize_rgba(body_col[y0:y1, x0:x1], body_a[y0:y1, x0:x1], SCALE)
    H, W = ba.shape
    part_imgs = {}
    for pn, (pc, pa) in layers.items():
        c2, a2 = resize_rgba(pc[y0:y1, x0:x1], pa[y0:y1, x0:x1], SCALE)
        px0, py0, px1, py1 = bbox(a2)
        part_imgs[pn] = (c2[py0:py1, px0:px1], a2[py0:py1, px0:px1], (int(px0), int(py0)))

    # 图集：身体在左，部件依次排在右边
    sheet_w = W + sum(img[1].shape[1] + 4 for img in part_imgs.values())
    sheet_h = max([H] + [img[1].shape[0] for img in part_imgs.values()])
    sheet = np.zeros((sheet_h, sheet_w, 4), np.uint8)
    sheet[:H, :W] = to_rgba8(bc, ba)
    meta_parts = {}
    cx = W + 4
    for pn, (pc, pa, (ox, oy)) in part_imgs.items():
        ph, pw = pa.shape
        sheet[:ph, cx:cx + pw] = to_rgba8(pc, pa)
        meta_parts[pn] = dict(src=[cx, 0, pw, ph], at=[ox, oy], pivot=tr(parts[pn]['pivot']))
        cx += pw + 4
    Image.fromarray(sheet, 'RGBA').save(os.path.join(OUT, name + '.webp'), 'WEBP', quality=88, method=6)

    full = np.maximum(ba, max_part_alpha(part_imgs, H, W))
    cbx0, cby0, cbx1, cby1 = bbox(full, 0.3)
    meta = dict(
        id=name, kind=spec['kind'], w=W, h=H,
        src=f'assets/figures/{name}.webp',
        # 实际笔墨所占的框（去掉留边），摆放时按它对齐原作
        content=[int(cbx0), int(cby0), int(cbx1), int(cby1)],
        face=[*tr(face[:2]), *tr(face[2:])] if face else None,
        parts=meta_parts,
        anchors=dict({k: tr(v if not spec.get('crop') else (v[0] - spec['crop'][0], v[1]))
                      for k, v in spec.get('anchors', {}).items()},
                     **{k: list(v) for k, v in spec.get('atlas_anchors', {}).items()}),
        contour=contour_poly(full),
    )

    if debug:
        dbg = Image.new('RGBA', (sheet_w, sheet_h), (112, 80, 38, 255))
        dbg.alpha_composite(Image.fromarray(sheet, 'RGBA'))
        d = ImageDraw.Draw(dbg)
        for poly in meta['contour']:
            pts = list(zip(poly[0::2], poly[1::2]))
            d.line(pts + [pts[0]], fill=(0, 255, 120, 255), width=1)
        for pn, p in parts.items():
            pts = [tuple(tr(q)) for q in p['poly']]
            d.line(pts + [pts[0]], fill=(255, 60, 60, 255), width=2)
            px, py = tr(p['pivot'])
            d.ellipse([px - 5, py - 5, px + 5, py + 5], outline=(255, 255, 0, 255), width=2)
        for k, v in meta['anchors'].items():
            d.ellipse([v[0] - 4, v[1] - 4, v[0] + 4, v[1] + 4], fill=(0, 200, 255, 255))
        dbg.convert('RGB').save(os.path.join(DEBUG, name + '.jpg'), quality=85)

    print(f'{name:14s} {W}x{H} parts={list(meta_parts)} holes={len(holes)}')
    return meta


def write_atlas(metas):
    body = json.dumps(metas, ensure_ascii=False, separators=(',', ':'))
    js = ('/* 由 scripts/build_figures.py 生成，请勿手改。\n'
          '   人物与陈设图集元数据：尺寸、笔墨所占的框、脸的位置、部件（头/鼓槌/扇）与支点、\n'
          '   烟与交互锚点、外轮廓矢量遮罩。坐标为图集像素，原点在身体层左上角。 */\n'
          '(function (root) {\n'
          "  'use strict';\n"
          '  const HX = (root.HX = root.HX || {});\n'
          f'  HX.figureAtlas = {body};\n'
          "})(typeof window !== 'undefined' ? window : globalThis);\n")
    with open(ATLAS_JS, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(js)


def load_atlas():
    if not os.path.exists(ATLAS_JS):
        return {}
    txt = open(ATLAS_JS, encoding='utf-8').read()
    start = txt.index('HX.figureAtlas = ') + len('HX.figureAtlas = ')
    return json.loads(txt[start:txt.index(';\n})', start)])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--debug', action='store_true')
    ap.add_argument('--only', default='')
    args = ap.parse_args()
    os.makedirs(DEBUG, exist_ok=True)
    only = [n for n in args.only.split(',') if n]
    metas = load_atlas() if only else {}
    for name in SPEC:
        if only and name not in only:
            continue
        metas[name] = build(name, SPEC[name], args.debug)
    write_atlas({k: metas[k] for k in SPEC if k in metas})


if __name__ == '__main__':
    main()
