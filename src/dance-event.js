/* 观舞 · 六幺舞：状态机 + 玩家输入 → 物理量。
   与"虹桥过船"同构：玩家给的是力度，不是播放键；用力过猛反而坏事。 */
(function (root) {
  'use strict';
  const HX = (root.HX = root.HX || {});
  const U = HX.util;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const smooth = (u) => { u = clamp(u); return u * u * (3 - 2 * u); };

  const STAGE_TEXT = {
    idle: '六幺舞',
    approach: '宾客请主人击鼓',
    call: '鼓在榻前 · 按住鼓面蓄力，松开击鼓',
    raise: '鼓声一起，舞者起身',
    step: '踏节而行 · 鼓声别急',
    spin: '旋裙如风 · 稳住节拍',
    close: '收势 · 满堂喝彩',
    record: '画师正在写照',
    complete: '六幺舞已录入画稿'
  };

  // 最优力度：偏离越远，鼓点越无用
  const IDEAL = 0.56;
  const TOLERANCE = 0.32;

  class Dance {
    constructor() {
      this.stage = 'idle';
      this.time = 0;
      this.stageTime = 0;
      this.input = 0;      // 蓄力（0..1）
      this.force = 0;      // 平滑后的击打力度
      this.hit = 0;        // 鼓面被击中的瞬间强度
      this.beat = 0;       // 节拍脉冲
      this.work = 0;       // 有效鼓点累计
      this.overpull = 0;   // 用力过猛的累计
      this.progress = 0;   // 起舞 → 旋 的推进
      this.phase = 0;      // 舞步相位
      this.joined = false;
      this.strikes = 0;
      this.result = null;
      this.count = 0;
    }

    get active() { return this.stage !== 'idle' && this.stage !== 'complete'; }
    get playing() { return ['raise', 'step', 'spin'].includes(this.stage); }
    get busy() { return ['call', 'raise', 'step', 'spin'].includes(this.stage); }
    get label() { return STAGE_TEXT[this.stage] || ''; }

    start() {
      if (this.active) return false;
      const n = this.count + 1;
      const keep = this.result;
      Object.assign(this, new Dance());
      this.count = n;
      this.result = keep;
      this.enter('approach');
      return true;
    }

    enter(stage) {
      this.stage = stage;
      this.stageTime = 0;
      if (stage === 'close') {
        this.result = {
          joined: this.joined,
          strikes: this.strikes,
          quality: !this.joined ? 'watched'
            : this.overpull > 3 ? 'overheld'
              : this.work > 5 ? 'inTempo' : 'joined',
          version: this.count
        };
        this.joined = false;
      }
    }

    join() {
      if (!['approach', 'call', 'raise', 'step', 'spin'].includes(this.stage)) return false;
      this.joined = true;
      if (this.stage === 'call') this.enter('raise');
      return true;
    }

    release() {
      this.joined = false;
      this.input = 0;
    }

    // 蓄力：按住鼓面
    charge(value) {
      this.input = this.playing || this.stage === 'call' ? clamp(value) : 0;
    }

    // 击鼓：力度在这一刻定格
    strike(value) {
      if (!['call', 'raise', 'step', 'spin'].includes(this.stage)) return false;
      this.join();
      this.force = clamp(value == null ? this.input : value);
      this.hit = 0.35 + this.force * 0.65;
      this.beat = 1;
      this.strikes++;
      const good = clamp(1 - Math.abs(this.force - IDEAL) / TOLERANCE);
      this.work += good * 1.6;
      if (this.force > 0.85) this.overpull += 1;
      else if (this.force < 0.22) this.overpull += 0.4;   // 太轻也不成节
      return true;
    }

    step(dt, opts = {}) {
      if (dt <= 0 || this.stage === 'idle') return;
      this.time += dt;
      this.stageTime += dt;

      // 衰减
      this.hit *= Math.exp(-dt * 6.5);
      this.beat *= Math.exp(-dt * 3.2);
      this.force *= Math.exp(-dt * 1.6);

      const good = clamp(1 - Math.abs(this.force - IDEAL) / TOLERANCE);
      const driving = this.force > 0.12 && this.joined;
      if (driving) this.work += dt * good;
      // 用力过猛会拖慢舞步：船员（舞者）始终保留自己的节奏
      const stumble = this.force > 0.85 ? 1 : 0;
      const assist = driving ? good * 0.05 : 0.012;

      switch (this.stage) {
        case 'approach':
          if (this.stageTime >= 10) this.enter('call');
          break;
        case 'call':
          if (this.stageTime >= (opts.arriving ? 34 : 20)) this.enter('raise');
          break;
        case 'raise':
          this.progress = clamp(this.progress + dt * (0.09 + assist));
          this.phase += dt * (1.1 + this.force * 2.2) * (1 - stumble * 0.75);
          if (this.progress >= 1) this.enter('step');
          break;
        case 'step':
          this.progress = clamp(this.progress + dt * (assist * 1.6 - stumble * 0.02));
          this.phase += dt * (1.4 + this.force * 2.6) * (1 - stumble * 0.8);
          if (this.progress >= 1) this.enter('spin');
          break;
        case 'spin':
          this.progress = clamp(this.progress + dt * (assist * 1.2 - stumble * 0.02));
          this.phase += dt * (2.1 + this.force * 3.4) * (1 - stumble * 0.85);
          if (this.progress >= 1) this.enter('close');
          break;
        case 'close':
          if (this.stageTime > 5.5) this.enter('record');
          break;
        case 'record':
          if (this.stageTime > 6) this.enter('complete');
          break;
        default:
          break;
      }
    }

    // 给渲染层的姿态
    sample() {
      const p = this.phase;
      const e = smooth(this.progress);
      const stage = this.stage;
      const inShow = ['raise', 'step', 'spin', 'close', 'record', 'complete'].includes(stage);
      let armA = 0.35, armB = 0.25, hem = 0.18, spin = 0;

      if (stage === 'raise') {
        armA = 0.35 + 0.5 * e; armB = 0.25 + 0.45 * e; hem = 0.18 + 0.3 * e;
      } else if (stage === 'step') {
        armA = 0.75 + Math.sin(p * 0.9) * 0.22;
        armB = 0.6 + Math.cos(p * 0.9) * 0.22;
        hem = 0.5 + Math.abs(Math.sin(p * 0.45)) * 0.4;
        spin = 0.25 + 0.2 * Math.sin(p * 0.45);
      } else if (stage === 'spin') {
        armA = 0.9 + Math.sin(p * 1.2) * 0.3;
        armB = 0.85 + Math.cos(p * 1.2) * 0.3;
        hem = 0.85 + 0.3 * Math.abs(Math.sin(p * 0.6));
        spin = clamp(Math.abs(Math.sin(p * 0.55)) * 1.25);
      } else if (stage === 'close' || stage === 'record' || stage === 'complete') {
        const settle = clamp(1 - this.stageTime / 5);
        armA = 0.3 + 0.6 * settle;
        armB = 0.25 + 0.5 * settle;
        hem = 0.2 + 0.6 * settle;
        spin = settle * 0.3;
      }

      this.sampleValue = {
        stage,
        label: this.label,
        active: this.active,
        playing: this.playing,
        busy: this.busy,
        visible: stage !== 'idle',
        hit: clamp(this.hit),
        beat: clamp(this.beat),
        force: this.force,
        charge: this.joined || this.stage === 'call' ? this.input : 0,
        progress: this.progress,
        work: this.work,
        joined: this.joined,
        inShow,
        spin, armA, armB, hem,
        phase: p,
        stumble: this.force > 0.85 ? 1 : 0,
        result: this.result
      };
      return this.sampleValue;
    }
  }

  // 由指针位置推算击鼓力度：按下后越往外拖，力度越大
  function drumForce(startX, currentX, scale = 1) {
    return clamp(0.3 + (startX - currentX) / (150 * scale));
  }

  HX.dance = { Dance, STAGE_TEXT, IDEAL, drumForce };
})(typeof window !== 'undefined' ? window : globalThis);
