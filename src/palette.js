/* 绢本设色：配色、绢面质感、印章与题签绘制。 */
(function (root) {
  'use strict';
  const HX = (root.HX = root.HX || {});
  const U = HX.util;

  const C = {
    ink: '#3b332c',
    inkSoft: '#6b5f52',
    inkFaint: '#8d8172',
    silk: '#e8dcc4',
    silkWarm: '#efe4cd',
    silkShade: '#d3c19f',
    silkEdge: '#bda98a',
    vermilion: '#9e3b2e',
    vermilionLight: '#c4644c',
    cinnabar: '#8f3226',
    malachite: '#6f8a72',
    malachiteLight: '#9db09a',
    indigo: '#48586c',
    indigoLight: '#7d8ea0',
    ochre: '#ad8150',
    ochreLight: '#cfa877',
    moon: '#dfe2da',
    umber: '#6f563c',
    gold: '#b08a45',
    rose: '#b98577',
    plum: '#8b6a70'
  };

  // 人物衣色（低饱和，朱砂只作点缀）
  const ROBES = {
    night:    { body: '#4b4239', sleeve: '#3d352d', trim: '#8a7659', belt: '#6a5637' },
    vermilion:{ body: '#a8432f', sleeve: '#93392a', trim: '#e6cfae', belt: '#732d1e' },
    jade:     { body: '#6d8873', sleeve: '#5e7a65', trim: '#e8dfc8', belt: '#4c6253' },
    inkblue:  { body: '#4e6379', sleeve: '#425668', trim: '#d9dedd', belt: '#324558' },
    ochre:    { body: '#ab7c43', sleeve: '#946a37', trim: '#eee1c2', belt: '#6a4e2b' },
    moon:     { body: '#d5d2c2', sleeve: '#c1beac', trim: '#877f6f', belt: '#a1937b' },
    rose:     { body: '#b9827a', sleeve: '#a5736c', trim: '#f2e4d7', belt: '#87595a' },
    violet:   { body: '#7d7290', sleeve: '#6c6280', trim: '#e3dce9', belt: '#565069' },
    moss:     { body: '#7d8b6f', sleeve: '#6d7b60', trim: '#e5e3d0', belt: '#4e5a44' },
    white:    { body: '#e9e3d3', sleeve: '#d8d1bf', trim: '#968d80', belt: '#b2a790' },
    slate:    { body: '#6a6e6a', sleeve: '#5b5f5b', trim: '#d6d7ce', belt: '#4a4e4a' }
  };

  // 绢面：暖象牙底 + 纤维 + 年代斑痕。先铺满整幅，再画内容。
  function paintSilk(ctx, w, h, opts = {}) {
    const warmth = opts.warmth == null ? 0 : opts.warmth;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, shade(C.silkWarm, 0.03 + warmth * 0.05));
    g.addColorStop(0.55, C.silk);
    g.addColorStop(1, shade(C.silkShade, 0.12));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // 横向纤维：像绢的经纬
    ctx.save();
    ctx.globalAlpha = 0.05;
    for (let y = 0; y < h; y += 3) {
      ctx.strokeStyle = U.seed(y) > 0.5 ? '#ffffff' : '#a89372';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(0, y + U.seed(y * 1.7) * 1.4);
      ctx.lineTo(w, y + U.seed(y * 2.3) * 1.4);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.035;
    for (let x = 0; x < w; x += 4) {
      ctx.strokeStyle = U.seed(x * 3.1) > 0.5 ? '#ffffff' : '#b09a78';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(x + U.seed(x) * 1.6, 0);
      ctx.lineTo(x + U.seed(x * 1.9) * 1.6, h);
      ctx.stroke();
    }
    ctx.restore();

    // 年代斑痕
    ctx.save();
    for (let i = 0; i < 90; i++) {
      const x = U.seed(i * 5.3) * w;
      const y = U.seed(i * 7.9 + 2) * h;
      const r = 12 + U.seed(i * 3.7) * 90;
      const a = 0.012 + U.seed(i * 11.1) * 0.024;
      const gg = ctx.createRadialGradient(x, y, 0, x, y, r);
      gg.addColorStop(0, `rgba(150,120,80,${a})`);
      gg.addColorStop(1, 'rgba(150,120,80,0)');
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 霉点（极少量，避免脏）
    ctx.save();
    for (let i = 0; i < 160; i++) {
      const x = U.seed(i * 2.7 + 40) * w;
      const y = U.seed(i * 4.1 + 9) * h;
      ctx.fillStyle = `rgba(122,104,74,${0.02 + U.seed(i) * 0.03})`;
      ctx.beginPath();
      ctx.arc(x, y, 0.5 + U.seed(i * 6.1) * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 边缘压深：长卷装裱的纵深
  function paintSilkEdges(ctx, w, h) {
    const top = ctx.createLinearGradient(0, 0, 0, h * 0.22);
    top.addColorStop(0, 'rgba(120,98,66,.20)');
    top.addColorStop(1, 'rgba(120,98,66,0)');
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, w, h * 0.22);

    const bottom = ctx.createLinearGradient(0, h * 0.82, 0, h);
    bottom.addColorStop(0, 'rgba(120,98,66,0)');
    bottom.addColorStop(1, 'rgba(110,90,60,.26)');
    ctx.fillStyle = bottom;
    ctx.fillRect(0, h * 0.82, w, h * 0.18);
  }

  // 颜色明暗调整：amount>0 提亮，<0 压暗
  function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amount >= 0) {
      r = Math.round(r + (255 - r) * amount);
      g = Math.round(g + (255 - g) * amount);
      b = Math.round(b + (255 - b) * amount);
    } else {
      const k = 1 + amount;
      r = Math.round(r * k); g = Math.round(g * k); b = Math.round(b * k);
    }
    return `rgb(${r},${g},${b})`;
  }

  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // 朱文印
  function drawSeal(ctx, x, y, size, text, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(-0.02);
    ctx.fillStyle = rgba(C.vermilion, 0.9);
    U.roundRect(ctx, -size / 2, -size / 2, size, size, size * 0.06);
    ctx.fill();
    ctx.strokeStyle = rgba(C.silk, 0.35);
    ctx.lineWidth = Math.max(0.6, size * 0.02);
    U.roundRect(ctx, -size / 2 + size * 0.07, -size / 2 + size * 0.07,
      size * 0.86, size * 0.86, size * 0.05);
    ctx.stroke();
    ctx.fillStyle = '#f3e6cd';
    ctx.font = `${size * 0.34}px "Songti SC","STSong",serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const chars = text.split('');
    if (chars.length >= 4) {
      const d = size * 0.205;
      ctx.fillText(chars[1], -d, -d);
      ctx.fillText(chars[0], d, -d);
      ctx.fillText(chars[3], -d, d);
      ctx.fillText(chars[2], d, d);
    } else {
      ctx.fillText(text, 0, 0);
    }
    // 印泥颗粒：用绢色小点模拟未盖匀
    ctx.globalAlpha *= 0.22;
    ctx.fillStyle = C.silk;
    for (let i = 0; i < 30; i++) {
      const a = U.seed(i * 3.3) * Math.PI * 2;
      const r = U.seed(i * 7.7) * size * 0.46;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 0.5 + U.seed(i * 2.1) * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 题签（竖排小字）
  function drawInscription(ctx, x, y, text, opts = {}) {
    const size = opts.size || 15;
    const gap = opts.gap || size * 1.35;
    const color = opts.color || rgba(C.ink, 0.72);
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = `${size}px "Songti SC","STSong",serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < text.length; i++) {
      ctx.fillText(text[i], x + (U.seed(i * 4.1) - 0.5) * size * 0.1,
        y + i * gap);
    }
    ctx.restore();
  }

  HX.palette = { C, ROBES, paintSilk, paintSilkEdges, shade, rgba, drawSeal, drawInscription };
})(typeof window !== 'undefined' ? window : globalThis);
