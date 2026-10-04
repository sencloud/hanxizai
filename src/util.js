/* 基础数学、确定性随机与绘制小工具。所有模块挂在 window.HX 下。 */
(function (root) {
  'use strict';
  const HX = (root.HX = root.HX || {});

  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, u) => a + (b - a) * u;
  const mix = (a, b, u) => a + (b - a) * u;

  // 平滑阶跃：0..1，两端导数为 0
  function smooth(u) {
    u = clamp(u);
    return u * u * (3 - 2 * u);
  }

  // 在 [a,b] 区间内做平滑上升
  function ramp(t, a, b) {
    if (b === a) return t >= b ? 1 : 0;
    return smooth((t - a) / (b - a));
  }

  // 上升窗再下降窗：a→b 起，c→d 落
  function windowAt(t, a, b, c, d) {
    return ramp(t, a, b) - ramp(t, c, d);
  }

  // 确定性哈希：同样的 n 永远得到同样的 0..1
  function seed(n) {
    const x = Math.sin(n * 91.731 + 17.13) * 43758.5453;
    return x - Math.floor(x);
  }

  function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % 100000;
  }

  // 一维值噪声（可用于风、烛焰、烟雾的次级抖动）
  function noise1(x, s = 0) {
    const i = Math.floor(x), f = x - i;
    const u = f * f * (3 - 2 * f);
    return lerp(seed(i + s), seed(i + 1 + s), u);
  }

  // 二维值噪声
  function noise2(x, y, s = 0) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = seed(ix + iy * 57.1 + s);
    const b = seed(ix + 1 + iy * 57.1 + s);
    const c = seed(ix + (iy + 1) * 57.1 + s);
    const d = seed(ix + 1 + (iy + 1) * 57.1 + s);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
  }

  // 分形噪声
  function fbm(x, y, octaves = 3, s = 0) {
    let v = 0, amp = 0.5, f = 1;
    for (let i = 0; i < octaves; i++) {
      v += amp * noise2(x * f, y * f, s + i * 13);
      amp *= 0.5;
      f *= 2;
    }
    return v;
  }

  // bezier 线段辅助
  function line(ctx, x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function curveTo(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i += 3) {
      ctx.bezierCurveTo(
        pts[i][0], pts[i][1],
        pts[i + 1][0], pts[i + 1][1],
        pts[i + 2][0], pts[i + 2][1]
      );
    }
    ctx.closePath();
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  // 稳定排序不变式：按 y（脚底）排序，远处先画
  function byGround(a, b) {
    return (a.y || 0) - (b.y || 0);
  }

  HX.util = {
    clamp, lerp, mix, smooth, ramp, windowAt,
    seed, hashString, noise1, noise2, fbm,
    line, curveTo, roundRect, byGround
  };
})(typeof window !== 'undefined' ? window : globalThis);
