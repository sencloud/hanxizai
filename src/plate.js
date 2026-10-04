/* 底图：旧绢与素面陈设。这一层是静止的——人物、器物、光、烟、声在其上变化。

   原作没有梁柱地面，人物直接立在绢地上，段与段之间靠屏风隔开。底图因此只有：
   取自原画的旧绢底色、素面的屏风立柱与大屏风、歇息段的烛台、听乐段的鼓架，
   以及两端留白处的题签。带细节的床榻、桌案、画屏都是素材层，按原位逐帧绘制，
   以便与人物前后遮挡。 */
(function (root) {
  'use strict';
  const HX = (root.HX = root.HX || {});
  const U = HX.util;
  const P = HX.palette;
  const L = HX.layout;
  const { wx, wy } = L;

  const W = L.W;
  const H = L.H;
  const SECTIONS = L.SECTIONS;

  // 灯烛：底图与光照共用同一份数据，焰的位置才不会错位
  const CANDLES = L.FIXTURES.candles.map((c) => ({
    id: c.id,
    seedId: c.seedId,
    section: c.section,
    x: wx(c.o),
    top: wy(c.top),
    floor: wy(c.base),
    tips: [[wx(c.o), wy(c.top) - 8]]
  }));

  // 烟与水汽的来处：听乐案上温酒的注子，歇息段的烛芯
  function burners(atlas) {
    const out = [];
    const tables = L.ITEMS.find((i) => i.id === 'l-tables');
    const pl = atlas && atlas['l-tables'] ? L.place(tables, atlas) : null;
    if (pl && HX.sprite) {
      const bank = { meta: (id) => atlas[id] };
      for (const k of ['ewer-a', 'ewer-b']) {
        const p = HX.sprite.anchor(bank, 'l-tables', pl, {}, k);
        if (p) out.push(p);
      }
    }
    for (const c of CANDLES) out.push([c.tips[0][0], c.tips[0][1] - 10]);
    return out;
  }
  const BURNERS = burners(HX.figureAtlas);

  function ink(ctx, w, a = 0.7) {
    ctx.strokeStyle = P.rgba(P.C.ink, a);
    ctx.lineWidth = w;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
  }

  /* ---------------- 旧绢 ---------------- */

  // 底色取自原画的空白绢地：上部约 (140,100,42)，下部约 (110,77,32)；略提亮，留给夜色去压
  function agedSilk(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgb(150,110,54)');
    g.addColorStop(0.55, 'rgb(138,99,46)');
    g.addColorStop(1, 'rgb(118,84,38)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 经纬
    ctx.save();
    ctx.globalAlpha = 0.06;
    for (let y = 0; y < H; y += 3) {
      ctx.strokeStyle = U.seed(y) > 0.5 ? '#d8b878' : '#5a3e1c';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(0, y + U.seed(y * 1.7) * 1.4);
      ctx.lineTo(W, y + U.seed(y * 2.3) * 1.4);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.04;
    for (let x = 0; x < W; x += 4) {
      ctx.strokeStyle = U.seed(x * 3.1) > 0.5 ? '#d8b878' : '#5a3e1c';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(x + U.seed(x) * 1.6, 0);
      ctx.lineTo(x + U.seed(x * 1.9) * 1.6, H);
      ctx.stroke();
    }
    ctx.restore();

    // 年代斑驳：大片的深浅水渍 + 竖向的卷折痕
    ctx.save();
    for (let i = 0; i < 260; i++) {
      const x = U.seed(i * 5.3) * W;
      const y = U.seed(i * 7.9 + 2) * H;
      const r = 30 + U.seed(i * 3.7) * 220;
      const dark = U.seed(i * 2.9) > 0.45;
      const a = 0.03 + U.seed(i * 11.1) * 0.05;
      const gg = ctx.createRadialGradient(x, y, 0, x, y, r);
      gg.addColorStop(0, dark ? `rgba(70,46,18,${a})` : `rgba(196,150,82,${a * 0.8})`);
      gg.addColorStop(1, 'rgba(120,84,40,0)');
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let x = 140; x < W; x += 260 + U.seed(x) * 220) {
      const a = 0.05 + U.seed(x * 1.3) * 0.06;
      const cg = ctx.createLinearGradient(x - 8, 0, x + 8, 0);
      cg.addColorStop(0, 'rgba(60,40,16,0)');
      cg.addColorStop(0.5, `rgba(60,40,16,${a})`);
      cg.addColorStop(1, 'rgba(60,40,16,0)');
      ctx.fillStyle = cg;
      ctx.fillRect(x - 8, 0, 16, H);
    }
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(52,36,16,${0.04 + U.seed(i) * 0.06})`;
      ctx.beginPath();
      ctx.arc(U.seed(i * 2.7 + 40) * W, U.seed(i * 4.1 + 9) * H, 0.6 + U.seed(i * 6.1) * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function edges(ctx) {
    const top = ctx.createLinearGradient(0, 0, 0, H * 0.12);
    top.addColorStop(0, 'rgba(48,30,12,.42)');
    top.addColorStop(1, 'rgba(48,30,12,0)');
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, W, H * 0.12);
    const bottom = ctx.createLinearGradient(0, H * 0.88, 0, H);
    bottom.addColorStop(0, 'rgba(48,30,12,0)');
    bottom.addColorStop(1, 'rgba(48,30,12,.46)');
    ctx.fillStyle = bottom;
    ctx.fillRect(0, H * 0.88, W, H * 0.12);
  }

  /* ---------------- 素面陈设 ---------------- */

  // 屏风立柱（听乐与观舞之间）：青绿的柱身，墨黑的抱鼓座
  function post(ctx, p) {
    const x0 = wx(p.o[0]), x1 = wx(p.o[1]);
    const [fx0, fx1, fy0, fy1] = p.foot;
    ctx.save();
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, P.shade(p.color, -0.12));
    g.addColorStop(0.45, p.color);
    g.addColorStop(1, P.shade(p.color, -0.2));
    ctx.fillStyle = g;
    ctx.fillRect(x0, wy(p.top), x1 - x0, wy(fy1) - wy(p.top));
    ink(ctx, 1.4, 0.55);
    ctx.strokeRect(x0, wy(p.top), x1 - x0, wy(fy1) - wy(p.top));
    // 座：两翼收窄的墨块
    const cx = (x0 + x1) / 2;
    ctx.fillStyle = '#211a14';
    ctx.beginPath();
    ctx.moveTo(cx - 10, wy(fy0));
    ctx.quadraticCurveTo(cx - 30, wy(fy0) + 60, wx(fx0), wy(fy1));
    ctx.lineTo(wx(fx1), wy(fy1));
    ctx.quadraticCurveTo(cx + 30, wy(fy0) + 60, cx + 10, wy(fy0));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 大屏风（歇息与清吹之间）：素绢屏心，墨漆边框与两只抱鼓足。原作屏心满是后世的收藏印，这里不画。
  function bigScreen(ctx, s) {
    const x0 = wx(s.o[0]), x1 = wx(s.o[1]);
    const y0 = wy(s.top), y1 = wy(s.bottom);
    const frame = 16;
    ctx.save();
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, '#9a9b7c');
    g.addColorStop(0.6, '#a8a585');
    g.addColorStop(1, '#8f8c6c');
    ctx.fillStyle = g;
    ctx.fillRect(x0 + frame, y0, x1 - x0 - frame * 2, y1 - y0 - frame);
    // 屏心的旧色与绢纹
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 70; i++) {
      const x = x0 + frame + U.seed(i * 3.3 + 7) * (x1 - x0 - frame * 2);
      const y = y0 + U.seed(i * 5.1 + 3) * (y1 - y0 - frame);
      const r = 14 + U.seed(i * 1.7) * 60;
      const gg = ctx.createRadialGradient(x, y, 0, x, y, r);
      gg.addColorStop(0, `rgba(96,84,52,${0.08 + U.seed(i) * 0.1})`);
      gg.addColorStop(1, 'rgba(96,84,52,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#1d1712';
    ctx.fillRect(x0, y0, frame, y1 - y0);
    ctx.fillRect(x1 - frame, y0, frame, y1 - y0);
    ctx.fillRect(x0, y1 - frame, x1 - x0, frame);
    ink(ctx, 1, 0.4);
    ctx.strokeRect(x0 + frame + 10, y0 + 10, x1 - x0 - frame * 2 - 20, y1 - y0 - frame - 20);
    // 抱鼓足
    for (const [a, b] of s.feet) {
      const fa = wx(a), fb = wx(b), fc = (fa + fb) / 2;
      ctx.fillStyle = '#1d1712';
      ctx.beginPath();
      ctx.moveTo(fc - 12, y1 - 70);
      ctx.quadraticCurveTo(fa + 6, y1 - 40, fa, y1 + 26);
      ctx.lineTo(fb, y1 + 26);
      ctx.quadraticCurveTo(fb - 6, y1 - 40, fc + 12, y1 - 70);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // 烛台（歇息段）：细高的灯檠，中段一道承盘，顶上一盏烛
  function candleStand(ctx, c) {
    const x = c.x, top = c.top, base = c.floor;
    ctx.save();
    ctx.fillStyle = '#4a3c2a';
    ctx.fillRect(x - 3, top + 14, 6, base - top - 20);
    ink(ctx, 0.9, 0.5);
    ctx.strokeRect(x - 3, top + 14, 6, base - top - 20);
    for (const [y, r] of [[top + 14, 22], [top + (base - top) * 0.36, 30]]) {
      ctx.fillStyle = '#6d5a3c';
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      ink(ctx, 1, 0.55);
      ctx.stroke();
    }
    // 三足座
    ctx.fillStyle = '#3d3122';
    ctx.beginPath();
    ctx.moveTo(x - 4, base - 46);
    ctx.quadraticCurveTo(x - 20, base - 16, x - 34, base);
    ctx.lineTo(x + 34, base);
    ctx.quadraticCurveTo(x + 20, base - 16, x + 4, base - 46);
    ctx.closePath();
    ctx.fill();
    // 烛
    ctx.fillStyle = '#e4d3a8';
    ctx.fillRect(x - 4.5, top - 8, 9, 22);
    ink(ctx, 0.8, 0.5);
    ctx.strokeRect(x - 4.5, top - 8, 9, 22);
    ctx.restore();
  }

  // 鼓架（听乐段，白衣女子身后）：斜置的扁鼓与朱红的三足架
  function drumStand(ctx, d) {
    const x0 = wx(d.o[0]), x1 = wx(d.o[1]);
    const y0 = wy(d.top), y1 = wy(d.bottom);
    const cx = (x0 + x1) / 2, cy = y0 + (y1 - y0) * 0.3;
    ctx.save();
    ink(ctx, 5, 1);
    ctx.strokeStyle = '#9c3a28';
    for (const [ax, bx] of [[-0.62, -0.7], [0.55, 0.78], [0.02, 0.06]]) {
      ctx.beginPath();
      ctx.moveTo(cx + ax * (x1 - x0) * 0.5, cy + 12);
      ctx.lineTo(cx + bx * (x1 - x0) * 0.5, y1);
      ctx.stroke();
    }
    ctx.translate(cx, cy);
    ctx.rotate(0.32);
    ctx.fillStyle = '#7d2e1f';
    ctx.beginPath();
    ctx.ellipse(0, 6, (x1 - x0) * 0.46, 30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c9a46a';
    ctx.beginPath();
    ctx.ellipse(0, 0, (x1 - x0) * 0.44, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    ink(ctx, 1.2, 0.6);
    ctx.stroke();
    ctx.restore();
  }

  // 两端留白：卷首题名，卷尾题识。印章在长卷走完后才盖上。
  function inscriptions(ctx) {
    P.drawInscription(ctx, W - 70, 150, '韩熙载夜宴图', { size: 30, gap: 44, color: P.rgba(P.C.ink, 0.72) });
    P.drawInscription(ctx, 196, 300, '夜宴既罢', { size: 22, gap: 32, color: P.rgba(P.C.ink, 0.62) });
    P.drawInscription(ctx, 148, 330, '烛影犹存', { size: 18, gap: 27, color: P.rgba(P.C.ink, 0.46) });
  }

  function build() {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    agedSilk(ctx);
    for (const p of L.FIXTURES.posts) post(ctx, p);
    for (const s of L.FIXTURES.screens) bigScreen(ctx, s);
    inscriptions(ctx);
    edges(ctx);
    return cv;
  }

  // 立在榻前、案前的器物不能进底图，否则会被床榻素材盖住：与人物一起按 z 排序绘制
  const LAYERED = [
    ...L.FIXTURES.drumStands.map((d) => ({
      id: 'drum-stand', z: d.bottom, box: [wx(d.o[0]), wy(d.top), wx(d.o[1]), wy(d.bottom)],
      draw: (ctx) => drumStand(ctx, d)
    })),
    ...CANDLES.map((c) => ({
      id: c.id, z: c.floor / L.K, box: [c.x - 40, c.top - 20, c.x + 40, c.floor],
      draw: (ctx) => candleStand(ctx, c)
    }))
  ];

  HX.plate = { build, W, H, SECTIONS, CANDLES, BURNERS, LAYERED };
})(typeof window !== 'undefined' ? window : globalThis);
