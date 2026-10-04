/* 声音：全部用 Web Audio 合成，不依赖任何音频文件。
   首次点击才创建 AudioContext；声场按对象在画面里的位置计算。

   配乐按 score.js 的乐谱排程：每帧把未来 0.25 秒内的起音换算到音频时钟上提前排好，
   各段的乐器随镜头所在的位置交叉淡入淡出——听乐是琵琶，观舞是琵琶伴鼓与击掌，
   歇息是琴，清吹是四笛一筚篥加拍板，送别只剩几声余音。画中人的动作也读同一份乐谱，
   所以琵琶女落指、乐女换气，都与听到的音对得上。 */
(function (root) {
  'use strict';
  const HX = (root.HX = root.HX || {});
  const S = HX.score;

  // 五声音阶（宫商角徵羽），供点击时的短音
  const SCALE = [293.66, 329.63, 369.99, 440.0, 493.88, 587.33, 659.25];
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function noiseBuffer(ctx, seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  }

  function whiteBuffer(ctx, seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // 拨弦乐器的泛音表：基音强，二三次泛音明显，高次迅速变弱
  function pluckWave(ctx, partials) {
    const real = new Float32Array(partials.length + 1);
    const imag = new Float32Array(partials.length + 1);
    partials.forEach((v, i) => { imag[i + 1] = v; });
    return ctx.createPeriodicWave(real, imag);
  }

  // 各段配乐的声部与音量
  const MIX = {
    listen: [['pipa', 1]],
    dance: [['dance', 0.75], ['drum', 1], ['clap', 1]],
    rest: [['qin', 1]],
    farewell: [['coda', 1]]
  };

  class Sound {
    constructor() {
      this.ctx = null;
      this.enabled = false;
      this.voices = new Map();
      this.dripTimer = 0;
      this.until = null;       // 已排程到的乐谱时间
    }

    get ready() { return !!this.ctx; }

    // 必须由用户手势触发
    enable() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        this.enabled = true;
        return true;
      }
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return false;
      // iPhone 的静音键默认连网页音频一起静掉；声明为"播放"类音频后，配乐按媒体音量走
      try { if (root.navigator && root.navigator.audioSession) root.navigator.audioSession.type = 'playback'; } catch (_) { /* 旧版浏览器没有此接口 */ }
      try {
        this.ctx = new AC();
      } catch (e) {
        return false;
      }
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.0001;

      // 轻微的厅堂混响：两条交叉反馈的延迟
      this.dry = ctx.createGain();
      this.wet = ctx.createGain();
      this.wet.gain.value = 0.22;
      const d1 = ctx.createDelay(1), d2 = ctx.createDelay(1);
      d1.delayTime.value = 0.113; d2.delayTime.value = 0.171;
      const fb1 = ctx.createGain(), fb2 = ctx.createGain();
      fb1.gain.value = 0.42; fb2.gain.value = 0.38;
      const damp = ctx.createBiquadFilter();
      damp.type = 'lowpass'; damp.frequency.value = 2600;
      this.master.connect(this.dry).connect(ctx.destination);
      this.master.connect(damp);
      damp.connect(d1); damp.connect(d2);
      d1.connect(fb2).connect(d2);
      d2.connect(fb1).connect(d1);
      d1.connect(this.wet); d2.connect(this.wet);
      this.wet.connect(ctx.destination);

      this.noiseBuf = noiseBuffer(ctx, 4);
      this.whiteBuf = whiteBuffer(ctx, 1);
      this.waves = {
        pipa: pluckWave(ctx, [1, 0.55, 0.42, 0.22, 0.16, 0.08, 0.05, 0.03]),
        qin: pluckWave(ctx, [1, 0.36, 0.12, 0.06, 0.03])
      };

      // 房间底噪：极轻的风声与远处人语感
      this.noise = ctx.createBufferSource();
      this.noise.buffer = this.noiseBuf;
      this.noise.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      this.roomGain = ctx.createGain();
      this.roomGain.gain.value = 0.04;
      this.noise.connect(lp).connect(this.roomGain).connect(this.master);
      this.noise.start();

      // 夜的持续低音：宫与徵
      this.drone = ctx.createGain();
      this.drone.gain.value = 0.04;
      this.drone.connect(this.master);
      for (const f of [73.42, 110.0, 146.83]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.value = 0.4;
        o.connect(g).connect(this.drone);
        o.start();
      }
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.02;
      lfo.connect(lfoGain).connect(this.drone.gain);
      lfo.start();

      // 各段配乐的总线
      this.music = {};
      for (const sec of Object.keys(MIX)) {
        const g = ctx.createGain();
        g.gain.value = 0.0001;
        g.connect(this.master);
        this.music[sec] = g;
      }

      this.enabled = true;
      this.until = null;
      this.master.gain.setTargetAtTime(0.85, ctx.currentTime, 1.2);
      return true;
    }

    setEnabled(on) {
      if (on) {
        if (!this.enable()) return false;
        this.master.gain.setTargetAtTime(0.85, this.ctx.currentTime, 0.6);
      } else if (this.ctx) {
        this.master.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.5);
        this.enabled = false;
      }
      return this.enabled;
    }

    panFor(x, view) {
      if (!view) return 0;
      const c = (view.x0 + view.x1) / 2;
      const half = Math.max(200, (view.x1 - view.x0) / 2);
      return Math.max(-1, Math.min(1, (x - c) / half));
    }

    bus(x, view, volume, dest) {
      const ctx = this.ctx;
      const p = ctx.createStereoPanner();
      p.pan.value = this.panFor(x, view);
      const g = ctx.createGain();
      g.gain.value = volume;
      g.connect(p).connect(dest || this.master);
      g.pan = p;              // 供 update() 移动声场
      return g;
    }

    /* ---------------- 乐器 ---------------- */

    // 琵琶：周期波起振，低通快速收拢，带一点拨片噪声
    pipaNote(when, midi, vel, out, kind) {
      const ctx = this.ctx;
      const f = mtof(midi);
      const len = kind === 'trem' ? 0.32 : kind === 'bass' ? 2.2 : 1.6;
      const o = ctx.createOscillator();
      o.setPeriodicWave(this.waves.pipa);
      o.frequency.setValueAtTime(f * 1.012, when);
      o.frequency.exponentialRampToValueAtTime(f, when + 0.04);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.6;
      lp.frequency.setValueAtTime(Math.min(9000, f * 9), when);
      lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 2.2), when + 0.35);
      const g = ctx.createGain();
      const peak = 0.34 * vel;
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(peak, when + 0.005);
      g.gain.exponentialRampToValueAtTime(peak * 0.35, when + 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, when + len);
      o.connect(lp).connect(g).connect(out);
      o.start(when);
      o.stop(when + len + 0.05);
      if (kind !== 'trem') this.click(when, f * 3.4, 0.12 * vel, 0.05, out);
    }

    // 琴：低沉、余韵长；起音由下滑上（绰），后段加一点吟
    qinNote(when, midi, vel, out, kind) {
      const ctx = this.ctx;
      const f = mtof(midi);
      if (kind === 'harm') {
        // 泛音：纯净的高音，像玉磬
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(0.12 * vel, when + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 2.6);
        o.connect(g).connect(out);
        o.start(when);
        o.stop(when + 2.7);
        return;
      }
      const o = ctx.createOscillator();
      o.setPeriodicWave(this.waves.qin);
      o.frequency.setValueAtTime(f * 0.944, when);
      o.frequency.exponentialRampToValueAtTime(f, when + 0.18);
      const vib = ctx.createOscillator();
      vib.frequency.value = 4.6;
      const vg = ctx.createGain();
      vg.gain.setValueAtTime(0, when);
      vg.gain.linearRampToValueAtTime(f * 0.006, when + 1.2);
      vib.connect(vg).connect(o.frequency);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(f * 6, when);
      lp.frequency.exponentialRampToValueAtTime(f * 1.6, when + 1.4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(0.4 * vel, when + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 4.2);
      o.connect(lp).connect(g).connect(out);
      o.start(when); vib.start(when);
      o.stop(when + 4.3); vib.stop(when + 4.3);
      this.click(when, f * 4, 0.05 * vel, 0.04, out);
    }

    click(when, freq, level, len, out) {
      const ctx = this.ctx;
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = Math.min(9000, freq);
      bp.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(level, when);
      g.gain.exponentialRampToValueAtTime(0.0001, when + len);
      n.connect(bp).connect(g).connect(out);
      n.start(when, Math.random() * 3);
      n.stop(when + len + 0.02);
    }

    // 击掌：两三下极短的噪声簇
    clapAt(when, vel, out) {
      const ctx = this.ctx;
      for (let i = 0; i < 3; i++) {
        const t = when + i * 0.011;
        const n = ctx.createBufferSource();
        n.buffer = this.whiteBuf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1500;
        bp.Q.value = 0.9;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.16 * vel * (i === 2 ? 1 : 0.6), t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + (i === 2 ? 0.09 : 0.012));
        n.connect(bp).connect(g).connect(out);
        n.start(t, Math.random() * 0.8);
        n.stop(t + 0.12);
      }
    }

    // 拍板：檀木相击，短而亮
    paibanAt(when, vel, out) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(1350, when);
      o.frequency.exponentialRampToValueAtTime(820, when + 0.04);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(0.2 * vel, when + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.08);
      o.connect(g).connect(out);
      o.start(when);
      o.stop(when + 0.1);
      this.click(when, 2800, 0.18 * vel, 0.035, out);
    }

    // 琵琶拨弦（点击琵琶时）
    pluck(x, view, note) {
      if (!this.enabled || !this.ctx) return;
      const out = this.bus(x, view, 0.9);
      const f = SCALE[note == null ? 3 : note % SCALE.length];
      this.pipaNote(this.ctx.currentTime, 69 + 12 * Math.log2(f / 440), 1, out, 'pluck');
    }

    // 羯鼓：低频冲击 + 鼓皮噪声。力度越猛，音越高越硬。
    drum(x, view, force = 0.6, when, out) {
      if (!this.enabled || !this.ctx) return;
      const ctx = this.ctx, t = when == null ? ctx.currentTime : when;
      out = out || this.bus(x, view, 0.5);
      const f0 = 128 + force * 42;

      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.16);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.85, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (force > 0.85 ? 0.5 : 0.34));
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.6);

      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900 + force * 1400;
      bp.Q.value = 0.8;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.28 + force * 0.4, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      n.connect(bp).connect(ng).connect(out);
      n.start(t);
      n.stop(t + 0.12);
    }

    // 更漏滴答
    drip(x, view) {
      if (!this.enabled || !this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const out = this.bus(x, view, 0.12);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(1180, t);
      o.frequency.exponentialRampToValueAtTime(620, t + 0.09);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.55, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.2);
    }

    // 横笛 / 筚篥：常驻的发声体，音高与气口由乐谱驱动
    windVoice(id, x, view) {
      const ctx = this.ctx, t = ctx.currentTime;
      const bili = id === 'mu1';
      const out = this.bus(x, view, 0.0001);
      const o = ctx.createOscillator();
      o.type = bili ? 'sawtooth' : 'triangle';
      o.frequency.value = 440;
      o.detune.value = (Number(id.slice(2)) - 3) * 4;
      const vib = ctx.createOscillator();
      vib.frequency.value = 4.6 + (Number(id.slice(2)) % 3) * 0.35;
      const vibGain = ctx.createGain();
      vibGain.gain.value = bili ? 2.4 : 5;
      vib.connect(vibGain).connect(o.frequency);
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = bili ? 1400 : 3200;
      tone.Q.value = bili ? 2.2 : 0.7;
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      const breath = ctx.createBufferSource();
      breath.buffer = this.noiseBuf;
      breath.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = bili ? 1200 : 2600;
      bp.Q.value = 0.9;
      const bg = ctx.createGain();
      bg.gain.value = 0.0001;
      o.connect(tone).connect(g).connect(out);
      breath.connect(bp).connect(bg).connect(out);
      o.start(t); vib.start(t); breath.start(t, Math.random() * 3);
      const voice = { out, o, g, bg, bili };
      this.voices.set(id, voice);
      return voice;
    }

    /* ---------------- 排程 ---------------- */

    // time：乐谱时间（与画面同一条时钟）；mix：各段的权重；opts.danceAuto：舞正起
    schedule(time, mix, opts, view, band) {
      if (!S || !this.enabled) { this.until = null; return; }
      const ctx = this.ctx;
      const AHEAD = 0.25;
      if (this.until == null || time < this.until - 1 || time > this.until + 1) this.until = time;
      const t0 = this.until, t1 = time + AHEAD;
      if (t1 <= t0) return;
      const at = (t) => Math.max(ctx.currentTime, ctx.currentTime + (t - time));
      const still = opts.still || 0;

      for (const sec of Object.keys(MIX)) {
        const w = mix[sec] || 0;
        const level = (sec === 'dance' ? 0.85 : 1) * w * (1 - 0.45 * still);
        this.music[sec].gain.setTargetAtTime(Math.max(0.0001, level), ctx.currentTime, 0.6);
        if (w < 0.02) continue;
        for (const [track, vol] of MIX[sec]) {
          if ((track === 'drum' || track === 'clap') && !opts.danceAuto) continue;
          for (const ev of S.between(track, t0, t1)) {
            // 夜深时稀疏一些：轻的音按确定性的哈希略去
            if (still > 0.3 && ev.vel < 0.5 && ((ev.t * 7.3) % 1) < still * 0.7) continue;
            const when = at(ev.t);
            const out = this.music[sec];
            if (track === 'qin') this.qinNote(when, ev.midi, ev.vel * vol, out, ev.kind);
            else if (track === 'drum') this.drum(0, null, 0.35 + 0.4 * ev.vel, when, this.scaled(out, 0.42 * ev.vel));
            else if (track === 'clap') this.clapAt(when, ev.vel * vol, out);
            else this.pipaNote(when, ev.midi, ev.vel * vol, out, ev.kind);
          }
        }
      }

      // 清吹：横笛连奏、筚篥持续、拍板分句
      const e = opts.ensemble || 0;
      if (band && band.length && e > 0.02) {
        for (const a of band) {
          const v = this.voices.get(a.id) || this.windVoice(a.id, a.x, view);
          const track = v.bili ? 'bili' : 'flute';
          const lag = v.bili ? 0 : (Number(a.id.slice(2)) - 2) * 0.012;
          for (const ev of S.between(track, t0, t1)) {
            const when = at(ev.t + lag);
            const f = mtof(ev.midi);
            v.o.frequency.setTargetAtTime(f, when, v.bili ? 0.03 : 0.018);
            const level = (v.bili ? 0.32 : 0.42) * ev.vel;
            v.g.gain.setTargetAtTime(level, when, 0.035);
            v.bg.gain.setTargetAtTime(0.1 * ev.vel, when, 0.03);
            v.bg.gain.setTargetAtTime(0.035 * ev.vel, when + 0.12, 0.2);
            if (ev.last || v.bili) {
              v.g.gain.setTargetAtTime(0.0001, when + ev.dur, 0.06);
              v.bg.gain.setTargetAtTime(0.0001, when + ev.dur, 0.06);
            }
          }
        }
        const clap = band[0];
        for (const ev of S.between('paiban', t0, t1)) {
          this.paibanAt(at(ev.t), ev.vel * e, this.bus(clap.x - 300, view, 0.8));
        }
      }
      this.until = t1;
    }

    scaled(out, k) {
      const g = this.ctx.createGain();
      g.gain.value = k;
      g.connect(out);
      return g;
    }

    // 由场景状态驱动：配乐排程、清吹声场随视角移动、夜深则更安静
    update(state, view) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const target = this.enabled ? 1 : 0;
      const still = state.amb.still;
      const e = state.ensemble * (0.6 + 0.4 * (1 - still));
      const band = state.actors.filter((a) => a.prop && a.prop.kind === 'flute');
      for (const a of band) {
        const v = this.voices.get(a.id);
        if (!v) continue;
        v.out.gain.setTargetAtTime(0.16 * e * target, t, 0.3);
        v.out.pan.pan.setTargetAtTime(this.panFor(a.x, view), t, 0.25);
      }
      for (const [id, v] of this.voices) {
        if (band.some((a) => a.id === id)) continue;
        v.out.gain.setTargetAtTime(0.0001, t, 0.4);
      }
      if (this.roomGain) {
        this.roomGain.gain.setTargetAtTime(0.04 * (1 - 0.6 * still) * target, t, 0.8);
      }
      if (this.drone) {
        this.drone.gain.setTargetAtTime(0.04 * (1 - 0.5 * still) * target, t, 0.8);
      }
      if (state.time != null && state.mix) {
        this.schedule(state.time, state.mix, {
          danceAuto: state.danceAuto, still, ensemble: e
        }, view, band);
      }
    }

    silence() {
      if (this.ctx) this.master.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.2);
    }

    resumeVolume() {
      if (this.ctx && this.enabled) {
        this.master.gain.setTargetAtTime(0.85, this.ctx.currentTime, 0.4);
      }
    }
  }

  HX.audio = { Sound, SCALE, MIX };
})(typeof window !== 'undefined' ? window : globalThis);
