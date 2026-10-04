/* 看原图：全卷原作 + 朱批。
   原图按高度装进视口，自右向左读；画上的朱印小签是批注点，指上去（触屏为点按）
   一张旧纸批注从旁边展开，一根朱线连回画上那一处。点按可钉住，Esc 掩卷。
   坐标全用原图像素（annotations.js），屏幕位置 = (原图坐标 − 视口左沿) × 比例。 */
(function (root) {
  'use strict';
  const HX = (root.HX = root.HX || {});
  const A = HX.annotations;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const DIGIT = '〇一二三四五六七八九';
  // 竖排里阿拉伯数字会躺倒，换成汉字数码
  const hanDigits = (s) => s.replace(/\d/g, (d) => DIGIT[d]);
  function cn(n) {
    if (n < 10) return DIGIT[n];
    const t = Math.floor(n / 10), u = n % 10;
    return (t > 1 ? DIGIT[t] : '') + '十' + (u ? DIGIT[u] : '');
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const txt = (s) => esc(hanDigits(s));

  // 原图上的几段装裱（自左向右）
  const PARTS = [
    { name: '拖尾 · 题跋', x0: 0, x1: 4050 },
    { name: '画心', x0: 4240, x1: 10035 },
    { name: '隔水', x0: 10035, x1: 10560 },
    { name: '引首', x0: 10600, x1: A.W }
  ];

  // 顶栏与小地图占去的高度：随屏幕变化，打开与改变尺寸时实测
  let TOP = 64, BOTTOM = 84;
  const MOUNT = 18;

  const st = {
    open: false, ready: false,
    x: 0, y: 0, scale: 1, fit: 1, zoom: 1,
    vw: 0, vh: 0,
    vel: 0, target: null, travel: false,
    drag: null, suppressClick: false,
    active: null, pinned: false, pins: true,
    card: { w: 0, h: 0 },
    showTimer: 0, hideTimer: 0, raf: 0, last: 0,
    opts: {}
  };
  const dom = {};

  /* ---------------- 搭建 ---------------- */

  function build() {
    const el = dom.root = document.getElementById('original');
    el.innerHTML = `
      <div class="orig-bar">
        <div class="orig-heading">
          <h2 id="orig-title">原作 · 韩熙载夜宴图</h2>
          <p>宋摹本 · 绢本设色 · 故宫博物院藏</p>
        </div>
        <div class="orig-actions">
          <button class="tool" type="button" data-act="prev" title="上一则（自右向左）">上一则</button>
          <button class="tool" type="button" data-act="next" title="下一则">下一则</button>
          <button class="tool" type="button" data-act="pins" aria-pressed="true">朱批</button>
          <button class="tool" type="button" data-act="in" aria-label="放大原图">＋</button>
          <button class="tool" type="button" data-act="out" aria-label="缩小原图">－</button>
          <button class="tool orig-close" type="button" data-act="close">回到长卷</button>
        </div>
      </div>
      <div class="orig-view">
        <div class="orig-track">
          <img class="orig-img" alt="《韩熙载夜宴图》全卷原作，自右向左：引首、隔水、画心五段、拖尾题跋。" draggable="false" decoding="async">
          <div class="orig-hots"></div>
        </div>
      </div>
      <svg class="orig-lead" aria-hidden="true"><path/><circle r="3.2"/></svg>
      <aside class="orig-note" role="note" aria-live="polite"></aside>
      <div class="orig-map">
        <div class="orig-map-strip">
          <canvas></canvas>
          <div class="orig-map-ticks"></div>
          <div class="orig-map-win"></div>
        </div>
        <div class="orig-map-parts"></div>
      </div>
      <p class="orig-tip">拖动或滚轮移卷 · 指向朱印看批注，点按钉住 · Esc 回到长卷</p>`;

    dom.view = el.querySelector('.orig-view');
    dom.bar = el.querySelector('.orig-bar');
    dom.mapBox = el.querySelector('.orig-map');
    dom.tip = el.querySelector('.orig-tip');
    if (root.matchMedia && root.matchMedia('(pointer: coarse)').matches) {
      dom.tip.textContent = '拖动移卷 · 点朱印看批注 · 双指缩放';
    }
    dom.track = el.querySelector('.orig-track');
    dom.img = el.querySelector('.orig-img');
    dom.hots = el.querySelector('.orig-hots');
    dom.lead = el.querySelector('.orig-lead');
    dom.leadPath = dom.lead.querySelector('path');
    dom.leadDot = dom.lead.querySelector('circle');
    dom.note = el.querySelector('.orig-note');
    dom.map = el.querySelector('.orig-map-strip');
    dom.mapCanvas = dom.map.querySelector('canvas');
    dom.mapTicks = el.querySelector('.orig-map-ticks');
    dom.mapWin = el.querySelector('.orig-map-win');
    dom.mapParts = el.querySelector('.orig-map-parts');
    dom.pinsBtn = el.querySelector('[data-act="pins"]');
    dom.closeBtn = el.querySelector('[data-act="close"]');

    for (const n of A.NOTES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'orig-hot';
      b.dataset.id = n.id;
      b.style.left = (n.box[0] / A.W * 100) + '%';
      b.style.top = (n.box[1] / A.H * 100) + '%';
      b.style.width = ((n.box[2] - n.box[0]) / A.W * 100) + '%';
      b.style.height = ((n.box[3] - n.box[1]) / A.H * 100) + '%';
      // 框套框时小的在上，人物不会被整段的大框吃掉
      b.style.zIndex = String(1000 - Math.round(Math.sqrt((n.box[2] - n.box[0]) * (n.box[3] - n.box[1])) / 10));
      b.setAttribute('aria-label', `第${cn(n.index + 1)}则批注：${n.title}`);
      const pin = document.createElement('span');
      pin.className = 'orig-pin';
      pin.dataset.kind = n.kind;
      pin.textContent = cn(n.index + 1);
      pin.style.left = ((n.pin[0] - n.box[0]) / (n.box[2] - n.box[0]) * 100) + '%';
      pin.style.top = ((n.pin[1] - n.box[1]) / (n.box[3] - n.box[1]) * 100) + '%';
      b.appendChild(pin);
      n.el = b;
      n.pinEl = pin;
      dom.hots.appendChild(b);

      b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') hoverIn(n); });
      b.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hoverOut(); });
      b.addEventListener('focus', () => { if (!st.drag) focusNote(n, false); });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (st.suppressClick) return;
        if (st.active === n && st.pinned) { hide(); return; }
        show(n, true);
      });

      const tick = document.createElement('i');
      tick.style.left = (n.pin[0] / A.W * 100) + '%';
      tick.dataset.id = n.id;
      dom.mapTicks.appendChild(tick);
    }

    for (const p of PARTS) {
      const s = document.createElement('span');
      s.textContent = p.name;
      s.style.left = (p.x0 / A.W * 100) + '%';
      s.style.width = ((p.x1 - p.x0) / A.W * 100) + '%';
      dom.mapParts.appendChild(s);
    }

    dom.note.addEventListener('pointerenter', () => clearTimeout(st.hideTimer));
    dom.note.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !st.pinned) hoverOut(); });
    dom.note.addEventListener('click', (e) => {
      const b = e.target.closest('[data-note]');
      if (!b) return;
      const act = b.dataset.note;
      if (act === 'close') hide();
      else if (act === 'prev') step(-1);
      else if (act === 'next') step(1);
      else if (act === 'enter') enter(st.active);
    });

    el.querySelector('.orig-actions').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'close') close();
      else if (act === 'prev') step(-1);
      else if (act === 'next') step(1);
      else if (act === 'pins') togglePins();
      else if (act === 'in') zoomBy(1.35);
      else if (act === 'out') zoomBy(1 / 1.35);
    });

    bindPan();
    bindMap();
    root.addEventListener('keydown', onKey, true);
    root.addEventListener('resize', () => { if (st.open) layout(true); });

    dom.img.addEventListener('load', () => { st.ready = true; drawMap(); });
  }

  /* ---------------- 几何 ---------------- */

  function layout(keepCenter) {
    const cx = st.x + st.vw / 2 / st.scale;
    const r = dom.view.getBoundingClientRect();
    const keep = keepCenter && st.vw;
    st.vw = r.width;
    st.vh = r.height;
    sizeMap();
    TOP = Math.ceil(dom.bar.getBoundingClientRect().bottom - r.top) + 4;
    BOTTOM = Math.ceil(r.bottom - dom.mapBox.getBoundingClientRect().top) + 10;
    const area = Math.max(120, st.vh - TOP - BOTTOM - MOUNT * 2);
    // 竖屏按高度装满只看得到一窄条：缩小一些，让一屏至少横跨约 650 原图像素
    const portrait = st.vh > st.vw * 1.15;
    const byHeight = area / A.H;
    st.fit = clamp(portrait ? Math.min(byHeight, Math.max(st.vw / 650, 0.62 * byHeight)) : byHeight, 0.3, 3);
    st.scale = st.fit * st.zoom;
    dom.track.style.width = (A.W * st.scale) + 'px';
    dom.track.style.height = (A.H * st.scale) + 'px';
    if (keep) st.x = cx - st.vw / 2 / st.scale;
    clampPos();
    apply();
  }

  const spanX = () => st.vw / st.scale;
  function clampPos() {
    const m = 80 / st.scale;
    st.x = clamp(st.x, -m, Math.max(-m, A.W - spanX() + m));
    const area = st.vh - TOP - BOTTOM;
    const hh = A.H * st.scale;
    if (hh + MOUNT * 2 <= area) st.y = 0;
    else {
      const lim = (hh + MOUNT * 2 - area) / 2 / st.scale;
      st.y = clamp(st.y, -lim, lim);
    }
  }

  const trackTop = () => TOP + (st.vh - TOP - BOTTOM - A.H * st.scale) / 2 - st.y * st.scale;
  const toScreen = (ox, oy) => [(ox - st.x) * st.scale, trackTop() + oy * st.scale];

  function apply() {
    dom.track.style.transform = `translate3d(${(-st.x * st.scale).toFixed(2)}px,${trackTop().toFixed(2)}px,0)`;
    const mw = dom.map.clientWidth;
    dom.mapWin.style.transform = `translateX(${(st.x / A.W * mw).toFixed(1)}px)`;
    dom.mapWin.style.width = Math.max(6, spanX() / A.W * mw) + 'px';
    placeNote();
  }

  /* ---------------- 动画循环 ---------------- */

  function loop(now) {
    st.raf = 0;
    if (!st.open) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - (st.last || now)) / 1000));
    st.last = now;
    let moving = false;
    if (st.target != null) {
      const d = st.target - st.x;
      st.x += d * (1 - Math.exp(-dt * 5.5));
      if (Math.abs(d) * st.scale < 0.6) { st.x = st.target; st.target = null; st.travel = false; }
      moving = true;
    } else if (!st.drag && Math.abs(st.vel) > 0.004) {
      st.x += st.vel * dt * 1000;
      st.vel *= Math.exp(-dt * 3.2);
      moving = true;
    }
    if (moving) { clampPos(); apply(); kick(); }
  }

  function kick() {
    if (!st.raf && st.open) st.raf = requestAnimationFrame(loop);
  }

  function glideTo(x) {
    st.vel = 0;
    st.target = clamp(x, -80 / st.scale, A.W - spanX() + 80 / st.scale);
    st.last = 0;
    kick();
  }

  /* ---------------- 拖动、滚轮、缩放 ---------------- */

  function bindPan() {
    const v = dom.view;
    const pts = new Map();
    const pinchInfo = () => {
      const [a, b] = [...pts.values()];
      const left = v.getBoundingClientRect().left;
      return { d: Math.max(20, Math.hypot(a[0] - b[0], a[1] - b[1])), mx: (a[0] + b[0]) / 2 - left };
    };
    v.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      st.vel = 0;
      st.target = null;
      st.travel = false;
      if (pts.size === 2) {
        // 双指：缩放，中点跟着手指走；不再当作拖动或点按
        st.drag = null;
        st.suppressClick = true;
        const p = pinchInfo();
        st.pinch = { d0: p.d, z0: st.zoom, mx: p.mx };
        for (const id of pts.keys()) { try { v.setPointerCapture(id); } catch (_) { /* 无活动指针 */ } }
        return;
      }
      if (pts.size > 2) return;
      st.drag = {
        id: e.pointerId, sx: e.clientX, sy: e.clientY, x0: st.x, y0: st.y, lx: e.clientX,
        lt: performance.now(), moved: false, slop: e.pointerType === 'mouse' ? 5 : 10
      };
      st.suppressClick = false;
    });
    v.addEventListener('pointermove', (e) => {
      if (pts.has(e.pointerId)) pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (st.pinch && pts.size >= 2) {
        const p = pinchInfo();
        zoomTo(st.pinch.z0 * p.d / st.pinch.d0, p.mx);
        st.x -= (p.mx - st.pinch.mx) / st.scale;
        st.pinch.mx = p.mx;
        clampPos();
        apply();
        return;
      }
      const d = st.drag;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) > d.slop) {
        d.moved = true;
        try { v.setPointerCapture(e.pointerId); } catch (_) { /* 无活动指针 */ }
        v.classList.add('dragging');
      }
      if (!d.moved) return;
      const now = performance.now();
      const ddt = Math.max(1, now - d.lt);
      st.vel = st.vel * 0.6 + (-(e.clientX - d.lx) / st.scale / ddt) * 0.4;
      d.lx = e.clientX;
      d.lt = now;
      st.x = d.x0 - dx / st.scale;
      st.y = d.y0 - dy / st.scale;
      clampPos();
      apply();
    });
    const end = (e) => {
      pts.delete(e.pointerId);
      if (st.pinch) {
        if (pts.size < 2) {
          st.pinch = null;
          setTimeout(() => { st.suppressClick = false; }, 0);
        }
        return;
      }
      const d = st.drag;
      if (!d || d.id !== e.pointerId) return;
      st.drag = null;
      v.classList.remove('dragging');
      if (d.moved) {
        st.suppressClick = true;
        setTimeout(() => { st.suppressClick = false; }, 0);
        if (performance.now() - d.lt > 90) st.vel = 0;
        st.last = 0;
        kick();
      } else if (!e.target.closest('.orig-hot') && st.pinned) {
        hide();
      }
    };
    v.addEventListener('pointerup', end);
    v.addEventListener('pointercancel', end);
    v.addEventListener('wheel', (e) => {
      e.preventDefault();
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? st.vw : 1;
      if (e.ctrlKey) {
        const r = v.getBoundingClientRect();
        zoomBy(Math.exp(-e.deltaY * k * 0.004), e.clientX - r.left);
        return;
      }
      // 竖滚轮向下 = 往下读 = 卷向左展开
      st.target = null;
      st.vel = 0;
      st.x += (e.deltaX - e.deltaY) * k / st.scale;
      clampPos();
      apply();
    }, { passive: false });
  }

  function zoomBy(f, anchor) {
    zoomTo(st.zoom * f, anchor);
  }

  function zoomTo(z, anchor) {
    const ax = anchor == null ? st.vw / 2 : anchor;
    const ox = st.x + ax / st.scale;
    st.zoom = clamp(z, 1, 4);
    st.scale = st.fit * st.zoom;
    dom.track.style.width = (A.W * st.scale) + 'px';
    dom.track.style.height = (A.H * st.scale) + 'px';
    st.x = ox - ax / st.scale;
    st.target = null;
    clampPos();
    apply();
  }

  /* ---------------- 小地图 ---------------- */

  function sizeMap() {
    const w = Math.min(st.vw - 48, 980);
    dom.map.style.width = w + 'px';
    dom.map.style.height = Math.round(w * A.H / A.W) + 'px';
    dom.mapParts.style.width = w + 'px';
    if (st.ready) drawMap();
  }

  function drawMap() {
    const c = dom.mapCanvas;
    const w = dom.map.clientWidth, h = dom.map.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(root.devicePixelRatio || 1, 2);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(dom.img, 0, 0, c.width, c.height);
  }

  function bindMap() {
    let dragging = false;
    const go = (e, smooth) => {
      const r = dom.map.getBoundingClientRect();
      const ox = clamp((e.clientX - r.left) / r.width, 0, 1) * A.W;
      const x = ox - spanX() / 2;
      if (smooth) glideTo(x);
      else { st.target = null; st.vel = 0; st.x = x; clampPos(); apply(); }
    };
    dom.map.addEventListener('pointerdown', (e) => {
      dragging = true;
      try { dom.map.setPointerCapture(e.pointerId); } catch (_) { /* 无活动指针 */ }
      go(e, true);
    });
    dom.map.addEventListener('pointermove', (e) => { if (dragging && e.buttons) go(e, false); });
    const stop = () => { dragging = false; };
    dom.map.addEventListener('pointerup', stop);
    dom.map.addEventListener('pointercancel', stop);
  }

  /* ---------------- 批注卡 ---------------- */

  function hoverIn(n) {
    clearTimeout(st.hideTimer);
    clearTimeout(st.showTimer);
    if (st.pinned && st.active !== n) return;
    st.showTimer = setTimeout(() => show(n, false), st.active ? 40 : 90);
  }

  function hoverOut() {
    clearTimeout(st.showTimer);
    if (st.pinned) return;
    clearTimeout(st.hideTimer);
    st.hideTimer = setTimeout(hide, 320);
  }

  function cardHTML(n) {
    const links = n.links.map((l) =>
      `<a href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>`).join('');
    const quote = n.quote
      ? `<blockquote><p>${txt(n.quote.text)}</p><cite>${txt(n.quote.src)}</cite></blockquote>` : '';
    const enterBtn = n.enter ? '<button type="button" class="note-enter" data-note="enter">入画</button>' : '';
    return `
      <div class="note-paper">
        <div class="note-text">
          <header class="note-head">
            <span class="note-kind">${esc(n.kind)}</span>
            <h3>${txt(n.title)}</h3>
          </header>
          <p class="note-pi"><b>批</b>${txt(n.pi)}</p>
          ${quote}
          ${n.text.map((p) => `<p>${txt(p)}</p>`).join('')}
          <nav class="note-links" aria-label="延伸阅读">${links}${enterBtn}</nav>
        </div>
        <span class="note-seal" aria-hidden="true">${cn(n.index + 1)}</span>
      </div>
      <div class="note-foot">
        <button type="button" data-note="prev" aria-label="上一则">‹ 上一则</button>
        <span>${cn(n.index + 1)} / ${cn(A.NOTES.length)}</span>
        <button type="button" data-note="next" aria-label="下一则">下一则 ›</button>
        <button type="button" data-note="close" class="note-x" aria-label="收起批注">收起</button>
      </div>`;
  }

  function show(n, pin) {
    clearTimeout(st.hideTimer);
    clearTimeout(st.showTimer);
    const same = st.active === n && dom.note.classList.contains('on');
    if (st.active && st.active !== n) st.active.el.classList.remove('on');
    st.active = n;
    st.pinned = !!pin || (st.pinned && same);
    n.el.classList.add('on');
    dom.root.classList.toggle('pinned', st.pinned);
    if (!same) {
      dom.note.classList.remove('on');
      dom.note.innerHTML = cardHTML(n);
      dom.note.dataset.kind = n.kind;
      // 先量尺寸，再在下一帧展开，让展开动画从头走
      st.card.w = dom.note.offsetWidth;
      st.card.h = dom.note.offsetHeight;
      placeNote();
      void dom.note.offsetWidth;
      dom.note.classList.add('on');
      dom.lead.classList.remove('on');
      void dom.lead.getBoundingClientRect();
      dom.lead.classList.add('on');
    }
    for (const t of dom.mapTicks.children) t.classList.toggle('on', t.dataset.id === n.id);
  }

  function hide() {
    clearTimeout(st.hideTimer);
    clearTimeout(st.showTimer);
    if (st.active) st.active.el.classList.remove('on');
    st.active = null;
    st.pinned = false;
    dom.root.classList.remove('pinned');
    dom.note.classList.remove('on');
    dom.lead.classList.remove('on');
    for (const t of dom.mapTicks.children) t.classList.remove('on');
  }

  function placeNote() {
    const n = st.active;
    if (!n) return;
    const [px, py] = toScreen(n.pin[0], n.pin[1]);
    if (!st.travel && (px < -30 || px > st.vw + 30)) { hide(); return; }
    const narrow = st.vw < 700;
    const w = st.card.w, h = st.card.h;
    let x, y, ax, ay;
    if (narrow) {
      // 窄屏把卡片铺在画的上半或下半：批注点在下半就放上面，免得盖住所指之处
      x = (st.vw - w) / 2;
      const up = py > (TOP + st.vh - BOTTOM) / 2;
      y = up ? TOP + 6 : st.vh - BOTTOM - h - 6;
      ax = clamp(px, x + 20, x + w - 20);
      ay = up ? y + h : y;
      dom.note.dataset.side = 'left';
    } else {
      const left = px > st.vw * 0.5;
      x = left ? px - 46 - w : px + 46;
      x = clamp(x, 14, st.vw - w - 14);
      y = clamp(py - h * 0.42, TOP + 6, st.vh - BOTTOM - h - 6);
      ax = left ? x + w : x;
      ay = clamp(py, y + 26, y + h - 26);
      dom.note.dataset.side = left ? 'left' : 'right';
    }
    dom.note.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
    const mx = (px + ax) / 2;
    dom.leadPath.setAttribute('d', `M${px.toFixed(1)} ${py.toFixed(1)} C${mx.toFixed(1)} ${py.toFixed(1)} ${mx.toFixed(1)} ${ay.toFixed(1)} ${ax.toFixed(1)} ${ay.toFixed(1)}`);
    dom.leadDot.setAttribute('cx', px.toFixed(1));
    dom.leadDot.setAttribute('cy', py.toFixed(1));
  }

  // 移卷到某则批注并展开
  function focusNote(n, pin) {
    const [px] = toScreen(n.pin[0], n.pin[1]);
    const inView = px > st.vw * 0.12 && px < st.vw * 0.88;
    if (!inView) {
      // 批注点停在视口右半，卡片就在它左边展开，正好顺着阅读方向
      st.travel = true;
      glideTo(n.pin[0] - spanX() * (st.vw < 700 ? 0.5 : 0.64));
    }
    show(n, pin);
  }

  function step(dir) {
    let i;
    if (st.active) i = st.active.index + dir;
    else {
      // 从视口中央附近的那一则开始
      const cx = st.x + spanX() / 2;
      let best = 0, bd = Infinity;
      A.NOTES.forEach((n, k) => { const d = Math.abs(n.pin[0] - cx); if (d < bd) { bd = d; best = k; } });
      i = best;
    }
    if (i < 0 || i >= A.NOTES.length) return;
    focusNote(A.NOTES[i], true);
  }

  function enter(n) {
    if (!n || !st.opts.onEnter) return;
    const cx = (n.box[0] + n.box[2]) / 2;
    close();
    st.opts.onEnter((cx - 4080) * 1.8);
  }

  function togglePins() {
    st.pins = !st.pins;
    dom.root.classList.toggle('no-pins', !st.pins);
    dom.pinsBtn.setAttribute('aria-pressed', String(st.pins));
    if (!st.pins) hide();
  }

  /* ---------------- 键盘 ---------------- */

  function onKey(e) {
    if (!st.open) return;
    const k = e.key;
    if (k === 'Escape') {
      e.preventDefault();
      if (st.pinned) hide(); else close();
    } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
      glideTo((st.target ?? st.x) + (k === 'ArrowLeft' ? -1 : 1) * spanX() * 0.35);
    } else if (k === 'PageUp' || k === 'PageDown') {
      e.preventDefault();
      step(k === 'PageDown' ? 1 : -1);
    } else if (k === 'Home') { e.preventDefault(); glideTo(A.W); }
    else if (k === 'End') { e.preventDefault(); glideTo(-100); }
    else if (k === '+' || k === '=') zoomBy(1.25);
    else if (k === '-' || k === '_') zoomBy(0.8);
    else return;
    e.stopPropagation();
  }

  /* ---------------- 开合 ---------------- */

  function open(opts = {}) {
    if (!dom.root) build();
    if (st.open) return;
    if (!dom.img.getAttribute('src')) dom.img.src = A.IMAGE;
    st.open = true;
    dom.root.hidden = false;
    document.body.classList.add('orig-open');
    st.zoom = 1;
    st.vw = 0;
    layout(false);
    // 从长卷当前所在处打开；不知道就从卷首（右端）开始
    if (opts.worldX != null) st.x = opts.worldX / 1.8 + 4080 - spanX() / 2;
    else st.x = A.W;
    clampPos();
    apply();
    requestAnimationFrame(() => dom.root.classList.add('on'));
    dom.closeBtn.focus({ preventScroll: true });
    if (st.opts.onOpen) st.opts.onOpen();
  }

  function close() {
    if (!st.open) return;
    hide();
    st.open = false;
    dom.root.classList.remove('on');
    document.body.classList.remove('orig-open');
    setTimeout(() => { if (!st.open) dom.root.hidden = true; }, 480);
    if (st.opts.onClose) st.opts.onClose();
  }

  HX.original = {
    init(opts) { st.opts = opts || {}; },
    open, close,
    isOpen: () => st.open,
    show: (id) => { const n = A.NOTES.find((x) => x.id === id); if (n) focusNote(n, true); },
    state: st
  };
})(typeof window !== 'undefined' ? window : globalThis);
