/* 乐谱：配乐与人物动作共用的一条时间线。

   旋律是一支 D 宫五声调式的小曲（简谱写成，64 拍一轮，♩=64），各段乐器从同一支旋律派生：
     pipa    听乐 · 琵琶：逐音拨弦，长音用轮指
     dance   观舞 · 琵琶伴舞，与 drum / clap 同拍
     drum    观舞 · 鼓点（六幺舞的节拍型）
     clap    观舞 · 击掌应节
     qin     歇息 · 琴：每半句一音，低八度，带吟猱；句末泛音
     flute   清吹 · 横笛：高八度连奏，句末留出换气
     bili    清吹 · 筚篥：持续的句根音
     paiban  清吹 · 拍板：每半句一击
     coda    送别 · 稀疏的琵琶余音
   这里只给出"什么时候、哪个音、多重"，纯数据，可脱离 Web Audio 测试；
   声音层按它排程，生活系统按它让琵琶女落指、乐女换气、宾客击掌。 */
(function (root) {
  'use strict';
  const HX = (root.HX = root.HX || {});

  const BPM = 64;
  const BEAT = 60 / BPM;
  const GONG = 62;                       // 宫音 D4

  // 简谱：1 2 3 5 6 → 宫商角徵羽；' 高八度，, 低八度；_ 半拍；- 延长一拍
  const PHRASES = [
    "5 6_ 1'_ 6 5 3_ 5_ 6 5 -",
    '3 2_ 3_ 5 3 2 1 2 -',
    '6, 1 2_ 3_ 5 6_ 5_ 3 2_ 1_ 2',
    '5 3_ 2_ 1 6, 1 2_ 3_ 1 -',
    "1' 6_ 5_ 6 1' 2'_ 1'_ 6 5 -",
    '6 5_ 3_ 5 6 3 2 3 -',
    '2 3_ 5_ 6 5_ 3_ 2 1 6, -',
    '1 2_ 3_ 2 1_ 6,_ 5, 6, 1 -'
  ];
  const PHRASE_BEATS = 8;
  const DEG = { 1: 0, 2: 2, 3: 4, 5: 7, 6: 9 };

  function parsePhrase(src, start, index) {
    const out = [];
    let b = start;
    for (const tok of src.trim().split(/\s+/)) {
      if (tok === '-') {
        if (out.length) out[out.length - 1].d += 1;
        b += 1;
        continue;
      }
      const m = /^([0-7])([',]*)(_?)$/.exec(tok);
      if (!m) throw new Error('乐谱无法解析：' + tok);
      const d = m[3] ? 0.5 : 1;
      if (m[1] !== '0') {
        let semi = DEG[m[1]];
        for (const c of m[2]) semi += c === "'" ? 12 : -12;
        out.push({ b, d, semi, phrase: index, first: out.length === 0 });
      }
      b += d;
    }
    if (Math.abs(b - start - PHRASE_BEATS) > 1e-9) {
      throw new Error('第 ' + (index + 1) + ' 句不是 ' + PHRASE_BEATS + ' 拍：' + (b - start));
    }
    out[out.length - 1].last = true;
    return out;
  }

  const MELODY = PHRASES.flatMap((p, i) => parsePhrase(p, i * PHRASE_BEATS, i));
  const LOOP = PHRASES.length * PHRASE_BEATS;

  function melodyAt(b) {
    const x = ((b % LOOP) + LOOP) % LOOP;
    let hit = MELODY[0];
    for (const n of MELODY) {
      if (n.b <= x + 1e-9) hit = n;
      else break;
    }
    return hit;
  }

  /* ---------------- 各声部（一轮内的起音表） ---------------- */

  function buildTracks() {
    const T = {};
    const midi = (n, oct = 0) => GONG + n.semi + oct * 12;

    T.pipa = [];
    for (const n of MELODY) {
      T.pipa.push({ b: n.b, d: n.d, midi: midi(n), vel: n.first ? 1 : 0.78, kind: 'pluck' });
      if (n.d >= 2) {
        // 轮指：长音上的密集轻拨
        for (let x = n.b + 0.25, i = 0; x < n.b + n.d - 0.2; x += 0.125, i++) {
          T.pipa.push({ b: x, d: 0.125, midi: midi(n), vel: 0.42 - i * 0.018, kind: 'trem' });
        }
      }
      if (n.b % PHRASE_BEATS === 0) {
        T.pipa.push({ b: n.b, d: 2, midi: midi(n, -1), vel: 0.5, kind: 'bass' });
      }
    }

    T.dance = MELODY.map((n) => ({ b: n.b, d: n.d, midi: midi(n), vel: 0.62, kind: 'pluck' }));

    T.drum = [];
    T.clap = [];
    for (let bar = 0; bar < LOOP; bar += 4) {
      for (const [o, v] of [[0, 1], [1.5, 0.5], [2, 0.8], [3, 0.6], [3.5, 0.42]]) {
        T.drum.push({ b: bar + o, d: 0.5, vel: v, kind: 'drum' });
      }
      for (const [o, v] of [[0, 0.7], [1, 0.4], [2, 0.6], [3, 0.4]]) {
        T.clap.push({ b: bar + o, d: 0.25, vel: v, kind: 'clap' });
      }
    }

    T.qin = [];
    for (let b = 0; b < LOOP; b += 4) {
      const n = melodyAt(b);
      T.qin.push({ b, d: 4, midi: GONG + n.semi - 12, vel: b % PHRASE_BEATS === 0 ? 0.9 : 0.65, kind: 'qin' });
      if (b % PHRASE_BEATS === 4) {
        T.qin.push({ b: b + 3, d: 1, midi: GONG + 24, vel: 0.35, kind: 'harm' });
      }
    }

    // 横笛连奏：句末一音缩短，留出换气
    T.flute = MELODY.map((n) => ({
      b: n.b,
      d: n.last ? Math.max(0.35, n.d - 0.6) : n.d,
      midi: midi(n, 1),
      vel: n.first ? 0.95 : 0.8,
      kind: 'flute',
      last: !!n.last
    }));

    T.bili = [];
    for (let b = 0; b < LOOP; b += 4) {
      const n = melodyAt(b);
      T.bili.push({ b, d: 3.6, midi: GONG + (n.semi % 12), vel: 0.7, kind: 'bili' });
    }

    T.paiban = [];
    for (let b = 0; b < LOOP; b += 4) T.paiban.push({ b, d: 0.25, vel: b % 8 === 0 ? 1 : 0.6, kind: 'paiban' });

    T.coda = MELODY.filter((n) => n.b % 4 === 0).map((n) => ({
      b: n.b, d: 4, midi: midi(n), vel: 0.42, kind: 'pluck'
    }));

    for (const k in T) T[k].sort((a, c) => a.b - c.b);
    return T;
  }

  const TRACKS = buildTracks();

  /* ---------------- 查询 ---------------- */

  const beatsOf = (t) => t / BEAT;

  // [t0, t1) 内的起音，时间为绝对秒
  function between(track, t0, t1) {
    const list = TRACKS[track];
    if (!list || t1 <= t0) return [];
    const b0 = beatsOf(t0), b1 = beatsOf(t1);
    const out = [];
    for (let k = Math.floor(b0 / LOOP); k <= Math.floor(b1 / LOOP); k++) {
      const base = k * LOOP;
      for (const ev of list) {
        const b = base + ev.b;
        if (b >= b0 && b < b1) out.push(Object.assign({ t: b * BEAT, dur: ev.d * BEAT }, ev));
      }
    }
    return out;
  }

  // t 之前（含）最近的一次起音
  function last(track, t) {
    const list = TRACKS[track];
    if (!list || !list.length) return null;
    const b = beatsOf(t);
    const k = Math.floor(b / LOOP);
    const x = b - k * LOOP;
    let lo = 0, hi = list.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].b <= x + 1e-9) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (idx < 0) {
      const ev = list[list.length - 1];
      return Object.assign({ t: ((k - 1) * LOOP + ev.b) * BEAT, dur: ev.d * BEAT }, ev);
    }
    const ev = list[idx];
    return Object.assign({ t: (k * LOOP + ev.b) * BEAT, dur: ev.d * BEAT }, ev);
  }

  // 起音后的衰减包络：0..vel
  function env(track, t, decay = 8) {
    const ev = last(track, t);
    if (!ev) return 0;
    return ev.vel * Math.exp(-(t - ev.t) * decay);
  }

  // 乐句里的位置：u 为句内进度 0..1，breath 在句末换气时升到 1
  function phrase(t) {
    const b = beatsOf(t);
    const x = ((b % PHRASE_BEATS) + PHRASE_BEATS) % PHRASE_BEATS;
    const u = x / PHRASE_BEATS;
    const gap = x > PHRASE_BEATS - 0.75 ? 1 : 0;
    const breath = Math.max(0, Math.min(1, (x - (PHRASE_BEATS - 0.9)) / 0.6));
    const index = ((Math.floor(b / PHRASE_BEATS) % PHRASES.length) + PHRASES.length) % PHRASES.length;
    return { u, beat: x, index, gap, breath };
  }

  // 正在发声的旋律音（横笛等连奏声部用）
  function noteAt(track, t) {
    const ev = last(track, t);
    if (!ev) return null;
    return Object.assign({ on: t < ev.t + ev.dur, u: (t - ev.t) / Math.max(1e-3, ev.dur) }, ev);
  }

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  HX.score = {
    BPM, BEAT, LOOP, PHRASE_BEATS, GONG, PHRASES, MELODY, TRACKS,
    between, last, env, phrase, noteAt, mtof, beatsOf
  };
})(typeof window !== 'undefined' ? window : globalThis);
