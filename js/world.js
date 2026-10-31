/* ============================================================
 * 御风启程 · 世界 (js/world.js)
 * ------------------------------------------------------------
 * 新游戏的美术：坐骑（飞鼠 / 猫头鹰 / 翼龙 / 双龙 / 纸飞机）+ 乘客小鸡、出发台场景、
 * 天空飞行分层卷轴、滑翔道具（气流 / 乌云 / 光圈）、结算明信片卡。
 * 纯函数 → SVG 字符串，Node 可断言。坐骑按 kind 表分发（新增坐骑 = 加一个 key）。
 * ============================================================ */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else { root.TF = root.TF || {}; root.TF.World = mod; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var INK = '#3c352d';

  /* ---------- 小工具（沿用现有手绘语言：墨线 + 平涂 + 少量排线） ---------- */
  function r2(x) { return Math.round(x * 100) / 100; }
  function p(d, fill, opt) {
    opt = opt || {};
    var s = '<path d="' + d + '"';
    if (fill && fill !== 'none') s += ' fill="' + fill + '"';
    else s += ' fill="none"';
    s += ' stroke="' + (opt.ink || INK) + '" stroke-width="' + (opt.w || 2) + '" stroke-linecap="round" stroke-linejoin="round"';
    if (opt.op !== undefined) s += ' opacity="' + r2(opt.op) + '"';
    s += '/>';
    return s;
  }
  function ell(cx, cy, rx, ry, fill, opt) {
    opt = opt || {};
    var s = '<ellipse cx="' + r2(cx) + '" cy="' + r2(cy) + '" rx="' + r2(rx) + '" ry="' + r2(ry) + '"';
    s += opt.ink === false ? '' : ' stroke="' + (opt.ink || INK) + '" stroke-width="' + (opt.w || 1.8) + '"';
    s += ' fill="' + fill + '"';
    if (opt.op !== undefined) s += ' opacity="' + r2(opt.op) + '"';
    s += '/>';
    return s;
  }
  function hashStr(s) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function rngFor(seedStr) {
    var a = hashStr(seedStr);
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- 天空调色（吉卜力晴空绘本：通透饱和蓝天 / 靛蓝星空） ---------- */
  var PAL = {
    day:   { sky: ['#67b9e8', '#8fd0ef', '#b6e3f5', '#c8ecf7'], sun: '#fff3b0', sunCore: '#fffbe6', star: 0, hill: '#9fb8d8', hill2: '#86a5ca', cloud: '#ffffff', cloudShade: '#dcecf6' },
    night: { sky: ['#1b2a4d', '#2b3f6b', '#3a5384', '#4a6a9c'], sun: '#f5e6b8', sunCore: '#fdf6d8', star: 26, hill: '#5b6f9c', hill2: '#4a5d88', cloud: '#465a86', cloudShade: '#394b72' }
  };
  function palFor(mountId) {
    var DATA = typeof module === 'object' && module.exports ? require('./data.js')
      : ((typeof window !== 'undefined' && window.TF) ? window.TF.DATA : null);
    var m = DATA && DATA.MOUNT_BY_ID ? DATA.MOUNT_BY_ID[mountId] : null;
    return (m && m.dayNight === 'night') ? PAL.night : PAL.day;
  }

  /* ---------- 乘客：小鸡（品牌锚点，所有坐骑上完全一致） ----------
   * 绒球身 + 豆眼 + 三角嘴 + 呆毛。契约：组原点 = 脚底接触点（y≈2）。 */
  var CHICK = { body: '#f6d76b', bodyN: '#e8c96b', wing: '#f0c14a', beak: '#f09a4a', blush: '#f2a7a0' };
  function riderChick(night) {
    var body = night ? CHICK.bodyN : CHICK.body, wing = CHICK.wing;
    var o = [];
    o.push(p('M-1 -16 q -1 -3 -3 -4 M0 -16 q 1 -3 3 -4', 'none', { w: 1.2 }));       // 呆毛
    o.push(ell(0, -7, 7.2, 8.2, body, { w: 1.8 }));                                   // 绒球身（头身一体）
    o.push(p('M2 -8 q 5 -2 6 2 q -2 3 -6 1 Z', wing, { w: 1.4 }));                    // 小翅膀
    o.push('<circle cx="-3" cy="-9" r="1.6" fill="#2f2a24"/><circle cx="-3.6" cy="-9.6" r=".5" fill="#fff"/>');  // 豆眼
    o.push(p('M-7.5 -7 L-12 -5.5 L-7.5 -3.4 Z', CHICK.beak, { w: 1.2 }));              // 嘴
    o.push('<circle cx="-0.5" cy="-5.2" r="1.5" fill="' + CHICK.blush + '" opacity=".7"/>');   // 腮红
    o.push(p('M-2 0 q -1 2.4 -2 2.6 M2 0 q 1 2.4 2 2.6', 'none', { w: 1.2 }));         // 脚
    return '<g class="rider">' + o.join('') + '</g>';
  }

  /* ============================================================
   * 坐骑设计系统（frontend-design 两步法落地）
   * ------------------------------------------------------------
   * 形状规则：头（左，占全长 1/3）+ 身（载客主体）+ 运动签名（翼/尾）。
   *          远侧部件先画、压深；线重 2 外 / 1.2–1.4 内；单豆眼一高光。
   * 色彩角色：主色 / 副色（远侧压深）/ 腹色 / 点睛色（每只恰好一个）。
   * 夜行坐骑：同色相往冷暗移一档，不是换一套色。
   * 记忆点（每只一个，其余克制）：飞鼠=大扁尾 · 猫头鹰=琥珀眼+耳羽 ·
   *   翼龙=长喙+头冠 · 东方龙=S 身+红鬃须 · 西方龙=双角+尾锏 · 纸飞机=折痕线。
   * ============================================================ */
  var MT = {
    ink: '#3c352d',
    squirrel: { body: '#c98a55', bodyN: '#a3795a', dark: '#a96e3f', darkN: '#8a6448', belly: '#f4e3c4', mem: '#e0b27e', memN: '#b08d68' },
    owl:      { body: '#7d8ca8', bodyN: '#64718c', dark: '#64718c', darkN: '#4f5a74', belly: '#c9d2e2', wing: '#5d6b86', eye: '#f5c04a' },
    ptero:    { body: '#c8a06a', bodyN: '#9a8a68', dark: '#a8824e', darkN: '#7d6f52', belly: '#ead9b8', mem: '#d9b384', memN: '#8a775a', crest: '#c1684a' },
    east:     { body: '#6fb26a', bodyN: '#5f9a58', belly: '#e8c98a', bellyN: '#d9b86a', mane: '#e86a4a' },
    west:     { body: '#7a6d9a', bodyN: '#6b5f86', dark: '#574c73', belly: '#c9c0dd', wing: '#6a5f8a', wingN: '#554a6e', eye: '#f5c04a' },
    paper:    { body: '#fbf8ee', bodyN: '#d8d5e6', shade: '#e8e2d0', shadeN: '#b8b4cc', win: '#cfe0ec' }
  };
  function mountPal(key, night) {
    var p = MT[key], out = {};
    Object.keys(p).forEach(function (k) {
      var base = k.replace(/N$/, '');
      out[base] = night && p[base + 'N'] ? p[base + 'N'] : p[base];
    });
    return out;
  }
  /* 豆眼（黑）——所有白昼坐骑统一 */
  function dotEye(cx, cy, r) {
    return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#2f2a24"/>' +
      '<circle cx="' + r2(cx - r * .35) + '" cy="' + r2(cy - r * .4) + '" r="' + r2(Math.max(.5, r * .3)) + '" fill="#fff"/>';
  }

  var MOUNT_ART = {
    /* 飞鼠（白天）——记忆点：大扁尾 */
    squirrel: function (night) {
      var c = mountPal('squirrel', night);
      var o = [];
      o.push(p('M-12 -2 Q-42 -30 -58 -16 Q-68 -4 -48 8 Q-28 18 -12 6 Z', c.dark, { w: 2 }));   // 尾
      o.push(p('M-32 -14 Q-48 -12 -58 -6', 'none', { w: 1.4, op: .5 }));
      o.push(p('M-24 -30 Q-44 -28 -56 -18', 'none', { w: 1.2, op: .35 }));
      o.push(p('M-26 -14 Q-12 -34 8 -10 Q-8 -2 -22 -6 Z', c.dark, { w: 1.8 }));               // 远膜
      o.push(p('M-42 -8 Q-32 -22 0 -15 Q18 -10 16 2 Q14 13 -12 13 Q-38 13 -42 -8 Z', c.body, { w: 2.2 }));  // 身
      o.push(ell(-13, 1, 13, 7, c.belly, { ink: false, op: .95 }));                             // 腹
      o.push(p('M-34 -20 Q-16 -36 6 -8 Q-8 4 -28 -8 Z', c.mem, { w: 2.2 }));                    // 近膜
      o.push(p('M-24 -28 Q-10 -18 2 -6', 'none', { w: 1.4, op: .6 }));                          // 膜指线
      o.push(p('M-30 -6 Q-38 -12 -44 -18 q -2 4 2 7 q 10 -1 14 -3 Z', c.body, { w: 1.8 }));     // 前臂
      o.push(ell(-47, -13, 2.6, 2, c.body, { w: 1.2 }));
      o.push(p('M-4 4 Q6 -2 12 -6 q 3 4 -1 8 q -10 2 -12 -2 Z', c.body, { w: 1.8 }));           // 后腿
      o.push(ell(15, -2, 4.5, 2.8, c.body, { w: 1.4 }));
      o.push(p('M-48 -24 Q-40 -40 -26 -36 Q-16 -34 -18 -20 Q-19 -8 -32 -8 Q-44 -8 -48 -24 Z', c.body, { w: 2.2 }));  // 头
      o.push(ell(-44, -30, 4.5, 4.5, c.body, { w: 1.6 }));                                       // 圆耳×2
      o.push(ell(-30, -31, 4.5, 4.5, c.body, { w: 1.6 }));
      o.push(ell(-37, -22, 4.6, 4.8, '#fffdf9', { w: 1.2 }));                                   // 眼白
      o.push(dotEye(-37, -22, 3.2));
      o.push('<circle cx="-22" cy="-16" r="1.5" fill="' + MT.ink + '"/>');                       // 鼻
      o.push(p('M-24 -12 q 3 2.6 6 1', 'none', { w: 1.2 }));                                    // 嘴
      o.push('<g transform="translate(-8,-24)">' + riderChick(night) + '</g>');                  // 乘客
      return '<g class="mount mount-squirrel">' + o.join('') + '</g>';
    },
    /* 猫头鹰（夜行）——记忆点：琥珀大眼 + 耳羽 */
    owl: function (night) {
      var c = mountPal('owl', night);
      var o = [];
      o.push(p('M-16 -12 Q-2 -46 26 -38 Q36 -34 30 -18 Q20 -4 -8 -8 Z', c.dark, { w: 2 }));     // 远翼
      o.push(p('M-4 -36 Q8 -24 22 -16', 'none', { w: 1.3, op: .5 }));
      o.push(p('M-36 -14 Q-22 -28 6 -20 Q20 -16 18 -2 Q17 11 -10 12 Q-30 12 -36 -14 Z', c.body, { w: 2.2 }));  // 身
      o.push(ell(-10, 2, 14, 7, c.belly, { ink: false, op: .95 }));                             // 腹
      o.push(p('M-20 4 q 7 4 16 0 M-16 8 q 7 3 14 0', 'none', { w: 1.2, op: .5 }));             // 腹羽线
      o.push(p('M-20 -12 Q-4 -48 30 -40 Q38 -36 32 -16 Q22 0 -6 -6 Z', c.wing, { w: 2.2 }));    // 近翼
      o.push(p('M-14 -30 Q2 -20 24 -16 M-10 -20 Q6 -10 28 -8', 'none', { w: 1.3, op: .55 }));   // 翼羽线
      o.push(p('M14 2 Q26 0 28 8 Q18 14 10 10 Z', c.dark, { w: 1.6 }));                         // 尾羽
      o.push(p('M2 8 q 4 3 6 0 M10 9 q 3 3 5 0', 'none', { w: 1.5 }));                          // 爪
      o.push(p('M-38 -22 Q-32 -44 -12 -42 Q0 -41 2 -24 Q3 -12 -10 -12 Q-30 -12 -38 -22 Z', c.body, { w: 2.2 }));  // 头
      o.push(p('M-32 -38 l -6 -7 q 4 -2 6 2 Z', c.body, { w: 1.6 }));                           // 耳羽×2
      o.push(p('M-16 -40 l 5 -7 q -4 -2 -6 2 Z', c.body, { w: 1.6 }));
      o.push(ell(-25, -28, 6, 6.2, c.eye, { w: 1.6 }));                                         // 琥珀眼×2
      o.push(ell(-11, -29, 5.4, 5.6, c.eye, { w: 1.6 }));
      o.push('<ellipse cx="-25" cy="-27" rx="2.6" ry="3" fill="#2f2a24"/><circle cx="-26.5" cy="-29" r="1" fill="#fff"/>');
      o.push('<ellipse cx="-11" cy="-28" rx="2.3" ry="2.7" fill="#2f2a24"/><circle cx="-12.5" cy="-30" r=".9" fill="#fff"/>');
      o.push(p('M-20 -22 L-16 -17 L-22 -18 Z', '#c9a23a', { w: 1.2 }));                         // 喙
      o.push('<g transform="translate(-4,-28)">' + riderChick(night) + '</g>');                  // 乘客
      return '<g class="mount mount-owl">' + o.join('') + '</g>';
    },
    /* 翼龙（白天）——记忆点：长喙 + 头冠 */
    ptero: function (night) {
      var c = mountPal('ptero', night);
      var o = [];
      o.push(p('M10 4 Q34 8 52 -4 Q56 -5 54 -8 Q36 -4 14 -2 Z', c.dark, { w: 1.6 }));           // 尾
      o.push(p('M-14 -8 Q4 -44 34 -36 Q44 -34 38 -16 Q26 -2 -6 -6 Z', c.dark, { w: 2 }));       // 远翼
      o.push(p('M-2 -36 Q10 -24 26 -14', 'none', { w: 1.2, op: .5 }));
      o.push(p('M-30 -10 Q-20 -24 2 -18 Q16 -14 14 0 Q13 10 -10 10 Q-28 10 -30 -10 Z', c.body, { w: 2 }));  // 身
      o.push(ell(-8, 0, 12, 6, c.belly, { ink: false, op: .9 }));                               // 腹
      o.push(p('M-16 -6 Q2 -46 40 -38 Q48 -36 42 -14 Q30 2 -8 -4 Z', c.mem, { w: 2 }));         // 近翼
      o.push(p('M-8 -34 Q8 -20 30 -10 M-4 -22 Q12 -8 34 -2 M2 -10 Q14 0 36 2', 'none', { w: 1.3, op: .5 }));  // 三根翼指骨
      o.push(p('M6 6 q 8 2 10 6 q -4 2 -8 0 Z', c.body, { w: 1.6 }));                           // 后腿
      o.push(p('M-26 -12 Q-36 -18 -42 -14 Q-48 -10 -44 -4 Q-40 0 -30 -2 Z', c.body, { w: 1.8 }));  // 颈+头
      o.push(p('M-44 -12 Q-54 -16 -60 -11 L-57 -5 Q-48 -8 -44 -8 Z', c.body, { w: 1.6 }));       // 长喙
      o.push(p('M-40 -16 Q-42 -26 -34 -28 Q-32 -18 -37 -12 Z', c.crest, { w: 1.4 }));           // 头冠
      o.push(dotEye(-41, -13, 1.8));
      o.push('<g transform="translate(-12,-22)">' + riderChick(night) + '</g>');                  // 乘客
      return '<g class="mount mount-ptero">' + o.join('') + '</g>';
    },
    /* 东方龙（白天）——记忆点：S 身 + 红鬃须 */
    east: function (night) {
      var c = mountPal('east', night);
      var spine = 'M-44 -8 C -28 -20 -12 -6 -2 -14 C 8 -22 22 -16 32 -4';
      var o = [];
      o.push('<path d="' + spine + '" fill="none" stroke="' + MT.ink + '" stroke-width="15" stroke-linecap="round"/>');
      o.push('<path d="' + spine + '" fill="none" stroke="' + c.body + '" stroke-width="11" stroke-linecap="round"/>');
      o.push('<path d="M-42 -3 C -26 -14 -10 -2 0 -10 C 10 -18 24 -11 33 -1" fill="none" stroke="' + c.belly + '" stroke-width="3" stroke-linecap="round" opacity=".9"/>');  // 腹金线
      o.push('<path d="M-30 -12 q 8 6 14 2 M-14 -15 q 7 5 12 1" stroke="' + c.body + '" stroke-width="1.2" fill="none" opacity=".7"/>');  // 鳞线
      [[-32, -12], [-20, -15], [-10, -16], [0, -18], [10, -16], [20, -12]].forEach(function (s) {
        o.push('<path d="M' + s[0] + ' ' + s[1] + ' l 2 -5" stroke="' + c.mane + '" stroke-width="1.6" stroke-linecap="round" opacity=".85"/>');  // 背鬃
      });
      o.push(p('M-52 -14 Q-60 -24 -46 -26 Q-40 -20 -44 -12 Z', c.body, { w: 1.8 }));            // 头
      o.push(p('M-60 -16 Q-64 -17 -66 -14 L-62 -9 Z', c.body, { w: 1.4 }));                     // 吻
      o.push(p('M-50 -22 q -8 -6 -4 -12 q -6 2 -8 8 q 2 6 8 8', c.body, { w: 1.4 }));           // 分叉鹿角
      o.push(p('M-58 -13 Q-66 -11 -72 -7 M-58 -10 Q-66 -9 -70 -13', 'none', { w: 1.4 }));       // 长须
      o.push(dotEye(-49, -17, 1.7));
      o.push(p('M-14 1 q -2 5 -6 6 M-2 3 q -2 5 -6 6 M12 1 q -2 5 -6 6', 'none', { w: 1.6 }));  // 爪
      o.push(p('M33 -4 Q 46 0 54 -7 q 4 8 0 11 q -8 -2 -12 -7', c.body, { w: 1.6 }));           // 尾鳍
      o.push('<g transform="translate(4,-20)">' + riderChick(night) + '</g>');                  // 乘客
      return '<g class="mount mount-east">' + o.join('') + '</g>';
    },
    /* 西方龙（夜行）——记忆点：双角 + 尾锏 */
    west: function (night) {
      var c = mountPal('west', night);
      var o = [];
      o.push(p('M16 4 Q40 10 54 0 Q58 -2 56 -6 Q40 -2 20 -4 Z', c.dark, { w: 1.8 }));           // 尾
      o.push(p('M54 -2 L60 -4 L58 -8 L52 -5 Z', c.dark, { w: 1.4 }));                           // 尾锏
      o.push(p('M-10 -10 Q6 -48 40 -40 Q48 -38 42 -16 Q32 0 -2 -8 Z', c.dark, { w: 2 }));       // 远翼
      o.push(p('M0 -38 Q12 -22 28 -12', 'none', { w: 1.3, op: .5 }));
      o.push(p('M-34 -10 Q-24 -26 2 -20 Q18 -16 20 -2 Q21 12 -8 13 Q-30 13 -34 -10 Z', c.body, { w: 2.2 }));  // 身
      o.push(ell(-8, 2, 13, 7, c.belly, { ink: false, op: .92 }));                              // 腹
      o.push(p('M-20 6 q 8 4 18 0', 'none', { w: 1.2, op: .5 }));
      o.push(p('M-14 -8 Q4 -50 44 -42 Q52 -40 46 -16 Q36 2 -4 -6 Z', c.wing, { w: 2.2 }));      // 近翼
      o.push(p('M-6 -36 Q10 -20 32 -10 M-2 -24 Q14 -8 38 -2', 'none', { w: 1.3, op: .55 }));
      o.push(p('M42 -40 L47 -44 L45 -47 L39 -43 Z', c.dark, { w: 1.3 }));                       // 翼爪
      o.push(p('M8 8 q 8 2 10 7 q -4 2 -8 0 Z', c.body, { w: 1.6 }));                           // 后腿
      o.push(p('M-38 -18 Q-32 -36 -14 -32 Q-4 -30 -2 -18 Q-1 -8 -18 -8 Q-32 -8 -38 -18 Z', c.body, { w: 2 }));  // 头
      o.push(p('M-32 -30 q -2 -8 3 -10 q 3 5 0 9 Z', c.dark, { w: 1.4 }));                      // 双角
      o.push(p('M-18 -31 q 2 -8 7 -8 q 0 6 -5 9 Z', c.dark, { w: 1.4 }));
      o.push(ell(-26, -20, 3.6, 4, c.eye, { w: 1.4 }));                                         // 睛
      o.push('<ellipse cx="-26" cy="-19" rx="1.5" ry="1.9" fill="#2f2a24"/>');
      o.push('<circle cx="-10" cy="-16" r="1.2" fill="' + MT.ink + '"/>');                       // 鼻孔
      o.push(p('M-4 -12 q 2 3 4 1', 'none', { w: 1.2 }));
      o.push('<g transform="translate(-6,-26)">' + riderChick(night) + '</g>');                  // 乘客
      return '<g class="mount mount-west">' + o.join('') + '</g>';
    },
    /* 纸飞机（白天）——记忆点：折痕线 */
    paper: function (night) {
      var c = mountPal('paper', night);
      var o = [];
      o.push(p('M-58 0 L10 -16 L-28 -8 L-22 0 L-28 8 L10 16 Z', c.body, { w: 2 }));             // 镖形机身
      o.push(p('M-58 0 L-22 0', 'none', { w: 1.4, op: .7 }));                                    // 中折线
      o.push(p('M-44 -6 L-16 -12 M-44 6 L-16 12', 'none', { w: 1.2, op: .5 }));                 // 折痕
      o.push(p('M-58 0 L-46 -4 L-46 4 Z', c.shade, { w: 1.4 }));                                 // 机头折角
      o.push(ell(-30, 0, 4.5, 3.4, c.win, { w: 1.2 }));                                          // 舷窗
      o.push(p('M10 -16 L26 -8 L14 -4 Z M10 16 L26 8 L14 4 Z', c.shade, { w: 1.6 }));            // 尾翼折角
      o.push('<g transform="translate(-34,-9)">' + riderChick(night) + '</g>');                  // 乘客骑机背
      return '<g class="mount mount-paper">' + o.join('') + '</g>';
    }
  };
  function mountSVG(mountId, night) {
    var DATA = typeof module === 'object' && module.exports ? require('./data.js')
      : ((typeof window !== 'undefined' && window.TF) ? window.TF.DATA : null);
    var m = DATA && DATA.MOUNT_BY_ID ? DATA.MOUNT_BY_ID[mountId] : null;
    var fn = MOUNT_ART[m && m.art];          // 美术 key 在坐骑表里（id ≠ 美术 key）
    if (!fn) return '';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-64 -52 128 96" class="mount-svg">' + fn(night) + '</svg>';
  }

  /* ============================================================
   * 出发台：树冠平台 + 小鸡 + 三叶草畦 + 铃铛
   * 热点坐标从绘制函数导出（scene 坐标即 hotspot 坐标，测试对得上）。
   * ============================================================ */
  var LAUNCH_HOTSPOTS = {
    frog: { x: 200, y: 138 },
    patch: { x: 56, y: 190, w: 76, h: 30 },
    bell: { x: 268, y: 132, w: 34, h: 44 }
  };
  function launchScene(timeOfDay, patchRipe) {
    var night = timeOfDay === 'night';
    var pl = night ? PAL.night : PAL.day;
    var r = rngFor('launch|' + timeOfDay);
    var o = [];
    o.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 700" preserveAspectRatio="xMidYMid slice" class="scene-svg">');
    o.push('<defs><linearGradient id="lsky" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + pl.sky[0] + '"/><stop offset="16%" stop-color="' + pl.sky[1] + '"/>' +
      '<stop offset="30%" stop-color="' + pl.sky[2] + '"/><stop offset="38%" stop-color="' + pl.sky[3] + '"/></linearGradient>' +
      '<linearGradient id="lwash" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="rgba(0,0,0,0)"/><stop offset="100%" stop-color="' + (night ? 'rgba(10,14,34,.92)' : 'rgba(64,116,72,.5)') + '"/></linearGradient></defs>');
    o.push('<rect width="320" height="700" fill="url(#lsky)"/>');
    if (pl.star) {
      for (var i = 0; i < pl.star; i++) {
        o.push('<circle cx="' + r2(r() * 316) + '" cy="' + r2(r() * 110) + '" r="' + r2(0.6 + r() * 1.2) + '" fill="#fff" opacity="' + r2(.3 + r() * .6) + '"/>');
      }
    }
    /* 日 / 月晕（云下，柔光不刺眼） */
    if (!night) {
      o.push('<circle cx="252" cy="106" r="30" fill="' + pl.sun + '" opacity=".30"/>');
      o.push('<circle cx="252" cy="106" r="18" fill="' + pl.sun + '" opacity=".5"/>');
    } else {
      o.push('<circle cx="252" cy="106" r="26" fill="' + pl.sun + '" opacity=".20"/>');
    }
    /* 厚白云（在可见的雾间天空带，圆滚滚 + 淡淡底面影） */
    for (i = 0; i < 3; i++) {
      var cx = r2(30 + r() * 240), cy = r2(88 + r() * 26), s = r2(.6 + r() * .5);
      o.push(plumpCloud(cx, cy, s, night, pl));
    }
    /* 日 / 月（云上，永远可见：暖黄白日 / 浅黄圆月） */
    if (night) {
      o.push('<circle cx="252" cy="106" r="11" fill="' + pl.sun + '"/>');
      o.push('<circle cx="250" cy="104" r="8.5" fill="' + pl.sunCore + '" opacity=".85"/>');
    } else {
      o.push('<circle cx="252" cy="106" r="11" fill="' + pl.sun + '"/>');
      o.push('<circle cx="250" cy="104" r="8" fill="' + pl.sunCore + '" opacity=".9"/>');
    }
    /* 树冠（上缘叶团：圆润卡通绿，亮前深后 + 暖光高光） */
    o.push(p('M-10 74 Q40 34 118 62 Q150 72 168 62 Q196 48 240 60 Q300 74 330 54 L330 0 L-10 0 Z', night ? '#2c3b4a' : '#79c06a', { w: 2.4 }));
    o.push(p('M-10 96 Q60 66 130 84 Q180 94 214 80 Q268 62 330 76 L330 0 L-10 0 Z', night ? '#24313f' : '#54994e', { w: 2.2 }));
    if (!night) o.push(p('M-10 62 Q40 30 118 54 Q150 63 168 54 Q196 42 240 52 Q300 66 330 48 L330 0 L-10 0 Z', '#a4d98a', { w: 0, op: .8 }));
    /* 雾带（暖阳雾，低透明度横过画面） */
    o.push('<path d="M-10 118 Q80 104 170 116 Q260 128 330 114 L330 127 Q260 140 170 128 Q80 116 -10 130 Z" fill="' + (night ? '#c9d4e8' : '#fdf6e8') + '" opacity="' + (night ? .08 : .2) + '"/>');
    o.push('<path d="M-10 152 Q90 142 180 150 Q270 158 330 148 L330 159 Q270 168 180 160 Q90 152 -10 162 Z" fill="' + (night ? '#c9d4e8' : '#fdf6e8') + '" opacity="' + (night ? .06 : .14) + '"/>');
    /* 主枝：右下伸出的平台枝 */
    o.push(p('M330 128 Q230 118 150 136 Q90 148 52 168 L70 186 Q112 162 170 152 Q250 138 330 146 Z', '#8a6a48', { w: 2.2 }));
    o.push(p('M300 136 Q220 130 150 148', 'none', { w: 1.6, op: .45 }));
    o.push(p('M262 134 Q200 132 130 152', 'none', { w: 1.4, op: .35 }));
    /* 枝上青苔 + 小枝 */
    o.push(ell(196, 136, 26, 6, '#7fb55c', { ink: false, op: .85 }));
    o.push(p('M268 138 Q286 128 300 126', 'none', { w: 2.4 }));
    /* 三叶草畦（左下土堆，位置与 LAUNCH_HOTSPOTS.patch 一致） */
    o.push(ell(56, 192, 40, 13, '#9a6b45', { w: 2 }));
    o.push(ell(50, 186, 30, 8, '#b0875c', { ink: false }));
    patchRipe.forEach(function (ripe, i) {
      var px = 34 + i * 15;
      o.push(cloverPlant(px, 186, ripe));
    });
    /* 铃铛架（右侧，位置与 LAUNCH_HOTSPOTS.bell 一致） */
    o.push('<rect x="266" y="148" width="6" height="38" fill="#7a5a3a" stroke="' + INK + '" stroke-width="1.6"/>');
    o.push(p('M262 148 L276 148 L272 138 L266 138 Z', '#7a5a3a', { w: 1.6 }));
    o.push(p('M268 138 q 8 2 8 12 q 0 7 3 10 L260 160 q 3 -3 3 -10 q 0 -10 8 -12 Z', '#e8c46a', { w: 1.8 }));
    o.push('<circle cx="268" cy="139" r="2.2" fill="#c9a23a"/>');
    o.push('<circle cx="268" cy="162" r="2.6" fill="#c9a23a"/>');
    /* 小鸡站在平台上（脚底 = LAUNCH_HOTSPOTS.frog） */
    o.push('<g transform="translate(' + LAUNCH_HOTSPOTS.frog.x + ',' + (LAUNCH_HOTSPOTS.frog.y - 2) + ') scale(2.2)">' + riderChick(night) + '</g>');
    o.push(ell(LAUNCH_HOTSPOTS.frog.x, LAUNCH_HOTSPOTS.frog.y + 3, 15, 4, '#000', { ink: false, op: .14 }));

    /* ---------- 下方：巨树主体（满屏水墨构图） ---------- */
    /* 平台下缘小枝与垂藤 */
    o.push(p('M150 186 Q140 220 132 258', 'none', { w: 1.6, op: .8 }));
    o.push(p('M180 190 Q192 230 196 266', 'none', { w: 1.4, op: .7 }));
    o.push(p('M120 182 Q104 216 98 244', 'none', { w: 1.4, op: .7 }));
    /* 树干：从平台枝下缘直落到底 */
    o.push(p('M34 218 Q74 204 150 208 Q226 212 288 222 L320 330 L320 700 L0 700 L0 322 Q16 260 34 218 Z', night ? '#33271e' : '#9c6b44', { w: 2.6 }));
    o.push(p('M120 240 Q114 380 128 560', 'none', { w: 1.8, op: .35 }));
    o.push(p('M204 236 Q214 400 200 620', 'none', { w: 1.6, op: .3 }));
    o.push(ell(58, 430, 12, 30, night ? '#241c15' : '#7a5332', { w: 1.6 }));
    /* 两侧树影（柔和青绿，浓淡三层） */
    o.push('<ellipse cx="-20" cy="470" rx="120" ry="150" fill="' + (night ? '#16213c' : '#6f9e6a') + '" opacity=".85"/>');
    o.push('<ellipse cx="-12" cy="430" rx="86" ry="120" fill="' + (night ? '#1b2a48' : '#5d8c58') + '" opacity=".9"/>');
    o.push('<ellipse cx="342" cy="520" rx="130" ry="170" fill="' + (night ? '#141f38' : '#6f9e6a') + '" opacity=".8"/>');
    o.push('<ellipse cx="330" cy="470" rx="90" ry="130" fill="' + (night ? '#182642' : '#5d8c58') + '" opacity=".9"/>');
    /* 淡彩晕染：底部沉入青绿深处 */
    o.push('<rect x="0" y="330" width="320" height="370" fill="url(#lwash)"/>');
    /* 夜：萤火 */
    if (night) {
      for (i = 0; i < 6; i++) {
        o.push('<circle cx="' + r2(20 + r() * 280) + '" cy="' + r2(340 + r() * 320) + '" r="' + r2(1.4 + r() * 1.4) + '" fill="#e8c46a" opacity="' + r2(.35 + r() * .45) + '"/>');
      }
    }
    o.push('</svg>');
    return o.join('');
  }

  /* 一株三叶草：成熟=饱满绿，未熟=小苗 */
  function cloverPlant(x, y, ripe) {
    if (!ripe) return '<g transform="translate(' + r2(x) + ',' + r2(y) + ')"><path d="M0 0 q -1 6 0 9" stroke="#5f9f4a" stroke-width="1.6" fill="none"/><circle cx="-3" cy="-2" r="2.2" fill="#7fbe5c"/></g>';
    return '<g transform="translate(' + r2(x) + ',' + r2(y) + ')">' +
      '<circle cx="-4" cy="-7" r="4.6" fill="#6fb04a" stroke="' + INK + '" stroke-width="1.2"/>' +
      '<circle cx="4" cy="-7" r="4.6" fill="#6fb04a" stroke="' + INK + '" stroke-width="1.2"/>' +
      '<circle cx="0" cy="-1" r="4.6" fill="#6fb04a" stroke="' + INK + '" stroke-width="1.2"/>' +
      '<path d="M0 0 q -1 5 0 8" stroke="#4a7f3a" stroke-width="1.6" fill="none"/></g>';
  }

  /* 一朵吉卜力厚白云：圆滚滚、底面略平 + 淡淡底部影 */
  function plumpCloud(cx, cy, s, night, pl) {
    var op = night ? .16 : .55;
    var puff = '<ellipse cx="-14" cy="2" rx="15" ry="8.5"/>' +
      '<ellipse cx="14" cy="2" rx="15" ry="8.5"/>' +
      '<ellipse cx="0" cy="-4" rx="17" ry="10"/>' +
      '<ellipse cx="0" cy="5" rx="22" ry="7"/>';
    return '<g opacity="' + op + '" transform="translate(' + cx + ',' + cy + ') scale(' + s + ')">' +
      '<ellipse cx="0" cy="7" rx="20" ry="5" fill="' + pl.cloudShade + '" opacity=".55"/>' +
      '<g fill="' + pl.cloud + '">' + puff + '</g></g>';
  }

  /* ============================================================
   * 天空飞行：可循环滚动的分层（各层独立 translate 形成视差）
   * ============================================================ */
  function skyLayers(mountId) {
    var pl = palFor(mountId);
    var night = mountId === 'owl';
    var r = rngFor('sky|' + mountId);
    var W = 640, H = 220;
    var o = { bg: '', far: '', mid: '', near: '' };

    /* 底：天空 + 日月星（不滚） */
    var b = [];
    b.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice" class="sky-bg">');
    b.push('<defs><linearGradient id="fsky" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + pl.sky[0] + '"/><stop offset="45%" stop-color="' + pl.sky[1] + '"/>' +
      '<stop offset="80%" stop-color="' + pl.sky[2] + '"/><stop offset="100%" stop-color="' + pl.sky[3] + '"/></linearGradient></defs>');
    b.push('<rect width="' + W + '" height="' + H + '" fill="url(#fsky)"/>');
    if (pl.star) {
      for (var i = 0; i < pl.star; i++) {
        b.push('<circle cx="' + r2(r() * W) + '" cy="' + r2(r() * 130) + '" r="' + r2(0.6 + r() * 1.3) + '" fill="#fff" opacity="' + r2(.3 + r() * .6) + '"/>');
      }
    }
    if (night) {
      b.push('<circle cx="548" cy="44" r="30" fill="' + pl.sun + '" opacity=".16"/>');
      b.push('<circle cx="548" cy="44" r="14" fill="' + pl.sun + '"/>');
      b.push('<circle cx="546" cy="42" r="10.5" fill="' + pl.sunCore + '" opacity=".9"/>');
    } else {
      b.push('<circle cx="552" cy="44" r="38" fill="' + pl.sun + '" opacity=".22"/>');
      b.push('<circle cx="552" cy="44" r="26" fill="' + pl.sun + '" opacity=".4"/>');
      b.push('<circle cx="552" cy="44" r="15" fill="' + pl.sun + '"/>');
      b.push('<circle cx="550" cy="42" r="11" fill="' + pl.sunCore + '" opacity=".92"/>');
    }
    b.push('</svg>');
    o.bg = b.join('');

    /* 远山（慢滚）：x 轴首尾相接的起伏 */
    var f = [];
    f.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice" class="sky-far">');
    f.push('<path d="M0 190 Q50 150 110 178 Q170 138 230 172 Q290 146 350 180 Q410 150 470 176 Q530 152 580 178 Q610 168 640 190 L640 220 L0 220 Z" fill="' + pl.hill + '" opacity=".6"/>');
    f.push('<path d="M0 200 Q70 178 150 198 Q240 176 320 200 Q400 182 480 202 Q560 186 640 200 L640 220 L0 220 Z" fill="' + pl.hill2 + '" opacity=".55"/>');
    f.push('</svg>');
    o.far = f.join('');

    /* 云带（中滚）：首尾可循环 */
    var m = [];
    m.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice" class="sky-mid">');
    var cx2 = 0;
    while (cx2 < W + 80) {
      var cw = 76 + r() * 84, ch = 18 + r() * 16, cyy = 26 + r() * 66;
      var half = r2(cw / 2), q = r2(cw * 0.26);
      m.push('<g opacity="' + r2(night ? .14 : .6) + '" transform="translate(' + r2(cx2) + ',' + r2(cyy) + ')">' +
        '<ellipse cx="0" cy="' + r2(ch * 0.45) + '" rx="' + half + '" ry="' + r2(ch * 0.4) + '" fill="' + pl.cloudShade + '" opacity=".5"/>' +
        '<g fill="' + pl.cloud + '">' +
        '<ellipse cx="0" cy="' + r2(-ch * 0.2) + '" rx="' + half + '" ry="' + r2(ch * 0.62) + '"/>' +
        '<ellipse cx="' + r2(-q) + '" cy="' + r2(-ch * 0.1) + '" rx="' + q + '" ry="' + r2(ch * 0.5) + '"/>' +
        '<ellipse cx="' + q + '" cy="' + r2(-ch * 0.05) + '" rx="' + q + '" ry="' + r2(ch * 0.5) + '"/>' +
        '<ellipse cx="0" cy="' + r2(-ch * 0.55) + '" rx="' + r2(q * 0.9) + '" ry="' + r2(ch * 0.5) + '"/>' +
        '</g></g>');
      cx2 += cw + 34 + r() * 40;
    }
    m.push('</svg>');
    o.mid = m.join('');

    /* 近处雾丝（快滚） */
    var n = [];
    n.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice" class="sky-near">');
    for (i = 0; i < 7; i++) {
      var wx = r() * W, wy = 120 + r() * 80, ww = 40 + r() * 60;
      n.push('<path d="M' + r2(wx) + ' ' + r2(wy) + ' q ' + r2(ww / 2) + ' -6 ' + r2(ww) + ' 0" stroke="' + (night ? '#d8d4c4' : '#f4fbf7') + '" stroke-width="' + r2(2 + r() * 2) + '" fill="none" opacity="' + r2(night ? .14 : .32) + '"/>');
    }
    n.push('</svg>');
    o.near = n.join('');
    return o;
  }

  /* ---------- 滑翔道具（UI 定位，这里只出造型） ---------- */
  /* 上升气流：三圈螺旋 + 微光 */
  function thermalSVG() {
    var o = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="-30 -70 60 80" class="thermal-svg">'];
    o.push('<path d="M0 8 q -16 -14 0 -26 q 16 -12 0 -24 q -14 -10 0 -20" fill="none" stroke="#dff3fb" stroke-width="3" stroke-linecap="round" opacity=".85"/>');
    o.push('<path d="M0 8 q -16 -14 0 -26 q 16 -12 0 -24 q -14 -10 0 -20" fill="none" stroke="#8fd6e8" stroke-width="1.4" stroke-linecap="round" opacity=".5"/>');
    o.push('</svg>');
    return o.join('');
  }
  /* 乌云：灰蓝 + 排线 */
  function stormCloudSVG() {
    var o = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="-44 -26 88 52" class="storm-svg">'];
    o.push(p('M-36 4 Q-34 -14 -12 -14 Q2 -22 22 -10 Q40 -16 42 0 Q46 8 36 8 L-32 8 Q-42 8 -36 4 Z', '#5d6b86', { w: 2.2 }));
    o.push(p('M-22 14 Q-12 20 0 14 Q12 20 24 12', 'none', { w: 2, op: .7 }));
    o.push(p('M-30 -2 q 6 5 12 0 M-8 -6 q 6 5 12 0 M10 0 q 6 5 12 0', 'none', { w: 1.2, op: .5 }));
    o.push('</svg>');
    return o.join('');
  }
  /* 光圈：一圈三叶草 + 虚线弧 */
  function ringSVG() {
    var o = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="-30 -30 60 60" class="ring-svg">'];
    o.push('<circle r="26" fill="none" stroke="#e8e4d0" stroke-width="2.4" stroke-dasharray="5 7" opacity=".9"/>');
    [[-12, -14], [14, -12], [0, 16]].forEach(function (c) {
      o.push('<g transform="translate(' + c[0] + ',' + c[1] + ') scale(.85)"><circle cx="-3.4" cy="-6" r="4" fill="#6fb04a"/><circle cx="3.4" cy="-6" r="4" fill="#6fb04a"/><circle cx="0" cy="-1" r="4" fill="#6fb04a"/></g>');
    });
    o.push('</svg>');
    return o.join('');
  }
  /* 浮游三叶草（自动段点击收集） */
  function wispSVG() {
    var o = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="-16 -18 32 32" class="wisp-svg">'];
    o.push('<g><circle cx="-5" cy="-8" r="5.6" fill="#6fb04a" stroke="' + INK + '" stroke-width="1.2"/>' +
      '<circle cx="5" cy="-8" r="5.6" fill="#6fb04a" stroke="' + INK + '" stroke-width="1.2"/>' +
      '<circle cx="0" cy="-1" r="5.6" fill="#6fb04a" stroke="' + INK + '" stroke-width="1.2"/>' +
      '<path d="M0 -1 q -1 6 0 10" stroke="#4a7f3a" stroke-width="1.6" fill="none"/></g>');
    o.push('<circle r="12" fill="#fff" opacity=".14"/>');
    o.push('</svg>');
    return o.join('');
  }

  /* ---------- 结算明信片卡：目的地剪影 + 坐骑掠过 ---------- */
  var SILHOUETTES = {
    lake: function (pl) {
      return '<ellipse cx="196" cy="122" rx="120" ry="26" fill="' + (pl === PAL.night ? '#3a5a8c' : '#6cc0e8') + '"/>' +
        '<ellipse cx="196" cy="120" rx="104" ry="20" fill="#fff" opacity=".12"/>' +
        '<path d="M0 190 Q80 150 170 182 Q240 156 320 186 L320 220 L0 220 Z" fill="' + pl.hill + '" opacity=".75"/>' +
        '<circle cx="256" cy="40" r="22" fill="' + pl.sun + '" opacity=".25"/>' +
        '<circle cx="256" cy="40" r="14" fill="' + pl.sun + '"/>';
    },
    peak: function (pl) {
      return '<path d="M0 220 L96 96 L150 160 L206 80 L258 158 L320 220 Z" fill="' + pl.hill2 + '"/>' +
        '<path d="M96 96 L116 128 L76 128 Z" fill="#fdfbf6"/><path d="M206 80 L226 118 L186 118 Z" fill="#fdfbf6"/>' +
        '<circle cx="62" cy="40" r="22" fill="' + pl.sun + '" opacity=".25"/>' +
        '<circle cx="62" cy="40" r="14" fill="' + pl.sun + '"/>';
    },
    town: function (pl) {
      var o = ['<path d="M0 190 Q90 160 180 184 Q260 162 320 182 L320 220 L0 220 Z" fill="' + pl.hill + '" opacity=".75"/>'];
      for (var i = 0; i < 4; i++) {
        var x = 40 + i * 68;
        o.push('<rect x="' + x + '" y="146" width="30" height="44" fill="#f2e8d0"/>');
        o.push('<path d="M' + (x - 4) + ' 146 L' + (x + 15) + ' 130 L' + (x + 34) + ' 146 Z" fill="#c96f52"/>');
        o.push('<rect x="' + (x + 10) + '" y="156" width="8" height="8" fill="' + (pl === PAL.night ? '#ffd98a' : '#8fb6d0') + '"/>');
      }
      o.push('<circle cx="280" cy="44" r="21" fill="' + pl.sun + '" opacity=".25"/>');
      o.push('<circle cx="280" cy="44" r="13" fill="' + pl.sun + '"/>');
      return o.join('');
    }
  };
  function settleCardSVG(destId, mountId) {
    var pl = palFor(mountId);
    var o = [];
    o.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" preserveAspectRatio="xMidYMid slice" class="card-svg">');
    o.push('<defs><linearGradient id="csky" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + pl.sky[0] + '"/><stop offset="45%" stop-color="' + pl.sky[1] + '"/>' +
      '<stop offset="80%" stop-color="' + pl.sky[2] + '"/><stop offset="100%" stop-color="' + pl.sky[3] + '"/></linearGradient></defs>');
    o.push('<rect width="320" height="220" fill="url(#csky)"/>');
    var sil = (SILHOUETTES[destId] || SILHOUETTES.lake)(pl);
    o.push('<g opacity=".9">' + sil + '</g>');
    /* 坐骑掠过 + 乘客（美术 key 从坐骑表查） */
    var DATA2 = typeof module === 'object' && module.exports ? require('./data.js')
      : ((typeof window !== 'undefined' && window.TF) ? window.TF.DATA : null);
    var mm = DATA2 && DATA2.MOUNT_BY_ID ? DATA2.MOUNT_BY_ID[mountId] : null;
    var artKey = mm && mm.art;
    o.push('<g transform="translate(150,84) scale(0.92)">' + (artKey && MOUNT_ART[artKey] ? MOUNT_ART[artKey](mountId === 'owl') : '') + '</g>');
    o.push('</svg>');
    return o.join('');
  }

  return {
    mountSVG: mountSVG,
    MOUNT_ART: MOUNT_ART,
    launchScene: launchScene,
    LAUNCH_HOTSPOTS: LAUNCH_HOTSPOTS,
    skyLayers: skyLayers,
    thermalSVG: thermalSVG,
    stormCloudSVG: stormCloudSVG,
    ringSVG: ringSVG,
    wispSVG: wispSVG,
    settleCardSVG: settleCardSVG,
    palFor: palFor,
    PAL: PAL,
    rngFor: rngFor,
    r2: r2
  };
});
