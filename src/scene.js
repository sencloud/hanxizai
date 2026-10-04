/* 场景：相机、输入、交互事件与绘制循环。
   一帧的层次固定为：底图（旧绢与素面陈设）→ 素材层（床榻、桌案与人物按前后次序）
   → 光 → 烟 → 印章。长卷自右向左展开：镜头从右端（听乐）开卷，向左行进到送别。 */
(function (root) {
  'use strict';
  const HX = (root.HX = root.HX || {});
  if (!HX.util || !HX.plate || !HX.light || !HX.score || !HX.life || !HX.original) {
    console.error('页面脚本没有全部加载（常见原因是本地服务还在用旧的单线程预览）。请刷新页面。');
    return;
  }
  const U = HX.util;
  const P = HX.palette;
  const SP = HX.sprite;
  const L = HX.layout;
  const PL = HX.plate;
  const LT = HX.light;
  const AU = HX.audio;
  const DC = HX.dance;
  const clamp = U.clamp;

  const W = PL.W, H = PL.H;

  const dom = {};
  let ctx, wctx, world, plate, smoke, sound, director, dance, clock, bank;
  let statics = [], dancerB = null, drumPlace = null;
  let g = null;              // 当前绘制目标：世界层或上屏
  let cssW = 0, cssH = 0, dpr = 1;

  const state = {
    time: 0,
    paused: false,
    auto: false,
    reduced: false,
    viewX: W,
    zoom: 1,
    scale: 1,
    baseScale: 1,
    view: { x0: 0, y0: 0, x1: 1600, y1: 900 },
    listening: 0.35,
    listeningUser: 0,
    pluck: 0,
    ensemble: 0,
    ensembleUser: 0,
    wash: 0,
    depart: 0,
    actors: [],
    amb: null,
    section: -1,
    chapterUntil: 0,
    charge: 0,
    charging: false,
    drag: null,
    trim: new Map(),
    responded: new Map(),
    stamp: 0,
    stamped: false,
    hintGone: false,
    mix: null,
    danceAuto: false,
    drumHit: 0,
    lastStrike: -99,
    dprCap: 2,
    pinch: null,
    soundChosen: false       // 观者亲手开关过声音后，就不再替他自动开声
  };

  /* ---------------- 视口 ---------------- */

  function resize() {
    dpr = Math.min(root.devicePixelRatio || 1, state.dprCap);
    cssW = dom.stage.clientWidth;
    cssH = dom.stage.clientHeight;
    for (const cv of [dom.scroll, dom.smoke]) {
      cv.width = Math.round(cssW * dpr);
      cv.height = Math.round(cssH * dpr);
      cv.style.width = cssW + 'px';
      cv.style.height = cssH + 'px';
    }
    if (!world) world = document.createElement('canvas');
    world.width = Math.round(cssW * dpr);
    world.height = Math.round(cssH * dpr);
    // 横屏让整幅画高放得下；竖屏手机至少保留约 540 世界单位的横向视野，
    // 并在画的上下各留出约 95 像素放标题、工具与分段
    const portrait = cssH > cssW * 1.15 && cssW <= 700;
    state.baseScale = Math.min(
      clamp(cssH / 880, 0.4, 1.8),
      Math.max(0.36, cssW / (portrait ? 540 : 640)),
      portrait ? Math.max(0.3, (cssH - 190) / 900) : Infinity
    );
    dom.stage.classList.toggle('portrait', portrait);
    if (smoke) smoke.resize(cssW, cssH);
    computeView();
  }

  function computeView() {
    state.scale = state.baseScale * state.zoom;
    const vw = cssW / state.scale;
    const vh = cssH / state.scale;
    if (vw >= W) state.viewX = -(vw - W) / 2;
    else state.viewX = clamp(state.viewX, 0, W - vw);
    let y0;
    if (vh >= H) y0 = -(vh - H) / 2;
    else y0 = clamp(H * 0.48 - vh * 0.5, 0, H - vh);
    state.view = { x0: state.viewX, y0, x1: state.viewX + vw, y1: y0 + vh };
  }

  const toWorld = (sx, sy) => [
    state.view.x0 + sx / state.scale,
    state.view.y0 + sy / state.scale
  ];

  /* ---------------- 交互命中 ---------------- */

  // 先看器物（烛、鼓），再按前后次序看人：前面的人先接住点击
  function hitTest(wx, wy) {
    for (const c of PL.CANDLES) {
      const [tx, ty] = c.tips[0];
      if (Math.hypot(wx - tx, wy - ty) < 56) return { kind: 'candle', id: c.id, x: tx, y: ty };
    }
    if (drumPlace && SP.contains(bank, 'd-drum', drumPlace, {}, wx, wy)) {
      return { kind: 'drum', id: 'd-drum', x: drumPlace.x, y: wy };
    }
    const front = state.actors.slice().sort((a, b) => b.place.z - a.place.z);
    for (const a of front) {
      if (!SP.contains(bank, a.sprite, a.place, a.pose, wx, wy)) continue;
      let kind = 'actor';
      if (a.role === 'pipa') kind = 'pipa';
      else if (a.prop && a.prop.kind === 'flute') kind = 'ensemble';
      return { kind, id: a.id, x: a.x, y: wy, actor: a };
    }
    for (const s of statics.slice().sort((a, b) => b.place.z - a.place.z)) {
      if (THING_LINES[s.id] && SP.contains(bank, s.id, s.place, {}, wx, wy)) {
        return { kind: 'thing', id: s.id, x: s.place.x, y: wy };
      }
    }
    return null;
  }

  function say(text) {
    dom.live.textContent = text;
  }

  /* ---------------- 点击事件 ---------------- */

  function activate(t) {
    if (!t) return;
    vanishHint();
    switch (t.kind) {
      case 'pipa': {
        state.pluck = 1;
        state.listeningUser = 1;
        state.responded.set(t.id, state.time);
        sound.pluck(t.x, state.view, Math.floor(state.time) % 5);
        setTimeout(() => { state.pluck = 0.55; sound.pluck(t.x + 20, state.view, 2); }, 150);
        setTimeout(() => { sound.pluck(t.x - 14, state.view, 4); }, 320);
        say('琵琶声起，满堂屏息。');
        break;
      }
      case 'ensemble': {
        state.ensembleUser = state.ensembleUser > 0.5 ? 0 : 1;
        state.responded.set(t.id, state.time);
        say(state.ensembleUser > 0.5 ? '四女横笛，一女吹筚篥，清吹齐作。' : '笛声渐歇。');
        break;
      }
      case 'candle': {
        state.trim.set(t.id, state.time);
        say('剪去烛花，光又亮了一分。');
        break;
      }
      case 'thing': {
        say(THING_LINES[t.id]);
        break;
      }
      default: {
        state.responded.set(t.id, state.time);
        if (t.actor) {
          sound.pluck(t.actor.x, state.view, (t.id.length + 2) % 5);
          say(NAME_LINES[t.actor.sprite] || '画中人向你微微颔首。');
        }
      }
    }
  }

  const NAME_LINES = {
    'l-han': '韩熙载坐在榻沿，双手垂在膝上，只作听。',
    'l-langcan': '新科状元郎粲斜倚榻上，侧身听曲。',
    'l-limei': '李家小妹转轴拨弦，眼不离手。',
    'l-lady': '榻前的白衣女子静立听弦。',
    'l-guest-brown': '褐衣宾客坐椅中，俯身向前，听得入神。',
    'l-guest-chair': '背身而坐的宾客，椅背青绿。',
    'l-man-1': '案后的宾客叉手而立。',
    'l-man-2': '案后的宾客执着一根细杖。',
    'l-man-3': '案后的宾客抱臂而立。',
    'l-pink': '粉衣女子立在案旁，垂手听曲。',
    'l-girl': '青衣小鬟叉手而立——下一段起舞的，便是她王屋山。',
    'd-han-drum': '韩熙载亲擂羯鼓，袖子挽到肘上。',
    'd-dancer': '王屋山踏六幺，回身顾盼。',
    'd-monk': '德明和尚叉手垂目，不看舞。',
    'd-langcan': '郎粲坐在椅上，侧耳看舞。',
    'd-clapper': '他手执拍板，按着鼓点。',
    'd-youth': '鼓后的少年击掌应节。',
    'd-clap-woman': '青衣女子击掌应节。',
    'd-man-stand': '宾客拱手旁观。',
    'r-han': '韩熙载坐榻上洗手，侍女环坐说话。',
    'r-women': '榻上侍女相对说话。',
    'r-maid-front': '侍女捧盆侍立。',
    'r-pipa-girl': '侍女荷着琵琶，往后堂去。',
    'r-tray-maid': '侍女托着酒具，往床前送去。',
    'f-han-fan': '韩熙载袒胸盘坐，执扇听吹。',
    'f-clapper': '执拍板的宾客，随笛声打拍。',
    'f-guest-stand': '屏风前的宾客，袖手而立。',
    'f-woman-shawl': '披帛女子隔着屏风与人说话。',
    'f-lady': '女子立在主人身前。',
    'f-maid-fan': '侍女手提长柄扇。',
    'f-maid-back': '侍女立在主人身后。',
    'b-han': '韩熙载执槌而立，举手作别。',
    'b-couple': '宾客与侍女依依话别。',
    'b-chair-group': '椅上的宾客拉着侍女的手，还不肯走。'
  };

  const THING_LINES = {
    'l-bed': '帐中锦被半掩，琵琶斜搁。',
    'l-tables': '案上果品、注子与温碗。',
    'l-couch': '围屏大榻，主人与状元同坐。',
    'r-bed': '红帐低垂，床前小案摆着杯盏。',
    'r-couch': '歇息的大榻。',
    'f-screen-pine': '画屏上一株老松。'
  };

  /* ---------------- 主循环 ---------------- */

  let last = 0;

  function frame(now) {
    const raw = (now - last) / 1000;
    const dt = Math.min(0.05, Math.max(0, raw));
    last = now;
    tick(dt || 0.016);
    adapt(raw);
    requestAnimationFrame(frame);
  }

  // 手机上掉帧时逐级降画质：先降像素密度，再减少人物形变的横带数；只降不升，免得来回跳
  const perf = { sum: 0, n: 0, level: 0 };
  function adapt(raw) {
    if (document.hidden || HX.original.isOpen() || !(raw > 0) || raw > 0.25) return;
    perf.sum += raw;
    if (++perf.n < 120) return;
    const avg = perf.sum / perf.n;
    perf.sum = 0;
    perf.n = 0;
    if (avg < 1 / 40 || perf.level >= 3) return;
    perf.level++;
    if (perf.level === 1) state.dprCap = Math.min(state.dprCap, 1.5);
    else if (perf.level === 2) SP.setStrips(10);
    else state.dprCap = 1;
    resize();
  }

  function tick(dt) {
    if (state.paused) dt = 0;
    state.time += dt;
    if (state.stepKeys) state.stepKeys(dt);
    hideChapterIfDue();

    // 自动漫游：向左（向卷尾）走，走到头从卷首重新开卷；舞到正酣时镜头停住，舞罢再走
    if (state.auto && dt > 0) {
      const v = state.view;
      const dwell = dance.busy && drumPlace && drumPlace.x > v.x0 && drumPlace.x < v.x1 - 120;
      state.roam = U.lerp(state.roam == null ? 1 : state.roam, dwell ? 0 : 1, clamp(dt * 1.5));
      state.viewX -= dt * 62 * state.roam;
      if (state.viewX < 10) state.viewX = W;
      computeView();
    }

    if (state.charging && dt > 0) {
      // 按住不放也会缓慢蓄力；拖动可以更精确地控制力度
      state.charge = clamp(state.charge + dt * 0.55);
      dance.charge(state.charge);
    }

    // 氛围
    clock.step(dt);
    state.amb = clock.sample();

    // 分段与镜头内行为
    const centerX = (state.view.x0 + state.view.x1) / 2;
    const secIndex = sectionIndexAt(centerX);
    if (secIndex !== state.section) {
      state.section = secIndex;
      showChapter(PL.SECTIONS[secIndex]);
    }
    const sec = PL.SECTIONS[secIndex];
    const near = (id) => (sec.id === id ? 1 : 0);

    // 各段的常态强度（没有玩家介入也活着）
    state.listening += ((state.listeningUser > 0.5 ? 1 : 0.28 + near('listen') * 0.34) - state.listening) * (1 - Math.exp(-dt * 0.9));
    state.wash += (near('rest') - state.wash) * (1 - Math.exp(-dt * 0.8));
    state.depart += (near('farewell') - state.depart) * (1 - Math.exp(-dt * 0.7));
    const ensTarget = clamp(state.ensembleUser > 0.5 ? 1 : near('flute') * 0.62);
    state.ensemble += (ensTarget - state.ensemble) * (1 - Math.exp(-dt * 1.1));
    state.pluck *= Math.exp(-dt * 2.2);

    // 观舞：进入此段即起，观者可随时击鼓加入
    if (sec.id === 'dance' && !dance.active && dance.stage !== 'complete') dance.start();
    if (sec.id === 'dance' && dance.stage === 'complete' && dance.stageTime > 8) dance.start();
    dance.step(dt, { arriving: state.charging });
    const d = dance.sample();

    // 配乐的段落权重：镜头中心离哪段越近，那段的乐器越响；跨段时交叉淡入
    state.mix = sectionMix(centerX);
    // 舞起之后由乐谱打鼓；观者刚落过槌的一小会儿让给观者
    state.danceAuto = dance.playing && !state.charging && state.time - state.lastStrike > 1.6;

    // 生活系统
    const life = director.advance({
      time: state.time,
      listening: state.listening,
      pluck: state.pluck,
      ensemble: state.ensemble,
      wash: state.wash,
      depart: state.depart,
      dance: d,
      mix: state.mix,
      danceAuto: state.danceAuto
    });
    state.drumHit = Math.max(d.hit, state.danceAuto ? HX.score.env('drum', state.time, 12) * 0.8 : 0);
    state.actors = life.actors;
    for (const ev of clock.events) { void ev; say(state.amb.label); }

    // 更漏滴答
    if (dt > 0 && sound.ready && sound.enabled) {
      state.drip = (state.drip || 0) - dt;
      if (state.drip <= 0) {
        state.drip = 4.5 + U.seed(Math.floor(state.time / 4)) * 4;
        sound.drip(state.view.x0 + 200, state.view);
      }
    }

    // 卷尾落款
    if (!state.stamped && centerX < 760) {
      state.stamped = true;
      state.stamp = 0.0001;
      say('长卷已尽，落款用印。');
    }
    if (state.stamp > 0 && state.stamp < 1) state.stamp = Math.min(1, state.stamp + dt * 0.8);

    if (sound.ready) {
      // 声音出错只该让声音停下，不能让画面跟着停在这一帧
      try {
        sound.update({
          time: state.time, mix: state.mix, danceAuto: state.danceAuto,
          actors: state.actors, ensemble: state.ensemble, amb: state.amb
        }, state.view);
      } catch (e) {
        if (!state.soundError) { state.soundError = true; console.error(e); }
      }
    }

    // 看原图时长卷被整个遮住：照常走时、奏乐，只是不必再画
    if (!HX.original.isOpen()) render(d);
  }

  const MIX_FADE = 650;
  function sectionMix(x) {
    const mix = {};
    for (const s of PL.SECTIONS) {
      const out = x < s.x0 ? s.x0 - x : x > s.x1 ? x - s.x1 : 0;
      mix[s.id] = 1 - U.smooth(clamp(out / MIX_FADE));
    }
    return mix;
  }

  function sectionIndexAt(x) {
    for (let i = 0; i < PL.SECTIONS.length; i++) {
      if (x >= PL.SECTIONS[i].x0 && x < PL.SECTIONS[i].x1) return i;
    }
    return x >= W / 2 ? 0 : PL.SECTIONS.length - 1;
  }

  /* ---------------- 绘制 ---------------- */

  function render(d) {
    const view = state.view;

    /* 1 · 世界层：底图 + 素材层（静止的与活动的合成在一张画面上） */
    wctx = world.getContext('2d');
    wctx.setTransform(1, 0, 0, 1, 0, 0);
    wctx.clearRect(0, 0, world.width, world.height);
    wctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const sx = clamp(view.x0, 0, W);
    const sy = clamp(view.y0, 0, H);
    const sw = clamp(view.x1, 0, W) - sx;
    const sh = clamp(view.y1, 0, H) - sy;
    if (sw > 0 && sh > 0) {
      wctx.imageSmoothingEnabled = true;
      wctx.drawImage(plate, sx, sy, sw, sh,
        (sx - view.x0) * state.scale, (sy - view.y0) * state.scale, sw * state.scale, sh * state.scale);
    }
    wctx.save();
    wctx.translate(-view.x0 * state.scale, -view.y0 * state.scale);
    wctx.scale(state.scale, state.scale);
    wctx.imageSmoothingQuality = 'high';
    g = wctx;
    drawLayers(d);
    drawStamp();
    g = null;
    wctx.restore();

    /* 2 · 上屏 */
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    // 装裱：画卷之外的暗地
    ctx.fillStyle = '#1d1814';
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.drawImage(world, 0, 0, cssW, cssH);

    /* 3 · 氛围：同一条时间轴同时作用于静止底图与活动人物 */
    LT.tint(ctx, state.amb, cssW, cssH);

    /* 4 · 灯火（世界坐标，叠加混合） */
    ctx.save();
    ctx.translate(-view.x0 * state.scale, -view.y0 * state.scale);
    ctx.scale(state.scale, state.scale);
    LT.render(ctx, { amb: state.amb, actors: state.actors, time: state.time, trim: state.trim }, view, { reduced: state.reduced });
    if (!smoke || !smoke.active) LT.incense(ctx, { amb: state.amb, time: state.time }, view);
    ctx.restore();

    /* 5 · 烟（WebGL 流体层） */
    if (smoke) smoke.render({ time: state.time, amb: state.amb, scale: state.scale }, view, { w: cssW, h: cssH });
  }

  function visible(box, dx) {
    const v = state.view;
    return box[2] + (dx || 0) > v.x0 - 120 && box[0] + (dx || 0) < v.x1 + 120;
  }

  // 素材层：陈设与人物按 z（原画上的下沿）排序，越靠下越在前
  function drawLayers(d) {
    const list = [];
    for (const s of statics) if (visible(s.place.box)) list.push({ z: s.place.z, s });
    for (const f of PL.LAYERED) if (visible(f.box)) list.push({ z: f.z, f });
    for (const a of state.actors) if (visible(a.place.box, a.pose.dx)) list.push({ z: a.place.z, a });
    list.sort((p, q) => p.z - q.z);
    for (const it of list) {
      if (it.s) drawStatic(it.s, d);
      else if (it.f) it.f.draw(g);
      else drawActor(it.a, d);
    }
  }

  function drawStatic(s, d) {
    if (s.id === 'd-drum') {
      const hit = state.drumHit || 0;
      SP.draw(g, bank, s.id, s.place, { sx: 1 + 0.01 * hit });
      drumSkin(s, d, hit);
      return;
    }
    SP.draw(g, bank, s.id, s.place, {});
  }

  function respondPose(a) {
    const t0 = state.responded.get(a.id);
    if (t0 == null) return { pose: a.pose, glow: 0 };
    const u = clamp(1 - (state.time - t0) / 2.4);
    if (u <= 0) return { pose: a.pose, glow: 0 };
    const pose = Object.assign({}, a.pose);
    pose.nod = (pose.nod || 0) + Math.sin(u * Math.PI) * 0.06;
    return { pose, glow: u };
  }

  function drawActor(a, d) {
    const { pose, glow } = respondPose(a);
    if (a.dance) {
      drawDancer(a, pose, d);
    } else {
      SP.draw(g, bank, a.sprite, a.place, pose);
    }
    if (glow > 0) SP.outline(g, bank, a.sprite, a.place, pose, glow);
    if (a.role === 'pipa') pipaStrings(a, pose);
  }

  // 王屋山：两张姿势（背身叉腰 / 扬袖旋裙）随舞步交叉淡入，旋转时左右翻转
  function drawDancer(a, pose, d) {
    // 两张姿势的轮廓不同，叠得久了会出重影：只在扬袖的一瞬间短暂溶接
    const k = d.inShow ? U.smooth((d.armA - 0.7) / 0.08) : 0;
    let sx = 1;
    if (d.stage === 'spin') {
      const c = Math.cos(d.phase * 1.5);
      sx = (c < 0 ? -1 : 1) * Math.max(0.18, Math.abs(c));
    }
    const p = Object.assign({}, pose, { flip: sx < 0, sx: Math.abs(sx) });
    const aA = 1 - k, aB = k;
    if (aA > 0.02) SP.draw(g, bank, 'd-dancer', a.place, Object.assign({}, p, { alpha: aA }));
    if (aB > 0.02 && dancerB) SP.draw(g, bank, 'd-dancer-b', dancerB, Object.assign({}, p, { alpha: aB }));
  }

  // 鼓面：落槌时一圈涟漪，蓄力时微微发亮
  function drumSkin(s, d, hit) {
    const c = SP.anchor(bank, s.id, s.place, {}, 'skin');
    if (!c) return;
    const rx = 165 * s.place.s;      // 鼓面在图集里约 330 像素宽
    g.save();
    g.translate(c[0], c[1]);
    g.rotate(0.2);
    if (d.charge > 0.02) {
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = `rgba(255,214,150,${0.16 * d.charge})`;
      g.beginPath();
      g.ellipse(0, 0, rx, rx * 0.36, 0, 0, Math.PI * 2);
      g.fill();
    }
    if (hit > 0.03) {
      g.globalCompositeOperation = 'lighter';
      const r = rx * (0.25 + 0.8 * (1 - hit));
      g.strokeStyle = `rgba(255,232,190,${0.55 * hit})`;
      g.lineWidth = 2.2;
      g.beginPath();
      g.ellipse(0, 0, r, r * 0.36, 0, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }

  // 琵琶弦：拨动时四根弦一齐颤
  function pipaStrings(a, pose) {
    const amp = state.pluck;
    if (amp < 0.03) return;
    const b = SP.anchor(bank, a.sprite, a.place, pose, 'bridge');
    const n = SP.anchor(bank, a.sprite, a.place, pose, 'nut');
    if (!b || !n) return;
    const dx = n[0] - b[0], dy = n[1] - b[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const o = (i - 1.5) * 3.2;
      const wob = Math.sin(state.time * 70 + i * 1.7) * amp * 2.4;
      g.strokeStyle = `rgba(255,236,196,${0.5 * amp})`;
      g.beginPath();
      g.moveTo(b[0] + nx * o, b[1] + ny * o);
      g.quadraticCurveTo(b[0] + dx * 0.5 + nx * (o + wob), b[1] + dy * 0.5 + ny * (o + wob), n[0] + nx * o * 0.6, n[1] + ny * o * 0.6);
      g.stroke();
    }
    g.restore();
  }

  function drawStamp() {
    if (state.stamp <= 0) return;
    const u = U.smooth(state.stamp);
    const s = 74 * (1.25 - 0.25 * u);
    P.drawSeal(g, 128, 190, s, '夜宴之印', Math.min(1, state.stamp * 1.6));
  }

  /* ---------------- 章节卡 ---------------- */

  function showChapter(sec) {
    dom.chapterIndex.textContent = sec.index;
    dom.chapterName.textContent = sec.name;
    dom.chapterNote.textContent = sec.note;
    dom.chapter.classList.add('show');
    state.chapterUntil = state.time + 6;
    for (const el of dom.sectionBtns) {
      el.classList.toggle('active', el.dataset.id === sec.id);
    }
  }

  function hideChapterIfDue() {
    if (state.chapterUntil && state.time > state.chapterUntil) {
      dom.chapter.classList.remove('show');
      state.chapterUntil = 0;
    }
  }

  function vanishHint() {
    if (state.hintGone) return;
    state.hintGone = true;
    dom.hint.classList.add('gone');
  }

  /* ---------------- 输入 ---------------- */

  const keys = new Set();

  function bindInput() {
    root.addEventListener('keydown', (e) => {
      autoSound();
      if (HX.original.isOpen()) return;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
      keys.add(e.key);
      if (e.key === ' ') togglePause();
      if (e.key === '+' || e.key === '=') zoom(0.16);
      if (e.key === '-' || e.key === '_') zoom(-0.16);
      if (e.key === 'Home') { state.viewX = W; computeView(); }
      if (e.key === 'End') { state.viewX = 0; computeView(); }
      if (e.key === 'e' || e.key === 'E') {
        const [wx, wy] = toWorld(cssW / 2, cssH / 2);
        activate(hitTest(wx, wy));
      }
      vanishHint();
    });
    root.addEventListener('keyup', (e) => keys.delete(e.key));

    const step = (dt) => {
      let dir = 0;
      if (keys.has('ArrowLeft')) dir -= 1;
      if (keys.has('ArrowRight')) dir += 1;
      if (!dir || state.paused) return;
      state.auto = false;
      dom.toolAuto.setAttribute('aria-pressed', 'false');
      state.viewX += dir * dt * 220;
      computeView();
    };
    state.stepKeys = step;

    const el = dom.stage;
    // 开关声音的按钮自己做主，页面上其余任何点按都顺手开声（含看原图里的点按）。
    // 触屏的按下不算"用户激活"，要等抬指（pointerup / touchend）才放行声音，所以两头都接
    const unlock = (e) => {
      if (e.target.closest && e.target.closest('#tool-sound')) return;
      autoSound();
      if (sound.ctx && sound.enabled && sound.ctx.state === 'suspended') sound.ctx.resume();
    };
    root.addEventListener('pointerdown', unlock, true);
    root.addEventListener('pointerup', unlock, true);
    root.addEventListener('touchend', unlock, { capture: true, passive: true });

    // 舞台坐标：舞台铺满视口，clientX 即舞台内坐标
    const local = (e) => [e.clientX, e.clientY];
    const pts = new Map();
    const pinchInfo = () => {
      const [a, b] = [...pts.values()];
      return { d: Math.max(20, Math.hypot(a[0] - b[0], a[1] - b[1])), mx: (a[0] + b[0]) / 2 };
    };
    const stopAuto = () => {
      state.auto = false;
      dom.toolAuto.setAttribute('aria-pressed', 'false');
    };

    el.addEventListener('pointerdown', (e) => {
      // 按钮与导航浮在画上，点它们不算点画
      if (e.target.closest('button, a, nav')) return;
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* 合成事件没有活动指针 */ }
      vanishHint();
      const [lx, ly] = local(e);
      pts.set(e.pointerId, [lx, ly]);
      if (pts.size === 2) {
        // 第二根手指落下：改为双指缩放，取消正在进行的拖动、点按与蓄力
        if (state.charging) { state.charging = false; state.charge = 0; dance.charge(0); }
        state.drag = null;
        const p = pinchInfo();
        state.pinch = { d0: p.d, z0: state.zoom, mx: p.mx };
        stopAuto();
        return;
      }
      if (pts.size > 2) return;
      const [wx, wy] = toWorld(lx, ly);
      const t = hitTest(wx, wy);
      state.drag = { x: lx, y: ly, sx: lx, moved: false, target: t, touch: e.pointerType !== 'mouse' };
      el.classList.add('dragging');
      if (t && t.kind === 'drum') {
        state.charging = true;
        state.charge = 0.12;
        dance.join();
      }
    });

    el.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const [lx, ly] = local(e);
      pts.set(e.pointerId, [lx, ly]);
      if (state.pinch && pts.size >= 2) {
        const p = pinchInfo();
        zoomTo(state.pinch.z0 * p.d / state.pinch.d0, p.mx);
        state.viewX -= (p.mx - state.pinch.mx) / state.scale;
        state.pinch.mx = p.mx;
        computeView();
        return;
      }
      if (!state.drag) return;
      const dx = lx - state.drag.x;
      // 手指比鼠标抖，触屏的点按容差放宽一些
      state.drag.moved = state.drag.moved || Math.abs(lx - state.drag.sx) > (state.drag.touch ? 10 : 6);
      if (state.charging) {
        state.charge = DC.drumForce(state.drag.sx, lx, 1);
        state.drag.x = lx;
        return;
      }
      if (state.drag.moved) {
        stopAuto();
        state.viewX -= dx / state.scale;
        computeView();
      }
      state.drag.x = lx;
      state.drag.y = ly;
    });

    const release = (e) => {
      pts.delete(e.pointerId);
      if (!state.pinch) return false;
      if (pts.size < 2) {
        state.pinch = null;
        // 剩下的那根手指接着拖，不算点按
        if (pts.size === 1) {
          const [lx, ly] = [...pts.values()][0];
          state.drag = { x: lx, y: ly, sx: lx, moved: true, target: null, touch: true };
        }
      }
      return true;
    };

    const finish = (e) => {
      if (release(e)) return;
      if (!state.drag) return;
      const t = state.drag.target;
      const moved = state.drag.moved;
      if (state.charging) {
        const force = clamp(state.charge);
        dance.strike(force);
        state.lastStrike = state.time;
        sound.drum(drumPlace ? drumPlace.x : t.x, state.view, force);
        if (force > 0.85) say('鼓声太急，舞者乱了半步。');
        else if (force < 0.25) say('鼓声太轻，节拍散漫。');
        else say('鼓声落定，舞者踏节而行。');
        state.charging = false;
        dance.charge(0);
      } else if (!moved) {
        activate(t);
      }
      state.drag = null;
      el.classList.remove('dragging');
    };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoom(e.deltaY < 0 ? 0.12 : -0.12, e.offsetX);
    }, { passive: false });
    // 双击不缩放：连点人物、连击鼓面时不应让画面跳动
    el.addEventListener('dblclick', (e) => e.preventDefault());
  }

  // 浏览器只允许在用户手势里开声：第一次点按或按键时顺手开卷听声
  function autoSound() {
    if (state.soundChosen || sound.enabled) return;
    state.soundChosen = true;
    setSound(true, true);
  }

  function setSound(on, quiet) {
    const ok = sound.setEnabled(on);
    dom.toolSound.setAttribute('aria-pressed', String(ok));
    dom.toolSound.textContent = ok ? '掩卷息声' : '开卷听声';
    if (!quiet) say(ok ? '声音已开。' : '声音已掩。');
  }

  function zoom(delta, anchorX) {
    zoomTo(state.zoom + delta, anchorX);
  }

  function zoomTo(z, anchorX) {
    const before = anchorX == null ? null : toWorld(anchorX, 0)[0];
    state.zoom = clamp(z, 0.7, 3.2);
    computeView();
    if (before != null) {
      const after = toWorld(anchorX, 0)[0];
      state.viewX += before - after;
      computeView();
    }
  }

  /* ---------------- 控件 ---------------- */

  function buildSections() {
    dom.sections.innerHTML = '';
    dom.sectionBtns = [];
    for (const s of PL.SECTIONS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'section';
      b.dataset.id = s.id;
      b.textContent = s.name;
      b.addEventListener('click', () => {
        state.auto = false;
        dom.toolAuto.setAttribute('aria-pressed', 'false');
        state.viewX = (s.x0 + s.x1) / 2 - cssW / state.scale / 2;
        computeView();
        vanishHint();
      });
      dom.sections.appendChild(b);
      dom.sectionBtns.push(b);
    }
  }

  function togglePause() {
    state.paused = !state.paused;
    dom.toolPause.setAttribute('aria-pressed', String(state.paused));
    dom.toolPause.textContent = state.paused ? '继续' : '暂歇';
    if (state.paused) sound.silence();
    else sound.resumeVolume();
    say(state.paused ? '已暂歇。' : '继续夜宴。');
  }

  function bindTools() {
    dom.toolAuto.addEventListener('click', () => {
      state.auto = !state.auto;
      dom.toolAuto.setAttribute('aria-pressed', String(state.auto));
    });
    dom.toolSound.addEventListener('click', () => {
      state.soundChosen = true;
      setSound(!sound.enabled);
    });
    dom.toolOriginal.addEventListener('click', () => {
      const v = state.view;
      HX.original.open({ worldX: (v.x0 + v.x1) / 2 });
    });
    dom.toolPause.addEventListener('click', togglePause);
    dom.toolZoomIn.addEventListener('click', () => zoom(0.28));
    dom.toolZoomOut.addEventListener('click', () => zoom(-0.28));
    dom.walkLeft.addEventListener('pointerdown', () => keys.add('ArrowLeft'));
    dom.walkRight.addEventListener('pointerdown', () => keys.add('ArrowRight'));
    for (const b of [dom.walkLeft, dom.walkRight]) {
      b.addEventListener('pointerup', () => { keys.delete('ArrowLeft'); keys.delete('ArrowRight'); });
      b.addEventListener('pointerleave', () => { keys.delete('ArrowLeft'); keys.delete('ArrowRight'); });
    }
    root.addEventListener('blur', () => keys.clear());
    root.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) sound.silence();
      else if (!state.paused) sound.resumeVolume();
    });
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    dom.stage = document.getElementById('stage');
    dom.scroll = document.getElementById('scroll');
    dom.smoke = document.getElementById('smoke');
    dom.chapter = document.getElementById('chapter');
    dom.chapterIndex = document.getElementById('chapter-index');
    dom.chapterName = document.getElementById('chapter-name');
    dom.chapterNote = document.getElementById('chapter-note');
    dom.clock = document.getElementById('clock');
    dom.clockLabel = document.getElementById('clock-label');
    dom.sections = document.getElementById('sections');
    dom.tools = document.getElementById('tools');
    dom.toolAuto = document.getElementById('tool-auto');
    dom.toolSound = document.getElementById('tool-sound');
    dom.toolPause = document.getElementById('tool-pause');
    dom.toolZoomIn = document.getElementById('tool-zoom-in');
    dom.toolZoomOut = document.getElementById('tool-zoom-out');
    dom.toolOriginal = document.getElementById('tool-original');
    dom.walkLeft = document.getElementById('walk-left');
    dom.walkRight = document.getElementById('walk-right');
    dom.hint = document.getElementById('hint');
    dom.live = document.getElementById('live');

    state.touch = !!(root.matchMedia && root.matchMedia('(pointer: coarse)').matches);
    if (state.touch) {
      dom.hint.textContent = '左右拖动漫游 · 点画中人器物 · 双指缩放'
        + (dom.stage.clientHeight > dom.stage.clientWidth ? ' · 横屏看得更宽' : '');
    }

    ctx = dom.scroll.getContext('2d');
    if (root.location.hash.indexOf('nosmoke') >= 0) dom.smoke.style.display = 'none';
    plate = PL.build();
    bank = new SP.Bank(HX.figureAtlas);
    // 贴图未就绪时按矢量轮廓画剪影，就绪后自然替换
    bank.load();
    const atlas = bank.atlas;
    statics = L.ITEMS.filter((i) => !i.life && !i.hidden && atlas[i.id])
      .map((i) => ({ id: i.id, item: i, place: L.place(i, atlas) }));
    dancerB = L.place(L.ITEMS.find((i) => i.id === 'd-dancer-b'), atlas);
    drumPlace = (statics.find((s) => s.id === 'd-drum') || {}).place || null;

    smoke = new HX.smoke.Smoke(dom.smoke);
    sound = new AU.Sound();
    director = new HX.life.Director(atlas);
    dance = new DC.Dance();
    clock = new LT.NightClock();
    state.amb = clock.sample();
    state.reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    clock.rate = state.reduced ? 0.6 : 1;

    buildSections();
    bindTools();
    bindInput();
    resize();

    // 便于定位与分享：index.html#x=8400&z=1.6（x 为世界坐标，镜头左沿）
    if (root.location.hash.length > 1) {
      const q = new URLSearchParams(root.location.hash.slice(1));
      if (q.has('x')) state.viewX = Number(q.get('x')) || 0;
      if (q.has('z')) state.zoom = clamp(Number(q.get('z')) || 1, 0.7, 3.2);
      if (q.has('t')) { state.hintGone = true; dom.hint.classList.add('gone'); }
      // 便于检查更漏各段的观感：index.html#warp=70
      if (q.has('warp')) {
        const w = Number(q.get('warp')) || 0;
        state.time = w;
        clock.time = w;
      }
      computeView();
    }
    HX.app = { state, view: () => state.view, computeView, zoom, bank, director, dance, sound };

    // 原作批注里的"入画"：回到长卷里同一处
    HX.original.init({
      onEnter(worldX) {
        state.auto = false;
        dom.toolAuto.setAttribute('aria-pressed', 'false');
        state.viewX = worldX - cssW / state.scale / 2;
        computeView();
        vanishHint();
      },
      onOpen() { keys.clear(); dom.stage.inert = true; },
      onClose() { dom.stage.inert = false; dom.toolOriginal.focus({ preventScroll: true }); }
    });
    if (root.location.hash.indexOf('original') >= 0) HX.original.open({ worldX: (state.view.x0 + state.view.x1) / 2 });

    const clockTick = () => {
      dom.clockLabel.textContent = state.amb.label;
      root.setTimeout(clockTick, 500);
    };
    clockTick();

    showChapter(PL.SECTIONS[0]);
    requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
