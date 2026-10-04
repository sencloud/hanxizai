/* 生活系统：原作里的每个人在时间轴上的细小动作。

   人物不离开原画给的位置（除了歇息段托盘的侍女会往来走动），动作全是从画上能读出来的。
   让人"像活人"靠三层：
     1. 底子：人人都在呼吸（吸短呼长）、重心极慢地飘移、偶尔顾盼——用噪声而不是正弦，
        每人的节律与相位各不相同，满堂不会同时动；
     2. 关注：谁在演奏、谁在起舞，旁人便微微朝那边倾身、侧目；
     3. 本事：主要人物按乐谱（score.js）做自己的事——琵琶女随音落指，主人随句点头，
        乐女在句末换气，击掌的人踩在鼓点上。
   最后所有姿态量都经过一层临界阻尼弹簧，目标突变也只会平滑地追过去，不会生硬地跳。
   与渲染层只交换数据（actors / events）。 */
(function (root) {
  'use strict';
  const HX = (root.HX = root.HX || {});
  const U = HX.util;
  const L = HX.layout;
  const S = HX.score;
  const { ramp, windowAt, clamp, seed } = U;

  const CAST = L.ITEMS.filter((i) => i.life).map((i) => ({
    id: i.actor || i.id,
    sprite: i.id,
    life: i.life,
    role: i.role || null,
    section: i.section,
    item: i
  }));

  /* ---------------- 时间轴编组 ---------------- */

  // 编组节奏：period 一个循环，offset 让各组错开
  const CYCLES = {
    tray: { period: 34, offset: 4 }
  };

  function localTime(id, time) {
    const c = CYCLES[id] || { period: 40, offset: 0 };
    const abs = time + c.offset;
    return { t: abs - Math.floor(abs / c.period) * c.period, cycle: Math.floor(abs / c.period) };
  }

  // 行走位移：去程 + 回程，速度由此自然产生
  function walk(home, to, t, a, b, c, d, cycle, step) {
    const span = Math.abs(to - home);
    const u = ramp(t, a, b) - ramp(t, c, d);
    const x = home + (to - home) * u;
    const speed = ((ramp(t + 0.005, a, b) - ramp(t - 0.005, a, b)) -
      (ramp(t + 0.005, c, d) - ramp(t - 0.005, c, d))) / 0.01 * span * Math.sign(to - home);
    return {
      x,
      walking: Math.abs(speed) > 14,
      gaitWeight: clamp(Math.abs(speed) / 90),
      dir: speed === 0 ? 0 : Math.sign(speed),
      phase: (span * (ramp(t, a, b) + ramp(t, c, d)) + cycle * span * 2) * 0.05 * (step || 1)
    };
  }

  /* ---------------- 底子：呼吸、重心、顾盼 ---------------- */

  const n1 = (x, s) => U.noise1(x, s) * 2 - 1;

  // 每人一副脾性：节律快慢、相位、沉静程度
  const personas = new Map();
  function persona(a) {
    let P = personas.get(a.sprite);
    if (!P) {
      const s = (U.hashString(a.sprite) % 997) + 1;
      P = {
        s,
        ph: seed(s * 1.31),
        tempo: 0.84 + 0.32 * seed(s * 2.17),
        calm: seed(s * 3.07),
        nodder: seed(s * 4.41) > 0.35
      };
      personas.set(a.sprite, P);
    }
    return P;
  }

  // 顾盼：每隔十来秒转一下头，停两三秒再回来
  function glance(P, t) {
    const period = 10 + P.calm * 9;
    const x = t + P.ph * period;
    const slot = Math.floor(x / period);
    const u = x - slot * period;
    const hold = 2 + seed(slot * 1.3 + P.s) * 2.2;
    const w = windowAt(u, 0.4, 1.5, 1.5 + hold, 2.8 + hold);
    const dir = seed(slot * 1.7 + P.s) > 0.5 ? 1 : -1;
    const kind = seed(slot * 2.3 + P.s);
    return { look: dir * 3.2 * w, nod: (kind > 0.62 ? 0.026 : kind < 0.25 ? -0.018 : 0.008) * w };
  }

  function alive(a, t, amp = 1) {
    const P = persona(a);
    const tt = t * P.tempo;
    // 呼吸：约 4 秒一息，吸短呼长
    const bp = (tt * 0.24 + P.ph) % 1;
    const inhale = bp < 0.38 ? U.smooth(bp / 0.38) : 1 - U.smooth((bp - 0.38) / 0.62);
    const i0 = inhale - 0.5;
    // 重心：两层极慢的噪声
    const w = n1(tt * 0.07, P.s) * 0.7 + n1(tt * 0.19, P.s + 7) * 0.3;
    const g = glance(P, tt);
    return {
      breath: 0.006 * amp * i0,
      sway: 2.8 * amp * w,
      lean: 0.004 * amp * n1(tt * 0.05, P.s + 3) + 0.0015 * amp * i0,
      nod: 0.012 * amp * n1(tt * 0.11, P.s + 11) - 0.006 * amp * i0 + g.nod * amp,
      look: g.look * amp,
      lift: -0.8 * amp * i0
    };
  }

  // 朝关注点的方向：+1 在右，-1 在左（翻面时镜像）
  const toward = (a, flip) => (a.focus == null ? 0 : Math.sign(a.focus - a.x) || 0) * (flip ? -1 : 1);
  const mixOf = (st, sec) => (st.mix && st.mix[sec] != null ? st.mix[sec] : 1);
  const score = (track, t, decay) => (S ? S.env(track, t, decay) : 0);

  /* ---------------- 各人的行为 ---------------- */

  const STORIES = {
    idle(a, t) {
      return { pose: alive(a, t) };
    },

    // 群像低语：说话时点头的节奏像说话，身子朝同伴倾
    murmur(a, t) {
      const P = persona(a);
      const x = (t + P.ph * 14) % 14;
      const talk = windowAt(x, 1.5, 2.6, 6.2, 7.6);
      const p = alive(a, t);
      p.lean += 0.006 * talk;
      p.nod += talk * (0.016 * Math.sin(t * 3.1 + P.s) + 0.01 * Math.sin(t * 5.3 + P.s * 2));
      p.look += talk * 1.5;
      return { pose: p };
    },

    // 听乐 · 主人：听而不笑，随句首微微点头，眼光偶向琵琶
    host(a, t, st) {
      const sense = st.listening * mixOf(st, 'listen');
      const p = alive(a, t, 0.75);
      const ph = S ? S.phrase(t) : { beat: 0 };
      const down = Math.exp(-(ph.beat % 4) * 1.6);
      const dir = toward(a);
      p.nod += 0.018 + 0.03 * sense * down;
      p.lean += 0.004 * sense * dir;
      p.look += 2.4 * sense * dir;
      return { pose: p };
    },

    // 听乐 · 宾客与侍立者：朝琵琶倾身，有人跟着拍子点头
    listen(a, t, st) {
      const P = persona(a);
      const sense = st.listening * mixOf(st, 'listen');
      const p = alive(a, t);
      const dir = toward(a);
      p.lean += 0.006 * sense * dir;
      p.look += 2 * sense * dir;
      if (P.nodder) p.nod += 0.022 * sense * score('pipa', t, 2.4);
      p.nod += 0.01;
      return { pose: p };
    },

    // 听乐 · 李家小妹：右手随乐谱落指，头随拨弦轻点，旋律走高时身子微挺
    pipa(a, t, st) {
      const play = clamp(mixOf(st, 'listen') * 1.4);
      const e = Math.max(score('pipa', t, 11) * play, st.pluck || 0);
      const p = alive(a, t, 0.6);
      const n = S ? S.noteAt('pipa', t) : null;
      const contour = n ? (n.midi - 69) / 12 : 0;
      p.parts = { hand: -0.05 + 0.2 * e };
      p.nod += 0.02 + 0.018 * e;
      p.lean += -0.003 * contour * play;
      return { pose: p, prop: { kind: 'pipa', pluck: st.pluck } };
    },

    // 观舞 · 主人擂鼓：舞起时按鼓谱落槌；观者击鼓时由观者的鼓点驱动
    drummer(a, t, st) {
      const d = st.dance;
      const auto = st.danceAuto ? score('drum', t, 12) : 0;
      const hit = Math.max(d.hit || 0, auto);
      const p = alive(a, t, 0.55);
      p.parts = {
        stick: 0.2 * (d.charge || 0) + (st.danceAuto ? 0.1 : 0) - 0.34 * hit + 0.04 * Math.sin(t * 1.3)
      };
      p.nod += 0.02 + hit * 0.03;
      p.lean += 0.004 + hit * 0.01;
      return { pose: p };
    },

    // 观舞 · 王屋山：姿态全部来自状态机，渲染层负责两张姿势的交叉淡入
    dancer(a, t, st) {
      const d = st.dance;
      const b = alive(a, t, 0.5);
      return {
        dance: true,
        pose: {
          dx: Math.sin(d.phase * 0.42) * 10 * (0.3 + d.spin),
          sway: Math.sin(d.phase * 0.9) * 8 * (0.3 + d.hem) + b.sway,
          hem: 0.1 * d.hem,
          breath: b.breath,
          nod: b.nod * 0.5
        }
      };
    },

    // 观舞 · 击掌应节：舞起时踩在拍子上
    clap(a, t, st) {
      const d = st.dance;
      const P = persona(a);
      const auto = st.danceAuto ? score('clap', t, 10) : 0;
      const pulse = Math.max((d.beat || 0) * (0.6 + 0.4 * Math.sin(t * 6 + P.s)), auto);
      const p = alive(a, t);
      const dir = toward(a);
      p.nod += 0.02 * pulse;
      p.bob = 2.6 * pulse;
      p.lean += 0.005 * pulse + 0.004 * dir * mixOf(st, 'dance');
      p.look += 1.6 * dir;
      return { pose: p };
    },

    // 观舞 · 德明和尚：叉手垂目，不随鼓，偶尔把目光移开
    monk(a, t) {
      const p = alive(a, t, 0.45);
      p.nod += 0.03;
      p.look -= 1.2;
      return { pose: p };
    },

    // 观舞 · 旁观：朝舞者倾身，鼓点上点头
    watch(a, t, st) {
      const d = st.dance;
      const p = alive(a, t);
      const dir = toward(a);
      const beat = Math.max(d.beat || 0, st.danceAuto ? score('drum', t, 4) : 0);
      p.nod += 0.015 + 0.026 * beat;
      p.lean += 0.006 * dir * (0.4 + 0.6 * beat);
      p.look += 2 * dir;
      return { pose: p };
    },

    // 歇息 · 主人洗手：低头看手，双手一阵一阵地搓
    wash(a, t, st) {
      const w = st.wash;
      const P = persona(a);
      const x = (t + P.ph * 9) % 9;
      const rub = windowAt(x, 0.5, 1.4, 5, 6.2) * w;
      const p = alive(a, t, 0.6);
      p.parts = { hands: rub * (0.03 * Math.sin(t * 2.7) + 0.016 * Math.sin(t * 4.3 + 1)) - 0.01 * w };
      p.nod += 0.02 + 0.03 * w;
      p.lean += 0.008 * w + 0.003 * rub;
      return { pose: p };
    },

    // 歇息 · 托盘侍女：往床前送酒具，再回原处
    tray(a, t) {
      const { t: lt, cycle } = localTime('tray', t);
      const mv = walk(0, -150, lt, 6, 14, 20, 28, cycle);
      let stage = 'stand';
      if (lt >= 6 && lt < 14) stage = 'go';
      else if (lt >= 14 && lt < 20) stage = 'serve';
      else if (lt >= 20 && lt < 28) stage = 'return';
      const g = mv.gaitWeight;
      const step = Math.sin(mv.phase);
      const p = alive(a, t, 1 - g);
      p.dx = mv.x;
      p.flip = mv.dir > 0;
      p.bob = (p.bob || 0) + Math.abs(step) * 5 * g;
      p.sway += step * 7 * g;
      p.lean += 0.01 * g + 0.012 * windowAt(lt, 14, 15, 18.5, 19.5);
      return { stage, walking: mv.walking, pose: p };
    },

    // 清吹 · 五女乐：句末换气（微微后仰、胸口一提），句中随旋律起伏
    flute(a, t, st) {
      const e = st.ensemble;
      const i = Number(a.id.slice(2)) || 1;
      const ph = S ? S.phrase(t) : { u: 0, breath: 0 };
      const onset = score(i === 1 ? 'bili' : 'flute', t, 5);
      const p = alive(a, t, 0.7);
      p.breath += 0.009 * ph.breath * e;
      p.lean += (-0.005 * ph.breath + 0.003 * Math.sin(ph.u * Math.PI * 2 + i * 0.9)) * e;
      p.sway += Math.sin(ph.u * Math.PI * 2 + i * 1.3) * 2.4 * e;
      p.nod += 0.01 * onset * e - 0.012 * ph.breath * e;
      return { pose: p, prop: { kind: 'flute', playing: e, i } };
    },

    // 清吹 · 执拍板者：每半句一击
    paiban(a, t, st) {
      const e = st.ensemble;
      const pulse = score('paiban', t, 12) * e;
      const p = alive(a, t);
      p.nod += 0.024 * pulse;
      p.bob = 2.4 * pulse;
      p.lean += 0.004 * pulse;
      return { pose: p };
    },

    // 清吹 · 主人执扇：扇子一拍一摇，笛声起时摇得更开
    fan(a, t, st) {
      const e = st.ensemble;
      const beats = S ? S.beatsOf(t) : t;
      const p = alive(a, t, 0.55);
      p.parts = { fan: Math.sin(beats * Math.PI / 2) * (0.05 + 0.11 * e) };
      p.nod += 0.012 * e * Math.sin(beats * Math.PI / 4);
      return { pose: p };
    },

    // 送别 · 主人执槌：手一抬一落，似在作别
    bye(a, t, st) {
      const bow = st.depart;
      const P = persona(a);
      const x = (t + P.ph * 8) % 8;
      const raise = windowAt(x, 0.6, 2.2, 4.4, 6.2) * bow;
      const p = alive(a, t, 0.75);
      p.parts = { hand: -0.11 * raise + 0.015 * Math.sin(t * 0.9) };
      p.nod += 0.02 + 0.035 * raise;
      p.lean += 0.007 * bow;
      return { pose: p };
    }
  };

  /* ---------------- 平滑：临界阻尼弹簧 ---------------- */

  // 各量的跟随速度（rad/s），越大越跟手
  const OMEGA = { lean: 5, sway: 4.5, nod: 7, look: 4.5, lift: 6, breath: 9, bob: 15, hem: 7, chest: 9 };
  const PART_OMEGA = { stick: 28, hand: 24, hands: 11, fan: 12 };

  function damp(s, target, omega, dt) {
    const x = omega * dt;
    const k = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = s.x - target;
    const tmp = (s.v + omega * change) * dt;
    s.v = (s.v - omega * tmp) * k;
    s.x = target + (change + tmp) * k;
  }

  /* ---------------- 导演 ---------------- */

  class Director {
    constructor(atlas) {
      this.atlas = atlas || HX.figureAtlas || {};
      this.cast = CAST.map((a) => {
        const pl = L.place(a.item, this.atlas);
        return Object.assign({}, a, {
          place: pl,
          x: pl ? pl.x : L.wx((a.item.box[0] + a.item.box[2]) / 2),
          y: pl ? pl.foot : L.wy(a.item.box[3]),
          h: (a.item.box[3] - a.item.box[1]) * L.K
        });
      });
      // 各段的关注点：演奏者、舞者、主人
      const at = (sprite) => (this.cast.find((c) => c.sprite === sprite) || {}).x;
      const band = this.cast.filter((c) => c.life === 'flute');
      const focus = {
        listen: at('l-limei'),
        dance: at('d-dancer'),
        rest: at('r-han'),
        flute: band.length ? band.reduce((s, c) => s + c.x, 0) / band.length : null,
        farewell: at('b-han')
      };
      for (const c of this.cast) c.focus = focus[c.section];
      this.events = [];
      this.lastStage = new Map();
      this.mem = new Map();
      this.lastTime = null;
    }

    // state: { time, listening, pluck, ensemble, wash, depart, dance, mix?, danceAuto? }
    // 不带平滑的原始姿态
    sample(state) {
      const t = state.time;
      const actors = [];
      for (const a of this.cast) {
        const fn = STORIES[a.life] || STORIES.idle;
        const patch = fn(a, t, state) || {};
        const actor = Object.assign({}, a, patch);
        actor.pose = patch.pose || {};
        actor.x = a.x + (actor.pose.dx || 0);
        actors.push(actor);
        if (patch.stage && this.lastStage.get(a.id) !== patch.stage) {
          this.lastStage.set(a.id, patch.stage);
          this.events.push({ id: a.id, stage: patch.stage, x: actor.x });
        }
      }
      return { actors, events: this.events };
    }

    // 逐帧推进：原始姿态经弹簧平滑；时间倒退或跳得太远时直接落位
    advance(state) {
      this.events = [];
      const out = this.sample(state);
      const dt = this.lastTime == null ? 0 : state.time - this.lastTime;
      this.lastTime = state.time;
      const snap = !(dt > 0 && dt < 0.5);
      for (const a of out.actors) {
        let m = this.mem.get(a.id);
        if (!m) { m = { pose: {}, parts: {} }; this.mem.set(a.id, m); }
        const pose = a.pose;
        for (const key in OMEGA) {
          const target = pose[key] || 0;
          let s = m.pose[key];
          if (!s) s = m.pose[key] = { x: target, v: 0 };
          if (snap) { s.x = target; s.v = 0; } else damp(s, target, OMEGA[key], dt);
          if (pose[key] != null || Math.abs(s.x) > 1e-6) pose[key] = s.x;
        }
        if (pose.parts) {
          for (const key in pose.parts) {
            const target = pose.parts[key];
            let s = m.parts[key];
            if (!s) s = m.parts[key] = { x: target, v: 0 };
            if (snap) { s.x = target; s.v = 0; } else damp(s, target, PART_OMEGA[key] || 12, dt);
            pose.parts[key] = s.x;
          }
        }
      }
      return out;
    }

    at(id) {
      return this.cast.find((a) => a.id === id || a.sprite === id);
    }
  }

  HX.life = { CAST, STORIES, Director, CYCLES, walk, localTime, alive, damp };
})(typeof window !== 'undefined' ? window : globalThis);
