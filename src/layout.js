/* 原作版式：每个人物、每组陈设在原画上的位置。

   坐标取自 img/ 下的全卷（12172 × 500）：box 是这件东西在原画上所占的框
   [x0, y0, x1, y1]（原画像素）。世界坐标按 world = (orig − ORIGIN) × K 换算，
   于是"把素材放回原画的同一个框"就是摆放的全部规则：
     高 = (y1 − y0) × K，脚落在 y1 × K，横向居中于框。
   原作自右向左展开（听乐在右端、送别在左端），世界坐标保持原画方向，
   镜头从右端开卷、向左行进。

   z 默认取框的下沿（越靠下越在前）；屏风、床榻这类人物坐在其上或立在其前的陈设
   单独给小 z。match 表示与另一张素材同比例、按脸对齐（舞者两个姿势之间交叉淡入）。 */
(function (root) {
  'use strict';
  const HX = (root.HX = root.HX || {});

  const ORIGIN = 4080;      // 原画 x：卷尾（送别）左侧留白起点
  const END = 10120;        // 原画 x：卷首（听乐）右侧留白终点
  const K = 1.8;
  const W = Math.round((END - ORIGIN) * K);
  const H = 900;

  const wx = (ox) => (ox - ORIGIN) * K;
  const wy = (oy) => oy * K;

  // 阅读顺序：其一在右，其五在左
  const SECTIONS = [
    { id: 'listen', o: [8730, END], name: '听乐', index: '其一', note: '李家小妹抱琵琶，满堂屏息。' },
    { id: 'dance', o: [7760, 8730], name: '观舞', index: '其二', note: '王屋山踏六幺，主人亲擂羯鼓。' },
    { id: 'rest', o: [6890, 7760], name: '歇息', index: '其三', note: '宴罢暂歇，主人洗手，侍女环坐。' },
    { id: 'flute', o: [5300, 6890], name: '清吹', index: '其四', note: '五女横笛，主人袒衣执扇。' },
    { id: 'farewell', o: [ORIGIN, 5300], name: '送别', index: '其五', note: '曲终人散，主人执槌作别。' }
  ].map((s) => Object.assign(s, { x0: wx(s.o[0]), x1: wx(s.o[1]) }));

  /* life：人物在时间轴上的行为（见 scroll-life.js）；role：可被点击的交互身份。 */
  const ITEMS = [
    /* 其五 · 送别 */
    { id: 'b-couple', box: [4345, 135, 4555, 442], life: 'murmur', section: 'farewell' },
    { id: 'b-han', box: [4612, 28, 4738, 422], life: 'bye', section: 'farewell' },
    { id: 'b-chair-group', box: [4798, 88, 5112, 452], life: 'murmur', section: 'farewell' },

    /* 其四 · 清吹 */
    { id: 'f-screen-pine', box: [5300, 0, 5612, 455], z: 0, section: 'flute' },
    { id: 'f-woman-shawl', box: [5193, 112, 5312, 428], life: 'idle', section: 'farewell' },
    { id: 'f-guest-stand', box: [5318, 92, 5442, 432], life: 'idle', section: 'flute' },
    { id: 'f-clapper', box: [5492, 100, 5662, 448], life: 'paiban', section: 'flute' },
    { id: 'f-bili', actor: 'mu1', box: [5668, 55, 5842, 322], life: 'flute', section: 'flute' },
    { id: 'f-flute-1', actor: 'mu2', box: [5800, 82, 5935, 345], life: 'flute', section: 'flute' },
    { id: 'f-flute-2', actor: 'mu3', box: [5885, 82, 5998, 352], life: 'flute', section: 'flute' },
    { id: 'f-flute-4', actor: 'mu4', box: [5983, 72, 6088, 346], life: 'flute', section: 'flute' },
    { id: 'f-flute-3', actor: 'mu5', box: [6040, 98, 6152, 372], life: 'flute', section: 'flute' },
    { id: 'f-lady', box: [6262, 138, 6366, 468], life: 'idle', section: 'flute' },
    { id: 'f-han-fan', box: [6352, 48, 6612, 432], life: 'fan', section: 'flute' },
    { id: 'f-maid-back', box: [6600, 108, 6682, 412], life: 'idle', section: 'flute' },
    { id: 'f-maid-fan', box: [6500, 222, 6626, 482], life: 'idle', section: 'flute' },

    /* 其三 · 歇息 */
    { id: 'r-bed', box: [7292, 0, 7612, 418], z: 0, section: 'rest' },
    { id: 'r-couch', box: [6878, 38, 7405, 472], z: 1, section: 'rest' },
    { id: 'r-han', box: [6978, 135, 7098, 322], life: 'wash', section: 'rest' },
    { id: 'r-women', box: [7034, 64, 7266, 292], life: 'murmur', section: 'rest' },
    { id: 'r-maid-front', box: [7068, 196, 7162, 468], life: 'idle', section: 'rest' },
    { id: 'r-pipa-girl', box: [7505, 88, 7632, 418], life: 'idle', section: 'rest' },
    { id: 'r-tray-maid', box: [7608, 192, 7732, 442], life: 'tray', section: 'rest' },

    /* 其二 · 观舞 */
    { id: 'd-clap-woman', box: [7815, 110, 7902, 372], life: 'clap', section: 'dance' },
    { id: 'd-dancer', box: [7978, 182, 8088, 418], life: 'dancer', role: 'dancer', section: 'dance' },
    { id: 'd-dancer-b', match: 'd-dancer', z: 418.5, section: 'dance', hidden: true },
    { id: 'd-clapper', box: [8090, 62, 8206, 382], life: 'clap', section: 'dance' },
    { id: 'd-monk', box: [8153, 18, 8252, 328], life: 'monk', section: 'dance' },
    { id: 'd-youth', box: [8298, 28, 8408, 352], life: 'clap', section: 'dance' },
    { id: 'd-han-drum', box: [8393, 18, 8540, 412], life: 'drummer', section: 'dance' },
    { id: 'd-drum', box: [8355, 170, 8482, 434], role: 'drum', section: 'dance' },
    { id: 'd-langcan', box: [8178, 172, 8402, 462], life: 'watch', section: 'dance' },
    { id: 'd-man-stand', box: [8558, 98, 8668, 448], life: 'watch', section: 'dance' },

    /* 其一 · 听乐 */
    { id: 'l-limei', box: [8762, 172, 8918, 448], life: 'pipa', role: 'pipa', section: 'listen' },
    { id: 'l-guest-brown', box: [8922, 138, 9062, 408], life: 'listen', section: 'listen' },
    { id: 'l-man-1', box: [8995, 15, 9085, 300], life: 'listen', section: 'listen' },
    { id: 'l-man-2', box: [9128, 10, 9205, 302], life: 'listen', section: 'listen' },
    { id: 'l-man-3', box: [9212, 12, 9330, 305], life: 'listen', section: 'listen' },
    { id: 'l-pink', box: [9082, 58, 9165, 335], life: 'idle', section: 'listen' },
    { id: 'l-girl', box: [9040, 135, 9112, 295], z: 340, life: 'idle', section: 'listen' },
    { id: 'l-tables', box: [8995, 172, 9518, 447], z: 446, section: 'listen' },
    { id: 'l-guest-chair', box: [9195, 188, 9368, 478], life: 'listen', section: 'listen' },
    { id: 'l-bed', box: [9735, 0, 10040, 462], z: -1, section: 'listen' },
    { id: 'l-couch', box: [9318, 12, 9835, 455], z: 0, section: 'listen' },
    { id: 'l-langcan', box: [9398, 28, 9602, 198], life: 'listen', section: 'listen' },
    { id: 'l-han', box: [9466, 92, 9618, 445], life: 'host', section: 'listen' },
    { id: 'l-lady', box: [9575, 182, 9688, 478], life: 'idle', section: 'listen' }
  ];

  /* 代码画的陈设：原作里是素面的屏风立柱、大屏风、烛台与鼓架，没有可生成的细节。 */
  const FIXTURES = {
    posts: [
      { o: [8690, 8722], top: 0, foot: [8648, 8748, 352, 446], color: '#8a9b80' }
    ],
    screens: [
      { o: [6680, 6892], top: 0, bottom: 470, feet: [[6650, 6742], [6800, 6896]] }
    ],
    candles: [
      { id: 'candle-rest', o: 7415, top: 146, base: 470, seedId: 3, section: 'rest' }
    ],
    drumStands: [
      { o: [9640, 9745], top: 255, bottom: 460 }
    ]
  };

  // 素材在世界中的摆放：缩放、脚点、横向中心
  function place(item, atlas) {
    const meta = atlas[item.id];
    if (!meta) return null;
    if (item.match) {
      const ref = ITEMS.find((i) => i.id === item.match);
      const rp = place(ref, atlas);
      const rm = atlas[ref.id];
      const s = rp.s;
      // 两个姿势的脸对齐：横向按脸中心，纵向共用脚线
      const fx = (m) => (m.face ? (m.face[0] + m.face[2]) / 2 : (m.content[0] + m.content[2]) / 2);
      const x = rp.x + (fx(meta) - (meta.content[0] + meta.content[2]) / 2 -
        (fx(rm) - (rm.content[0] + rm.content[2]) / 2)) * -s;
      return { s, x, foot: rp.foot, z: item.z != null ? item.z : rp.z, box: rp.box };
    }
    const [x0, y0, x1, y1] = item.box;
    const c = meta.content;
    const s = ((y1 - y0) * K) / (c[3] - c[1]);
    return {
      s,
      x: wx((x0 + x1) / 2),
      foot: wy(y1),
      z: item.z != null ? item.z : y1,
      box: [wx(x0), wy(y0), wx(x1), wy(y1)]
    };
  }

  HX.layout = { ORIGIN, END, K, W, H, wx, wy, SECTIONS, ITEMS, FIXTURES, place };
})(typeof window !== 'undefined' ? window : globalThis);
