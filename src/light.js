/* 氛围：一条时间轴推演出连续量（烛/影/烟/暖/静），再由它驱动光与烟。
   对应《清明上河图》项目里的"清明时雨"。 */
(function (root) {
  'use strict';
  const HX = (root.HX = root.HX || {});
  const U = HX.util;
  const P = HX.palette;
  const C = P.C;
  const { clamp, ramp, windowAt, seed } = U;

  // 更漏：掌灯 → 烛明 → 烛影摇红 → 香尽 → 更残漏尽 → 天将明
  const STAGES = [
    [0, 'lamp', '掌灯'],
    [10, 'bright', '烛明'],
    [34, 'sway', '烛影摇红'],
    [70, 'fade', '香尽'],
    [100, 'late', '更残漏尽'],
    [130, 'dawn', '天将明']
  ];
  const DURATION = 160;

  function ambience(time, active = true) {
    const t = Math.max(0, time);
    let stage = 'lamp', label = '掌灯';
    for (const [at, id, name] of STAGES) {
      if (t >= at) { stage = id; label = name; }
    }

    const lit = ramp(t, 0, 8);
    const dying = ramp(t, 72, 128);
    const flame = active ? (0.42 + 0.58 * lit) * (1 - 0.72 * dying) : 0.35;
    const shadow = active ? 0.34 + 0.66 * ramp(t, 18, 62) - 0.4 * dying : 0.5;
    const smoke = active
      ? clamp(0.22 * ramp(t, 4, 26) + 0.38 * windowAt(t, 0, 30, 96, 140))
      : 0;
    const warm = active ? clamp(0.3 + 0.45 * ramp(t, 0, 24) - 0.55 * ramp(t, 108, 140)) : 0.35;
    const still = active ? clamp(ramp(t, 36, 96)) : 0.2;
    const dawn = clamp(ramp(t, 122, 150));
    const sway = active ? 0.25 + 0.75 * ramp(t, 20, 46) : 0.3;

    return {
      time: t, active, stage, label,
      flame, shadow, smoke, warm, still, dawn, sway,
      out: t > 96
    };
  }

  class NightClock {
    constructor() {
      this.active = true;
      this.time = 0;
      this.stage = 'lamp';
      this.events = [];
      this.rate = 1;
    }
    step(dt) {
      this.events = [];
      if (dt <= 0) return this.sample();
      if (this.active) {
        this.time = Math.min(DURATION, this.time + dt * this.rate);
        const next = ambience(this.time, true);
        if (next.stage !== this.stage) {
          this.events.push(next.stage);
          this.stage = next.stage;
        }
        if (this.time >= DURATION - 0.001) this.active = false;
      }
      return this.sample();
    }
    sample() { return ambience(this.time, this.active || this.time > 0); }
    reset() { this.active = true; this.time = 0; this.stage = 'lamp'; }
    jump(stageId) {
      const found = STAGES.find(([, id]) => id === stageId);
      if (!found) return false;
      this.time = found[0] + 0.5;
      this.stage = stageId;
      this.active = true;
      return true;
    }
  }

  // 每支烛有自己的熄灭时刻（按 id 错开，不会全场同时灭）
  function candleLevel(c, t, amb) {
    const k = 98 + seed(c.seedId * 7.3) * 24;   // 98 ~ 122 秒之间各自熄灭
    const fading = 1 - ramp(t, k, k + 9);
    return clamp((0.35 + 0.65 * ramp(t, 0, 8)) * fading) * (0.7 + amb.flame * 0.5);
  }

  // 收集视野内的光源
  function collectLights(state, view) {
    const t = state.amb.time;
    const amb = state.amb;
    const out = [];
    const margin = 90;
    for (const c of HX.plate.CANDLES) {
      if (c.x + 90 < view.x0 - margin || c.x - 90 > view.x1 + margin) continue;
      // 剪过烛花的那一架，会亮一阵子
      const trimmed = state.trim && state.trim.get(c.id);
      const boost = trimmed == null ? 1
        : 1 + 0.5 * Math.exp(-Math.max(0, t - trimmed) / 26);
      const level = Math.min(1.35, candleLevel(c, t, amb) * boost);
      for (let i = 0; i < c.tips.length; i++) {
        out.push({
          x: c.tips[i][0], y: c.tips[i][1],
          floor: c.floor,
          r: 150 + 110 * level,
          level,
          flicker: 0.72 + 0.28 * U.noise1(t * 4.5 + i * 3.3 + c.seedId, c.seedId),
          hue: 0.5 + 0.5 * seed(i + c.seedId)
        });
      }
    }
    return out;
  }

  // 光：叠加混合的柔光 + 焰心。画在结构之上、UI 之下。
  function render(ctx, state, view, opts = {}) {
    const amb = state.amb;
    const lights = collectLights(state, view);
    const reduced = opts.reduced;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // 地面光池：烛光落在烛台脚下的绢地上，先铺一层，再叠焰与晕
    for (const L of lights) {
      const ground = L.floor;
      const u = 1 - clamp((ground - L.y) / 720);
      if (u <= 0.02) continue;
      const rx = (70 + 90 * L.level) * (0.6 + u * 0.9);
      const g = ctx.createRadialGradient(L.x, ground, 0, L.x, ground, rx);
      const a = 0.16 * L.level * u * L.flicker;
      g.addColorStop(0, `rgba(255,206,140,${a})`);
      g.addColorStop(1, 'rgba(220,150,80,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(L.x, ground + 16, rx, rx * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();

      // 地面上的倒影：一束被拉长的暖光
      const rw = 10 + 16 * L.level;
      const rg = ctx.createLinearGradient(0, ground - 4, 0, ground + 96);
      rg.addColorStop(0, `rgba(255,206,140,${0.14 * L.level * u})`);
      rg.addColorStop(1, 'rgba(220,150,80,0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.moveTo(L.x - rw, ground - 2);
      ctx.lineTo(L.x + rw, ground - 2);
      ctx.lineTo(L.x + rw * 0.3, ground + 90);
      ctx.lineTo(L.x - rw * 0.3, ground + 90);
      ctx.closePath();
      ctx.fill();
    }
    for (const L of lights) {
      const inten = 0.09 + 0.2 * L.level * L.flicker;
      const g = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
      g.addColorStop(0, `rgba(255,224,158,${inten})`);
      g.addColorStop(0.35, `rgba(240,186,110,${inten * 0.45})`);
      g.addColorStop(1, 'rgba(200,140,70,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(L.x, L.y, L.r, 0, Math.PI * 2);
      ctx.fill();
    }
    // 焰心
    for (const L of lights) {
      const h = 6 + 4 * L.level * L.flicker;
      ctx.fillStyle = `rgba(255,238,190,${0.7 * L.level})`;
      ctx.beginPath();
      ctx.ellipse(L.x, L.y - h * 0.3, 2.2 + L.level, h * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,252,236,${0.85 * L.level})`;
      ctx.beginPath();
      ctx.ellipse(L.x, L.y - h * 0.25, 1.1, h * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      // 烛身被照亮的一小段
      ctx.fillStyle = `rgba(255,226,170,${0.16 * L.level})`;
      ctx.beginPath();
      ctx.ellipse(L.x, L.y + 12, 5.5, 15, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (!reduced) dust(ctx, state, view, amb);
    return lights;
  }

  /* 氛围着色：一整幅画面（静止底图 + 活动人物）共用同一层乘算。
     烛初上则屋暗，烛明则暖，天将明则冷。 */
  function tint(ctx, amb, w, h) {
    // 绢地本身已是旧褐色，夜色只再压一层：烛光把它从"掌灯"推到"烛明"
    const b = clamp(0.64 + 0.3 * amb.flame - 0.12 * amb.dawn, 0.4, 1);
    const top = b * 0.8;
    const mid = b * 1.0;
    const bot = b * 0.86;
    const warmShift = 1 - 0.8 * amb.dawn;
    const col = (k) => `rgb(${Math.round(255 * k)},${Math.round((255 - 17 * warmShift) * k)},${Math.round((255 - 47 * warmShift) * k)})`;

    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, col(top));
    g.addColorStop(0.5, col(mid));
    g.addColorStop(1, col(bot));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // 暖色偏移：烛光把整幅画染暖
    if (amb.warm > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.12 * amb.warm;
      ctx.fillStyle = '#ffb45c';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // 天将明：冷色从顶上透进来
    if (amb.dawn > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.46 * amb.dawn;
      const g2 = ctx.createLinearGradient(0, 0, 0, h);
      g2.addColorStop(0, 'rgba(150,175,190,.95)');
      g2.addColorStop(0.7, 'rgba(200,190,170,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // 更深的角落：四边压暗
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.16 + 0.18 * (1 - amb.flame);
    const v = ctx.createRadialGradient(w / 2, h * 0.55, Math.min(w, h) * 0.2,
      w / 2, h * 0.55, Math.max(w, h) * 0.78);
    v.addColorStop(0, 'rgba(255,255,255,1)');
    v.addColorStop(1, 'rgba(88,66,46,1)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // 光柱里的浮尘
  function dust(ctx, state, view, amb) {
    if (amb.flame < 0.2) return;
    const t = state.time;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 60; i++) {
      const base = seed(i * 3.7);
      const x = view.x0 + ((base * 1700 + t * (4 + base * 8)) % (view.x1 - view.x0 + 200)) - 100;
      const y = 80 + seed(i * 9.1) * 720 + Math.sin(t * 0.6 + i) * 22;
      const a = 0.05 + 0.12 * seed(i * 5.3) * amb.flame;
      ctx.fillStyle = `rgba(255,232,182,${a})`;
      ctx.beginPath();
      ctx.arc(x, y, 0.8 + seed(i * 2.1) * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 香炉的烟：Canvas 版本，同时作为 WebGL 失败时的回退
  function incense(ctx, state, view) {
    const amb = state.amb;
    if (amb.smoke < 0.03) return;
    const t = state.time;
    const burners = HX.plate.BURNERS;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const [bx, by] of burners) {
      if (bx < view.x0 - 260 || bx > view.x1 + 260) continue;
      for (let i = 0; i < 14; i++) {
        const u = i / 14;
        const rise = ((t * 16 + i * 26) % 320) * (0.6 + amb.smoke * 0.6);
        const y = by - rise;
        const drift = Math.sin((y + i * 30) * 0.014 + t * 0.5) * (14 + u * 40);
        const a = (1 - rise / 320) * 0.07 * (0.3 + amb.smoke);
        ctx.fillStyle = `rgba(246,240,224,${a})`;
        ctx.beginPath();
        ctx.ellipse(bx + drift, y, 16 + u * 34, 12 + u * 22, drift * 0.004, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  HX.light = {
    STAGES, DURATION, ambience, NightClock, render, tint, incense,
    collectLights, candleLevel
  };
})(typeof window !== 'undefined' ? window : globalThis);
