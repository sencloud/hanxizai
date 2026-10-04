#!/usr/bin/env python3
"""把应用截图合成为推广用图：封面、五段总览、三方对照、动图、GitHub 社交预览。

用法：
    python scripts/make_promo.py --frames <截图目录> --out docs/promo

截图目录里应有 still-listen/dance/rest/flute/farewell.png（1600×900）与
anim-00..NN.png（同尺寸），由 Chrome 无头模式按下面这种方式抓取：

    chrome --headless=new --screenshot=x.png --window-size=1600,900 \
      "index.html#shot&x=<世界坐标>&warp=<更漏秒数>"

#shot 会隐藏全部界面层，只留画心。
"""
import argparse
import glob
import os

from PIL import Image, ImageDraw, ImageFont

INK = (23, 19, 16)
INK_SOFT = (58, 46, 36)
PAPER = (232, 220, 196)
PAPER_DIM = (196, 182, 156)
VERMILION = (158, 59, 46)
GOLD = (176, 138, 69)

FONT_DIR = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
SERIF = os.path.join(FONT_DIR, "STSONG.TTF")
SANS = os.path.join(FONT_DIR, "msyh.ttc")


def font(path, size, index=0):
    return ImageFont.truetype(path, size, index=index)


def draw_spaced(draw, xy, text, fnt, fill, spacing=0, anchor_left=True):
    """逐字绘制，做出字距。返回绘制后的宽度。"""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += draw.textlength(ch, font=fnt) + spacing
    return x - xy[0] - spacing


def spaced_width(draw, text, fnt, spacing):
    w = sum(draw.textlength(c, font=fnt) for c in text)
    return w + spacing * max(0, len(text) - 1)


def fit_image(img, size, cover=True):
    """按 cover 缩放到目标尺寸并居中裁切。"""
    tw, th = size
    sw, sh = img.size
    scale = max(tw / sw, th / sh) if cover else min(tw / sw, th / sh)
    nw, nh = max(1, int(sw * scale)), max(1, int(sh * scale))
    resized = img.resize((nw, nh), Image.LANCZOS)
    left = (nw - tw) // 2
    top = (nh - th) // 2
    return resized.crop((left, top, left + tw, top + th))


def scrim(img, box, color, top_alpha, bottom_alpha, horizontal=False):
    """在图上叠一层渐变，用来压暗放字的地方。"""
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = box
    span = (x1 - x0) if horizontal else (y1 - y0)
    for i in range(span):
        u = i / max(1, span - 1)
        a = int(top_alpha + (bottom_alpha - top_alpha) * u)
        if horizontal:
            d.line([(x0 + i, y0), (x0 + i, y1)], fill=color + (a,))
        else:
            d.line([(x0, y0 + i), (x1, y0 + i)], fill=color + (a,))
    img.alpha_composite(layer)


def seal(img, xy, size, text="夜宴之印"):
    d = ImageDraw.Draw(img)
    x, y = xy
    d.rounded_rectangle([x, y, x + size, y + size], radius=int(size * 0.08),
                        fill=VERMILION + (235,))
    d.rounded_rectangle([x + size * 0.08, y + size * 0.08,
                         x + size * 0.92, y + size * 0.92],
                        radius=int(size * 0.06), outline=PAPER + (110,), width=max(1, size // 40))
    f = font(SERIF, int(size * 0.36))
    cells = [(1, 0), (0, 0), (1, 1), (0, 1)]  # 右上 → 左上 → 右下 → 左下
    cx, cy = size * 0.30, size * 0.30
    for ch, (col, row) in zip(text[:4], cells):
        d.text((x + cx + col * size * 0.40, y + cy + row * size * 0.40), ch,
               font=f, fill=(243, 230, 205), anchor="mm")


def cover(frames, out):
    W, H = 1200, 675
    hero = Image.open(os.path.join(frames, "still-listen.png")).convert("RGB")
    canvas = fit_image(hero, (W, H)).convert("RGBA")
    scrim(canvas, (0, 0, W, H), (14, 11, 9), 92, 10)
    scrim(canvas, (0, int(H * 0.30), W, H), (14, 11, 9), 0, 210)

    d = ImageDraw.Draw(canvas)
    f_title = font(SERIF, 74)
    f_sub = font(SANS, 25)
    f_meta = font(SANS, 19)

    draw_spaced(d, (78, 120), "韩熙载夜宴图", f_title, PAPER, spacing=6)
    d.line([(80, 232), (80 + 320, 232)], fill=GOLD + (190,), width=2)
    d.text((80, 254), "可漫游的互动夜宴长卷", font=f_sub, fill=(238, 226, 202))
    d.text((80, 292), "听乐 · 观舞 · 歇息 · 清吹 · 送别", font=f_meta, fill=(214, 200, 174))

    d.text((80, H - 132), "每件人物与陈设按原作版式重绘并分层", font=f_meta, fill=(206, 192, 166))
    d.text((80, H - 102), "Canvas 2D + WebGL + Web Audio", font=f_meta, fill=(206, 192, 166))
    d.text((80, H - 72), "无框架 · 无构建 · 双击 index.html 即可运行", font=f_meta, fill=(196, 172, 120))

    seal(canvas, (W - 176, H - 186), 106)
    canvas.convert("RGB").save(out, optimize=True)
    return out


def five_scenes(frames, out):
    order = [("listen", "其一 · 听乐", "李家小妹抱琵琶，满堂屏息"),
             ("dance", "其二 · 观舞", "王屋山踏六幺，主人亲擂羯鼓"),
             ("rest", "其三 · 歇息", "宴罢暂歇，主人洗手"),
             ("flute", "其四 · 清吹", "五女横笛，主人执扇"),
             ("farewell", "其五 · 送别", "曲终人散，主人执槌作别")]
    cols, cw, ch = 3, 620, 349
    gap, pad, label_h = 22, 40, 76
    rows = 2
    W = pad * 2 + cols * cw + (cols - 1) * gap
    H = pad * 2 + rows * (ch + label_h) + (rows - 1) * gap

    canvas = Image.new("RGB", (W, H), (26, 21, 17))
    d = ImageDraw.Draw(canvas)
    f_zh = font(SERIF, 30)
    f_note = font(SANS, 17)

    for i, (key, title, note) in enumerate(order):
        row, col = divmod(i, cols)
        x = pad + col * (cw + gap)
        y = pad + row * (ch + label_h + gap)
        shot = Image.open(os.path.join(frames, f"still-{key}.png")).convert("RGB")
        canvas.paste(fit_image(shot, (cw, ch)), (x, y))
        d.rectangle([x, y, x + cw - 1, y + ch - 1], outline=(70, 56, 42), width=1)
        draw_spaced(d, (x, y + ch + 14), title, f_zh, PAPER, spacing=3)
        d.text((x, y + ch + 52), note, font=f_note, fill=PAPER_DIM)

    # 最后一格放更漏
    row, col = divmod(len(order), cols)
    x = pad + col * (cw + gap)
    y = pad + row * (ch + label_h + gap)
    d.rounded_rectangle([x, y, x + cw - 1, y + ch - 1], radius=6,
                        fill=(33, 26, 20), outline=(70, 56, 42), width=1)
    draw_spaced(d, (x + 34, y + 44), "更漏", font(SERIF, 30), PAPER, spacing=3)
    stages = ["掌灯", "烛明", "烛影摇红", "香尽", "更残漏尽", "天将明"]
    for j, s in enumerate(stages):
        sy = y + 112 + j * 30
        d.ellipse([x + 36, sy + 5, x + 46, sy + 15], fill=GOLD)
        if j < len(stages) - 1:
            d.line([(x + 41, sy + 16), (x + 41, sy + 35)], fill=GOLD + (120,), width=1)
        d.text((x + 62, sy), s, font=f_note, fill=(220, 208, 184))
    d.text((x + 36, y + ch - 44), "同一条时间轴决定火光、香烟、色调与声音",
           font=font(SANS, 15), fill=(160, 146, 124))

    canvas.save(out, optimize=True)
    return out


def compare(frames, out):
    W, H = 1200, 700
    canvas = Image.new("RGB", (W, H), (26, 21, 17))
    d = ImageDraw.Draw(canvas)
    f_title = font(SERIF, 40)
    f_name = font(SERIF, 27)
    f_body = font(SANS, 19)
    f_small = font(SANS, 17)

    draw_spaced(d, (56, 48), "三种把古画放进浏览器的做法", f_title, PAPER, spacing=3)
    d.text((56, 106), "同一幅长卷，三种取舍", font=f_small, fill=PAPER_DIM)
    d.line([(56, 140), (W - 56, 140)], fill=(70, 56, 42), width=1)

    cards = [
        ("qingming-riverside", "《清明上河图》",
         ["原创一条宋代沿河街市", "Canvas 2D + Three.js", "步态绑定位移 · 时间轴人物", "虹桥过船：状态机 + 拉绳力度"],
         "188 ★", (86, 104, 128)),
        ("ErkinCao", "《韩熙载夜宴图》",
         ["公共领域真扫描 + DZI 瓦片", "React + TypeScript", "57 热点 · 十条导览 · 64 页", "画卷身世与纪念票"],
         "1 ★", (104, 112, 96)),
        ("sencloud/hanxizai", "《韩熙载夜宴图》",
         ["按原作版式重绘 47 件素材", "原生 JS + Canvas 2D + WebGL", "六幺舞状态机 · 共同乐谱", "28 则批注 · 22 项自测"],
         "本项目", (146, 92, 62)),
    ]
    cw = (W - 56 * 2 - 24 * 2) // 3
    cy = 178
    chh = 352
    for i, (repo, work, lines, badge, accent) in enumerate(cards):
        x = 56 + i * (cw + 24)
        d.rounded_rectangle([x, cy, x + cw, cy + chh], radius=8,
                            fill=(33, 26, 20), outline=(70, 56, 42), width=1)
        d.rectangle([x, cy, x + cw, cy + 6], fill=accent)
        draw_spaced(d, (x + 22, cy + 30), badge, f_small, accent, spacing=2)
        draw_spaced(d, (x + 22, cy + 68), work, f_name, PAPER, spacing=2)
        d.text((x + 22, cy + 112), repo, font=f_small, fill=(150, 136, 116))
        for j, line in enumerate(lines):
            ly = cy + 162 + j * 46
            d.ellipse([x + 24, ly + 8, x + 31, ly + 15], fill=(176, 138, 69))
            wrapped = wrap(line, f_body, cw - 62)
            for k, seg in enumerate(wrapped):
                d.text((x + 44, ly + k * 26), seg, font=f_body, fill=(210, 198, 176))

    d.line([(56, cy + chh + 46), (W - 56, cy + chh + 46)], fill=(70, 56, 42), width=1)
    d.text((56, cy + chh + 66), "一个放弃了对原画的忠实，一个放弃了自由的再创作，",
           font=f_body, fill=PAPER_DIM)
    d.text((56, cy + chh + 98), "一个把原作当版式、把人物重画了一遍。",
           font=f_body, fill=PAPER_DIM)
    canvas.save(out, optimize=True)
    return out


def wrap(text, fnt, max_w):
    out, cur = [], ""
    for ch in text:
        if fnt.getlength(cur + ch) > max_w and cur:
            out.append(cur)
            cur = ch
        else:
            cur += ch
    if cur:
        out.append(cur)
    return out


def social(frames, out):
    W, H = 1280, 640
    hero = Image.open(os.path.join(frames, "still-dance.png")).convert("RGB")
    canvas = fit_image(hero, (W, H)).convert("RGBA")
    scrim(canvas, (0, 0, int(W * 0.62), H), (14, 11, 9), 236, 150, horizontal=True)

    d = ImageDraw.Draw(canvas)
    draw_spaced(d, (72, 120), "韩熙载夜宴图", font(SERIF, 76), PAPER, spacing=8)
    d.line([(74, 246), (74 + 300, 246)], fill=GOLD + (200,), width=2)
    d.text((74, 274), "可漫游的互动夜宴长卷", font=font(SANS, 30), fill=(238, 226, 202))
    d.text((74, 322), "Han Xizai's Night Revels · interactive handscroll",
           font=font(SANS, 20), fill=(206, 192, 166))
    d.text((74, H - 116), "Canvas 2D + WebGL + Web Audio · 无框架 · 无构建",
           font=font(SANS, 21), fill=(206, 192, 166))
    d.text((74, H - 78), "github.com/sencloud/hanxizai", font=font(SANS, 21), fill=GOLD)
    seal(canvas, (W - 168, H - 176), 96)
    canvas.convert("RGB").save(out, optimize=True)
    return out


def animation(frames, out, fps=7, width=782):
    paths = sorted(glob.glob(os.path.join(frames, "anim-*.png")))
    if not paths:
        return None
    imgs = []
    for p in paths:
        im = Image.open(p).convert("RGB")
        h = int(im.height * width / im.width)
        imgs.append(im.resize((width, h), Image.LANCZOS).convert("P", palette=Image.ADAPTIVE, colors=128))
    imgs[0].save(out, save_all=True, append_images=imgs[1:],
                 duration=int(1000 / fps), loop=0, optimize=True, disposal=2)
    return out


def hero_still(frames, out):
    """介绍页的题图：不带任何文字的画心，供网页做背景。"""
    im = Image.open(os.path.join(frames, "still-listen.png")).convert("RGB")
    im = im.resize((1600, int(im.height * 1600 / im.width)), Image.LANCZOS)
    im.save(out, optimize=True)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", required=True)
    ap.add_argument("--out", default="docs/promo")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    made = [
        cover(args.frames, os.path.join(args.out, "01-cover-zhihu.png")),
        five_scenes(args.frames, os.path.join(args.out, "02-five-scenes.png")),
        compare(args.frames, os.path.join(args.out, "03-compare-three.png")),
        social(args.frames, os.path.join(args.out, "05-github-social-preview.png")),
        animation(args.frames, os.path.join(args.out, "04-roam.gif")),
        hero_still(args.frames, os.path.join(args.out, "06-hero-still.png")),
    ]
    for m in made:
        if m:
            print(f"{m}  {os.path.getsize(m) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
