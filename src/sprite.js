/* 分层素材渲染：生成的工笔立绘 + 矢量遮罩。

   一张素材 = 身体层 + 若干部件层（头、鼓槌、团扇），元数据见 figure-atlas.js。
   身体按横条切开逐条绘制。每条按上下两沿的横移量做斜切，相邻两条在接缝处位移相同，
   所以形变是连续的，看不出台阶：
     lean   上身前倾（越往上横移越多，脚下不动）
     sway   下摆摆动（只作用在下半身）
     hem    裙摆张开（下半身逐条加宽）
     breath 呼吸（以脚为原点的竖向伸缩）；chest 胸口随之微微张开
   部件绕各自的支点转动，并跟随它所在高度的横移，所以点头、击鼓、挥扇、拨弦
   不会与身体错位；头部另有 look（顾盼时的横移）。
   外轮廓多边形用于命中测试、点击后的描边高亮，以及贴图未就绪时的剪影。 */
(function (root) {
  'use strict';
  const HX = (root.HX = root.HX || {});
  const U = HX.util;

  let STRIPS = 18;
  const setStrips = (n) => { STRIPS = Math.max(6, Math.round(n)); };

  class Bank {
    constructor(atlas) {
      this.atlas = atlas || HX.figureAtlas || {};
      this.images = new Map();
      this.paths = new Map();
      this.loaded = 0;
      this.failed = 0;
    }

    load() {
      const jobs = Object.values(this.atlas).map((m) => new Promise((resolve) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => { this.loaded++; this.images.set(m.id, img); resolve(true); };
        img.onerror = () => { this.failed++; resolve(false); };
        img.src = m.src;
      }));
      return Promise.all(jobs);
    }

    meta(id) { return this.atlas[id]; }
    image(id) { return this.images.get(id) || null; }

    contourPath(id) {
      let p = this.paths.get(id);
      if (p) return p;
      const m = this.atlas[id];
      p = new Path2D();
      for (const poly of m.contour) {
        p.moveTo(poly[0], poly[1]);
        for (let i = 2; i < poly.length; i += 2) p.lineTo(poly[i], poly[i + 1]);
        p.closePath();
      }
      this.paths.set(id, p);
      return p;
    }
  }

  // 下半身权重：膝以上为 0，裙脚为 1
  function lowerWeight(m, v) {
    const c = m.content;
    const u = (v - c[1]) / Math.max(1, c[3] - c[1]);
    return U.smooth((u - 0.45) / 0.55);
  }

  // 胸口权重：肩下到腰上隆起
  function chestWeight(m, v) {
    const c = m.content;
    const u = (v - c[1]) / Math.max(1, c[3] - c[1]);
    return U.smooth((u - 0.12) / 0.14) * (1 - U.smooth((u - 0.34) / 0.2));
  }

  function frame(m, pl, pose) {
    const c = m.content;
    const sx = (pose.flip ? -1 : 1) * (pose.sx == null ? 1 : pose.sx);
    return {
      cx: (c[0] + c[2]) / 2,
      fy: c[3],
      sx,
      x: pl.x + (pose.dx || 0),
      y: pl.foot + (pose.dy || 0),
      s: pl.s
    };
  }

  // 图集坐标 v 处的横移（图集像素）
  function offsetAt(m, pose, v) {
    const fy = m.content[3];
    return (pose.lean || 0) * (fy - v) + (pose.sway || 0) * lowerWeight(m, v);
  }

  function draw(ctx, bank, id, pl, pose = {}) {
    const m = bank.meta(id);
    if (!m || !pl) return;
    const f = frame(m, pl, pose);
    const img = bank.image(id);
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(f.s * f.sx, f.s);
    if (pose.alpha != null) ctx.globalAlpha *= pose.alpha;

    if (!img) {
      ctx.fillStyle = 'rgba(58,44,30,.5)';
      ctx.translate(-f.cx, -f.fy);
      ctx.fill(bank.contourPath(id));
      ctx.restore();
      return;
    }

    const breath = pose.breath || 0;
    const bob = pose.bob || 0;
    const hem = pose.hem || 0;
    const chest = pose.chest == null ? breath * 1.6 : pose.chest;
    const ky = 1 + breath;
    const moving = pose.lean || pose.sway || breath || hem || bob || chest;
    const n = moving ? STRIPS : 1;
    const seam = 0.8 / (f.s * Math.max(0.2, Math.abs(f.sx)));
    for (let i = 0; i < n; i++) {
      const v0 = (m.h * i) / n;
      const v1 = (m.h * (i + 1)) / n;
      const vm = (v0 + v1) / 2;
      const wid = 1 + hem * lowerWeight(m, vm) + chest * chestWeight(m, vm);
      const y0 = (v0 - f.fy) * ky - bob;
      const y1 = (v1 - f.fy) * ky - bob;
      if (n === 1) {
        ctx.drawImage(img, 0, 0, m.w, m.h, -f.cx, y0, m.w, y1 - y0);
        break;
      }
      // 斜切：上沿横移 o0、下沿横移 o1，与相邻两条在接缝处吻合
      const o0 = offsetAt(m, pose, v0), o1 = offsetAt(m, pose, v1);
      const k = (o1 - o0) / (y1 - y0);
      ctx.save();
      ctx.transform(1, 0, k, 1, o0 - k * y0, 0);
      ctx.drawImage(
        img, 0, v0, m.w, v1 - v0,
        -f.cx * wid, y0,
        m.w * wid, y1 - y0 + (i < n - 1 ? seam : 0)
      );
      ctx.restore();
    }

    for (const name in m.parts) {
      const p = m.parts[name];
      const isHead = name === 'head';
      const angle = (pose.parts && pose.parts[name]) || (isHead ? pose.nod || 0 : 0);
      const [px, py] = p.pivot;
      ctx.save();
      ctx.translate(
        px - f.cx + offsetAt(m, pose, py) + (isHead ? pose.look || 0 : 0),
        (py - f.fy) * ky - bob + (isHead ? pose.lift || 0 : 0)
      );
      if (angle) ctx.rotate(angle);
      const [sx, sy, w, h] = p.src;
      ctx.drawImage(img, sx, sy, w, h, p.at[0] - px, p.at[1] - py, w, h);
      ctx.restore();
    }
    ctx.restore();
  }

  // 点击后的描边：沿矢量轮廓走一圈暖光
  function outline(ctx, bank, id, pl, pose, alpha) {
    const m = bank.meta(id);
    if (!m || !pl || alpha <= 0.01) return;
    const f = frame(m, pl, pose);
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(f.s * f.sx, f.s);
    ctx.translate(-f.cx + offsetAt(m, pose, (m.content[1] + m.content[3]) / 2) * 0.5, -f.fy);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(255,214,150,${0.5 * alpha})`;
    ctx.lineWidth = 2.6 / f.s;
    ctx.shadowColor = `rgba(255,190,110,${0.8 * alpha})`;
    ctx.shadowBlur = 14;
    ctx.stroke(bank.contourPath(id));
    ctx.restore();
  }

  function toLocal(m, f, wx, wy) {
    return [(wx - f.x) / (f.s * f.sx) + f.cx, (wy - f.y) / f.s + f.fy];
  }

  function inside(poly, x, y) {
    let hit = false;
    for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
      const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  }

  // 命中测试：世界坐标点是否落在素材的矢量轮廓内
  function contains(bank, id, pl, pose, wx, wy) {
    const m = bank.meta(id);
    if (!m || !pl) return false;
    const f = frame(m, pl, pose || {});
    if (Math.abs(f.sx) < 0.05) return false;
    const [u, v] = toLocal(m, f, wx, wy);
    if (u < 0 || v < 0 || u > m.w || v > m.h) return false;
    return m.contour.some((poly) => inside(poly, u, v));
  }

  // 锚点的世界坐标（烟、弦光、鼓面涟漪都吸附在这里）
  function anchor(bank, id, pl, pose, name) {
    const m = bank.meta(id);
    const a = m && m.anchors[name];
    if (!a || !pl) return null;
    const f = frame(m, pl, pose || {});
    const ky = 1 + ((pose && pose.breath) || 0);
    return [
      f.x + (a[0] - f.cx + offsetAt(m, pose || {}, a[1])) * f.s * f.sx,
      f.y + ((a[1] - f.fy) * ky - ((pose && pose.bob) || 0)) * f.s
    ];
  }

  HX.sprite = { Bank, draw, outline, contains, anchor, setStrips };
})(typeof window !== 'undefined' ? window : globalThis);
