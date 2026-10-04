/* 逻辑层自测：原作版式、生活时间轴、六幺舞状态机、更漏氛围，全部不依赖渲染。 */
const path = require('path');
const assert = require('assert');

const src = (f) => path.join(__dirname, '..', 'src', f);
require(src('util.js'));
const HX = globalThis.HX;
require(src('palette.js'));
require(src('figure-atlas.js'));
require(src('layout.js'));
require(src('sprite.js'));
require(src('dance-event.js'));
require(src('score.js'));
require(src('scroll-life.js'));
require(src('light.js'));
require(src('annotations.js'));

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    console.error('FAIL  ' + name + '\n      ' + e.message);
    process.exitCode = 1;
  }
}

const L = HX.layout;
const atlas = HX.figureAtlas;
const quietDance = { hit: 0, beat: 0, charge: 0, spin: 0, armA: 0.3, armB: 0.2, hem: 0.2, phase: 0 };
const baseState = (time) => ({
  time, listening: 0.6, pluck: 0, ensemble: 0.6, wash: 1, depart: 1, dance: quietDance
});

console.log('原作版式');

test('版式里的每件素材都在图集里，且图集没有多余的素材', () => {
  const ids = new Set(L.ITEMS.map((i) => i.id));
  for (const id of ids) assert.ok(atlas[id], '图集缺少 ' + id);
  for (const id of Object.keys(atlas)) assert.ok(ids.has(id), '图集里有版式没用到的 ' + id);
});

test('五段按阅读顺序自右向左排开，首尾相接', () => {
  const s = L.SECTIONS;
  assert.deepStrictEqual(s.map((x) => x.name), ['听乐', '观舞', '歇息', '清吹', '送别']);
  for (let i = 1; i < s.length; i++) assert.strictEqual(s[i].x1, s[i - 1].x0, s[i].name + ' 与前一段未衔接');
  assert.strictEqual(s[0].x1, L.W);
  assert.strictEqual(s[s.length - 1].x0, 0);
});

test('每件素材都落回原画上的同一个框：脚在框下沿，高度等于框高', () => {
  for (const it of L.ITEMS) {
    const pl = L.place(it, atlas);
    assert.ok(pl && Number.isFinite(pl.s) && pl.s > 0, it.id + ' 摆放失败');
    if (it.match) continue;
    const [x0, y0, x1, y1] = it.box;
    assert.ok(Math.abs(pl.foot - y1 * L.K) < 1e-6, it.id + ' 脚线不对');
    const c = atlas[it.id].content;
    assert.ok(Math.abs((c[3] - c[1]) * pl.s - (y1 - y0) * L.K) < 0.5, it.id + ' 高度不对');
    const sec = L.SECTIONS.find((s) => s.id === it.section);
    const cx = L.wx((x0 + x1) / 2);
    assert.ok(cx >= sec.x0 - 40 && cx <= sec.x1 + 40, it.id + ' 不在 ' + sec.name + ' 段内');
  }
});

test('舞者的两个姿势同比例、共用脚线', () => {
  const a = L.place(L.ITEMS.find((i) => i.id === 'd-dancer'), atlas);
  const b = L.place(L.ITEMS.find((i) => i.id === 'd-dancer-b'), atlas);
  assert.strictEqual(a.s, b.s);
  assert.strictEqual(a.foot, b.foot);
  assert.ok(Math.abs(a.x - b.x) < 80, '两个姿势错开太远：' + (a.x - b.x).toFixed(1));
});

test('矢量轮廓命中：框心附近能点中，框外点不中', () => {
  const bank = { meta: (id) => atlas[id] };
  const it = L.ITEMS.find((i) => i.id === 'd-han-drum');
  const pl = L.place(it, atlas);
  const mid = [pl.x, (pl.box[1] + pl.box[3]) / 2];
  assert.ok(HX.sprite.contains(bank, it.id, pl, {}, mid[0], mid[1]), '击鼓的韩熙载身上点不中');
  assert.ok(!HX.sprite.contains(bank, it.id, pl, {}, pl.box[0] - 200, mid[1]), '框外居然点中了');
});

console.log('生活时间轴');

test('全部人物都在世界范围内，且没有 NaN', () => {
  const d = new HX.life.Director(atlas);
  const want = L.ITEMS.filter((i) => i.life).length;
  assert.ok(want >= 38, '会动的素材太少：' + want);
  let frames = 0;
  for (let t = 0; t < 260; t += 0.37) {
    const out = d.advance(baseState(t));
    frames++;
    assert.strictEqual(out.actors.length, want, '有人掉出了时间轴');
    for (const a of out.actors) {
      assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y), a.id + ' 坐标异常');
      assert.ok(a.x > 0 && a.x < L.W, a.id + ' 越界：' + a.x);
      for (const k of ['nod', 'lean', 'sway', 'breath', 'dx', 'bob']) {
        const v = a.pose[k];
        assert.ok(v == null || Number.isFinite(v), a.id + ' 的 ' + k + ' 异常');
      }
      assert.ok(Math.abs(a.pose.nod || 0) < 0.2, a.id + ' 点头幅度过大');
    }
  }
  assert.ok(frames > 600);
});

test('托盘侍女走到床前再回来，回程转身', () => {
  const d = new HX.life.Director(atlas);
  const seen = new Set();
  let minDx = 0, flippedWhileReturning = false;
  for (let t = 0; t < 72; t += 0.25) {
    const out = d.advance(baseState(t));
    for (const e of out.events) if (e.id === 'r-tray-maid') seen.add(e.stage);
    const a = out.actors.find((x) => x.id === 'r-tray-maid');
    minDx = Math.min(minDx, a.pose.dx);
    if (a.stage === 'return' && a.walking && a.pose.flip) flippedWhileReturning = true;
  }
  assert.ok(seen.has('go') && seen.has('serve') && seen.has('return'), '阶段缺失：' + [...seen].join('/'));
  assert.ok(minDx < -100, '位移过小：' + minDx.toFixed(1));
  assert.ok(flippedWhileReturning, '回程没有转身');
  const end = HX.life.walk(0, -150, 0, 6, 14, 20, 28, 0);
  assert.ok(Math.abs(end.x) < 1e-6, '循环起点未回到原处');
});

test('五位乐女的编号与声音层一致（mu1..mu5，都带横笛道具）', () => {
  const d = new HX.life.Director(atlas);
  const out = d.advance(baseState(3));
  const band = out.actors.filter((a) => a.prop && a.prop.kind === 'flute').map((a) => a.id).sort();
  assert.deepStrictEqual(band, ['mu1', 'mu2', 'mu3', 'mu4', 'mu5']);
});

test('鼓声推动鼓槌：落槌那一刻鼓槌向下', () => {
  const d = new HX.life.Director(atlas);
  const calm = d.advance(baseState(1)).actors.find((a) => a.id === 'd-han-drum').pose.parts.stick;
  const hitState = Object.assign(baseState(1), { dance: Object.assign({}, quietDance, { hit: 1 }) });
  const hit = d.advance(hitState).actors.find((a) => a.id === 'd-han-drum').pose.parts.stick;
  assert.ok(hit < calm - 0.25, '落槌幅度不足：' + calm.toFixed(2) + ' → ' + hit.toFixed(2));
});

console.log('乐谱与动作');

const S = HX.score;

test('乐谱每句八拍、一轮六十四拍，都落在 D 宫五声之内', () => {
  assert.strictEqual(S.LOOP, 64);
  const pent = new Set([0, 2, 4, 7, 9]);
  for (const n of S.MELODY) assert.ok(pent.has(((n.semi % 12) + 12) % 12), '出调：' + n.semi);
  const ends = S.MELODY.filter((n) => n.last).length;
  assert.strictEqual(ends, S.PHRASES.length);
});

test('排程跨轮无缝：两轮内的起音数正好是一轮的两倍，且时间递增', () => {
  for (const track of Object.keys(S.TRACKS)) {
    const one = S.between(track, 0, S.LOOP * S.BEAT).length;
    const two = S.between(track, 0, 2 * S.LOOP * S.BEAT);
    assert.strictEqual(two.length, 2 * one, track + ' 跨轮丢音或重音');
    for (let i = 1; i < two.length; i++) assert.ok(two[i].t >= two[i - 1].t, track + ' 时间倒流');
    // 分段取与整段取一致：每帧排程不会漏音
    let n = 0;
    for (let t = 0; t < 2 * S.LOOP * S.BEAT; t += 0.0173) n += S.between(track, t, Math.min(t + 0.0173, 2 * S.LOOP * S.BEAT)).length;
    assert.strictEqual(n, two.length, track + ' 分帧排程漏音');
  }
});

test('包络在起音处最高，随后衰减', () => {
  const ev = S.TRACKS.pipa.find((e) => e.kind === 'pluck' && e.b > 8);
  const t0 = ev.b * S.BEAT;
  assert.ok(S.last('pipa', t0 + 1e-6).b === ev.b);
  assert.ok(S.env('pipa', t0 + 0.01, 11) > S.env('pipa', t0 + 0.2, 11));
  assert.ok(S.env('pipa', t0 + 0.01, 11) > 0.6 * ev.vel);
});

// 以 60 帧每秒推进，量出每个姿态量每帧的最大变化
function runFrames(seconds, patch) {
  const d = new HX.life.Director(atlas);
  const dt = 1 / 60;
  const prev = new Map();
  const maxStep = {};
  const travel = new Map();
  for (let t = 0; t < seconds; t += dt) {
    const st = Object.assign(baseState(t), patch ? patch(t) : {});
    for (const a of d.advance(st).actors) {
      const flat = Object.assign({}, a.pose, a.pose.parts || {});
      const p = prev.get(a.id);
      if (p && t > 0.5) {
        for (const k of ['lean', 'sway', 'nod', 'look', 'lift', 'breath', 'hand', 'hands', 'stick', 'fan']) {
          if (!Number.isFinite(flat[k]) || !Number.isFinite(p[k])) continue;
          const step = Math.abs(flat[k] - p[k]);
          const key = k;
          maxStep[key] = Math.max(maxStep[key] || 0, step);
          travel.set(a.id, (travel.get(a.id) || 0) + step);
        }
      }
      prev.set(a.id, flat);
    }
  }
  return { maxStep, travel };
}

test('人物动作连贯：60 帧下每帧姿态变化都很小，没有跳变', () => {
  const { maxStep } = runFrames(40, (t) => ({
    mix: { listen: 1, dance: 1, rest: 1, flute: 1, farewell: 1 },
    danceAuto: true,
    dance: Object.assign({}, quietDance, { beat: 0.5 + 0.5 * Math.sin(t * 6) })
  }));
  // lean 是斜率，sway / look / lift 是图集像素，其余是弧度或 0..1 的量
  const LIMIT = { lean: 0.006, sway: 0.12, nod: 0.008, look: 0.6, lift: 0.4, breath: 0.03, hand: 0.05, hands: 0.03, stick: 0.07, fan: 0.03 };
  for (const k of Object.keys(maxStep)) {
    assert.ok(maxStep[k] <= LIMIT[k], k + ' 单帧跳了 ' + maxStep[k].toFixed(4) + '（上限 ' + LIMIT[k] + '）');
  }
});

test('主要人物始终在动：每人十秒里都有可见的动作', () => {
  const { travel } = runFrames(12);
  for (const id of ['l-han', 'l-limei', 'l-langcan', 'd-han-drum', 'd-monk', 'r-han', 'f-han-fan', 'b-han']) {
    const a = [...travel.keys()].find((k) => k === id || k.startsWith(id));
    assert.ok(a, '找不到 ' + id);
    assert.ok(travel.get(a) > 0.08, id + ' 几乎没动：' + travel.get(a).toFixed(3));
  }
});

test('琵琶女落指跟着乐谱：起音之后手部明显拨下', () => {
  const ev = S.TRACKS.pipa.find((e) => e.kind === 'pluck' && e.b >= 16 && S.TRACKS.pipa.every((o) => o === e || o.b <= e.b - 0.9 || o.b > e.b));
  const t0 = (ev.b + S.LOOP) * S.BEAT;
  const d = new HX.life.Director(atlas);
  let before = null, after = null;
  for (let t = t0 - 3; t < t0 + 0.12; t += 1 / 60) {
    const a = d.advance(Object.assign(baseState(t), { mix: { listen: 1 } })).actors.find((x) => x.sprite === 'l-limei');
    if (t < t0 - 0.02) before = a.pose.parts.hand;
    else after = a.pose.parts.hand;
  }
  assert.ok(after - before > 0.03, '手没有随起音拨动：' + before.toFixed(3) + ' → ' + after.toFixed(3));
});

console.log('原作批注');

test('批注都在原图范围内，按自右向左编号，链接都是 https', () => {
  const A = HX.annotations;
  assert.ok(A.NOTES.length >= 24);
  const ids = new Set();
  A.NOTES.forEach((n, i) => {
    assert.ok(!ids.has(n.id), '重复的批注 ' + n.id);
    ids.add(n.id);
    assert.strictEqual(n.index, i);
    const [x0, y0, x1, y1] = n.box;
    assert.ok(x0 >= 0 && x1 <= A.W && y0 >= 0 && y1 <= A.H && x1 > x0 && y1 > y0, n.id + ' 框越界');
    assert.ok(n.pin[0] >= 0 && n.pin[0] <= A.W && n.pin[1] >= 0 && n.pin[1] <= A.H, n.id + ' 印签越界');
    if (i) assert.ok(n.box[2] <= A.NOTES[i - 1].box[2], n.id + ' 顺序不对');
    assert.ok(n.title && n.pi && n.text.length, n.id + ' 缺文字');
    assert.ok(n.links.length && n.links.every((l) => /^https:\/\//.test(l.href)), n.id + ' 链接不对');
    // 能"入画"的批注必须落在画心之内
    if (n.enter) assert.ok(x0 >= 4240 && x1 <= 10040, n.id + ' 不在画心却可入画');
  });
  for (const id of ['l-han', 'l-limei', 'd-han-drum', 'd-dancer', 'r-han', 'f-han-fan', 'band', 'b-han', 'seals', 'pang']) {
    assert.ok(ids.has(id), '缺少批注 ' + id);
  }
});

console.log('六幺舞状态机');

test('无人介入也能走完全程', () => {
  const d = new HX.dance.Dance();
  d.start();
  const seen = [];
  for (let t = 0; t < 200; t += 0.1) {
    if (d.stage !== seen[seen.length - 1]) seen.push(d.stage);
    d.step(0.1, {});
    if (d.stage === 'complete') break;
  }
  assert.ok(seen.includes('call') && seen.includes('raise'), '阶段缺失：' + seen.join('→'));
  assert.strictEqual(d.stage, 'complete');
  assert.strictEqual(d.result.quality, 'watched');
});

test('鼓点合度推进更快，用力过猛反而拖慢', () => {
  const run = (force) => {
    const d = new HX.dance.Dance();
    d.start();
    let t = 0;
    while (d.stage !== 'spin' && t < 300) {
      d.step(0.1, {});
      t += 0.1;
      if (d.playing && d.stageTime > 0.35) d.strike(force);
    }
    return { t, overpull: d.overpull, work: d.work };
  };
  const good = run(HX.dance.IDEAL);
  const hard = run(0.98);
  assert.ok(good.work > hard.work, '合度应当积累更多有效鼓点');
  assert.ok(hard.overpull > good.overpull, '过猛应当被记为过度用力');
});

test('阶段文案会随状态变化', () => {
  const d = new HX.dance.Dance();
  assert.strictEqual(d.sample().label, '六幺舞');
  d.start();
  assert.ok(d.sample().label.includes('击鼓'));
});

console.log('更漏与烛火');

test('更漏按阶段推进', () => {
  const labels = [[0, '掌灯'], [12, '烛明'], [40, '烛影摇红'], [80, '香尽'], [110, '更残漏尽'], [140, '天将明']];
  for (const [t, want] of labels) {
    assert.strictEqual(HX.light.ambience(t).label, want, t + 's 应为 ' + want);
  }
  assert.strictEqual(HX.light.ambience(200).dawn > 0.9, true);
});

test('烛明之后转暗，香起之后转静', () => {
  const a = HX.light.ambience(12);
  const b = HX.light.ambience(140);
  assert.ok(a.flame > b.flame, '夜深烛火应更弱');
  assert.ok(HX.light.ambience(60).smoke > HX.light.ambience(0).smoke, '香烟应随夜升高');
  assert.ok(HX.light.ambience(60).still > HX.light.ambience(0).still, '夜深应更静');
});

test('每支烛的熄灭时刻彼此错开', () => {
  let differs = false;
  for (let t = 96; t <= 140; t += 1) {
    const amb = HX.light.ambience(t);
    const a = HX.light.candleLevel({ seedId: 1 }, t, amb);
    const b = HX.light.candleLevel({ seedId: 9 }, t, amb);
    if (Math.abs(a - b) > 0.02) { differs = true; break; }
  }
  assert.ok(differs, '两支烛不应同时熄灭');
});

console.log('\n' + passed + ' 项通过' + (process.exitCode ? '，有失败' : ''));
