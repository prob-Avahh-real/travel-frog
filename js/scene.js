/* ============================================================
 * 旅行青蛙 · 场景 (js/scene.js)
 * ------------------------------------------------------------
 * 单一职责：画出「青蛙家」这张满屏插画 —— 树屋（一点透视的室内 + 俯视/侧视
 * 混合的庭院：上：天花板/后墙/侧墙/地板/窗/床；
 * 架子/床/木台；下：草地/石板路/土畦/树桩桌/邮筒/栅栏/灯柱）
 * + 可点的三叶草畦 + 青蛙 + 蜗牛访客。
 *
 * 风格目标（借鉴 Hit-Point 原作的*风格语言*，不是复制其画面）：
 *   勾线（统一描边色）+ 平涂（低饱和苔绿/暖棕/灰蓝）+ 手绘笔触 + 纸纹噪点。
 *
 * 三个动态槽位用空 <g> 占位，UI 层只替换它们的内容，避免每帧重画整张图：
 *   #tf-clovers  12 株三叶草
 *   #tf-frog     青蛙（姿态随在家活动变化；出门时换成门口的一封信）
 *   #tf-snail    蜗牛访客
 * 纯函数、零 DOM 依赖，可在 Node 里断言（见 test/ui.test.js 的坐标一致性用例）。
 * ============================================================ */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else { root.TF = root.TF || {}; root.TF.Scene = mod; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var W = 420, H = 820;
  function r2(x) { return Math.round(x * 100) / 100; }

  /* ---------- 风格常量：勾线 + 水彩色板 ---------- */
  var INK = '#3c352d';
  var C = {
    trunk: '#c19b6c', trunkD: '#a8815a', trunkL: '#d6b98c', ring: '#9a7752',
    wall: '#f3e9cf', wallD: '#e3d5b0', beam: '#d2a877', beamD: '#b78e63',
    floor: '#ddb785', floorD: '#c19867',
    stone: '#d7dcde', stoneD: '#bcc3c7', stoneL: '#eaeeef',
    wood: '#e3bf90', woodD: '#cba074', deck: '#d2a877', deckD: '#b78e63',
    grass: '#9ccb6e', grassD: '#7cad5a', grassL: '#b9dd8d',
    soil: '#9c7855', soilD: '#7a5c40',
    cloth: '#f0e6ca', clothD: '#dccdaa',
    blue: '#82bde4', blueD: '#5f9ac6', blueL: '#bfe0f2',
    red: '#d05a45', redD: '#aa4635',
    flame: '#f8cb50', leaf: '#88bb5f', leafD: '#6a9c49',
    paper: '#fbf6e6', paperD: '#e8dfc4',
    sky: '#d9eef8', skyD: '#b0dbee',
    pot: '#e3cfb0', potD: '#cdb28e'
  };

  /* 统一描边的路径助手。
     手绘感的关键之一是"线比色重"：所有描边统一按 1.3 倍加粗，改一个数就整体变调。 */
  var W_MUL = 1.5;
  function p(d, fill, opt) {
    opt = opt || {};
    return '<path d="' + d + '" fill="' + (fill || 'none') + '" stroke="' +
      (opt.ink === false ? 'none' : INK) + '" stroke-width="' + r2((opt.w || 1.8) * W_MUL) +
      '" stroke-linejoin="round" stroke-linecap="round"' +
      (opt.op ? ' opacity="' + opt.op + '"' : '') + '/>';
  }
  function el(tag, attrs, inner) {
    var s = '<' + tag;
    for (var k in attrs) s += ' ' + k + '="' + attrs[k] + '"';
    return s + '>' + (inner || '') + '</' + tag + '>';
  }
  function ell(cx, cy, rx, ry, fill, opt) {
    opt = opt || {};
    return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="' + fill +
      '"' + (opt.ink === false ? '' : ' stroke="' + INK + '" stroke-width="' + (opt.w || 1.6) + '"') +
      (opt.op ? ' opacity="' + opt.op + '"' : '') + '/>';
  }
  /* ---------- 手绘辅助：确定性抖动 + 排线 ---------- */
  /** 由整数种子得到 [-amp, amp] 的确定性抖动（同一处永远同一抖法） */
  function jit(n, amp) {
    var x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return ((x - Math.floor(x)) * 2 - 1) * amp;
  }
  /** 一片排线：从 (x,y) 起，n 笔，每笔沿 (dx,dy) 递进、长度带抖动 —— 手绘阴影靠它 */
  function hatch(x, y, n, len, dx, dy, op, seed) {
    var lx = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = -dy / lx, uy = dx / lx;                 // 笔向（垂直于排线推进方向）
    var s = '';
    for (var i = 0; i < n; i++) {
      var L = len * (0.78 + (jit(seed + i * 3.7, 0.5) + 0.5) * 0.44);
      var sx = x + dx * i + jit(seed + i, 1.2), sy = y + dy * i + jit(seed + i * 1.9, 1.2);
      s += '<path d="M' + r2(sx) + ' ' + r2(sy) + ' l ' + r2(ux * L) + ' ' + r2(uy * L) + '"/>';
    }
    return '<g opacity="' + op + '" stroke="' + INK + '" stroke-width="1.25" stroke-linecap="round" fill="none">' + s + '</g>';
  }
  /** 重复元素的抖动：让栅栏、草簇不要像机器排出来的 */
  function wob(i, amp, rot) { return ' transform="rotate(' + r2(jit(i * 5.1 + 7, rot || 0)) + ' ' + r2(jit(i * 2.3, amp)) + ' ' + r2(jit(i * 3.7, amp)) + ')"'; }

    /* ============================================================
     * 透视骨架（这一版的核心）
     * ------------------------------------------------------------
     * 原作不是"正侧视剖面"，而是「室内一点透视 + 庭院俯视/侧视混合」：
     *   · 屋里能看到后墙、左右侧墙、地板、天花板，四条边界都收向消失点 —— 房间有进深
     *   · 地板缝、石板路、土畦都是"越远越窄越密"的梯形
     *   · 桶 / 树桩 / 罐子 / 石墩一律「顶面椭圆 + 侧身」——俯视与侧视的混合
     *   · 远近有大小差、有明暗分层：远景压灰、近景加深、脚下有落影
     * 所有收束都从这一个消失点算：改 VP 或 KROOM，整幅画的进深就变。
     * ============================================================ */
    var VP = { x: 270, y: 220 };                      // 消失点（落在后墙中间）
    var KROOM = 0.45;                                 // 后墙相对门洞的收缩比：越大房间越浅
    var ROOM = { l: 150, r: 420, t: 24, b: 400 };     // 门洞（= 画面裁切）四条边
    function back(t) { return 1 - (1 - KROOM) * t; }
    function px(x, t) { return r2(VP.x + (x - VP.x) * back(t)); }   // 前景 x → 进深 t 处的 x
    function py(y, t) { return r2(VP.y + (y - VP.y) * back(t)); }
    /** 地板缝的 y：一点透视里等距物体的投影是等比数列 —— 越远越密 */
    function floorY(i) { return r2(VP.y + (ROOM.b - VP.y) * Math.pow(0.9, i)); }
    /** 庭院里的深度缩放：y 越小（越远）画得越小 */
    function dscale(y, far, near) {
      var f = far === undefined ? 0.68 : far, n = near === undefined ? 1.05 : near;
      var k = Math.max(0, Math.min(1, (y - 452) / 366));
      return r2(f + (n - f) * k);
    }
    /** 透视梯形（土畦、小路、门板都用它） */
    function quad(a, b, c, d, fill, opt) {
      return p('M' + a[0] + ' ' + a[1] + ' L' + b[0] + ' ' + b[1] + ' L' + c[0] + ' ' + c[1] +
        ' L' + d[0] + ' ' + d[1] + ' Z', fill, opt);
    }
    /** 顶面椭圆 + 侧身：俯视/侧视混合的关键画法（桶、树桩、罐、石墩、篮） */
    function cyl(cx, baseY, rx, ry, hgt, top, side, opt) {
      opt = opt || {};
      var w = opt.w || 1.7, ty = r2(baseY - hgt), t = '';
      t += p('M' + r2(cx - rx) + ' ' + ty + ' L' + r2(cx - rx) + ' ' + baseY +
        ' A' + rx + ' ' + ry + ' 0 0 1 ' + r2(cx + rx) + ' ' + baseY + ' L' + r2(cx + rx) + ' ' + ty + ' Z',
        side, { w: w, op: opt.op });
      t += ell(cx, ty, rx, ry, top, { w: w, op: opt.op });
      return t;
    }
    /** 地面落影：椭圆压扁、偏下偏右 —— 画面立刻"踩在地上" */
    function shadow(cx, cy, rx, ry) {
      return ell(cx, cy, rx, ry, '#7a6a52', { ink: false, op: .18 });
    }

    

    /* ---------- 土畦：梯形 + 12 株的分布（画面、三叶草、导出热区共用同一份数） ---------- */
    var BEDQ = { fl: [30, 720], fr: [212, 720] };
    BEDQ.bl = [r2(BEDQ.fl[0] + (VP.x - BEDQ.fl[0]) * .30), 570];
    BEDQ.br = [r2(BEDQ.fr[0] + (VP.x - BEDQ.fr[0]) * .30), 570];

    var BED_GRID = [
      [.10, .20], [.34, .16], [.58, .22], [.82, .17],   // 后排（远）：小
      [.16, .50], [.42, .54], [.68, .49], [.90, .53],   // 中排
      [.08, .86], [.32, .90], [.58, .85], [.84, .89]    // 前排（近）：大
    ];
    /** 第 i 株的位置与透视缩放：土畦梯形上按 (u,v) 双线性取点，v 越大越近 */
    function bedPoint(i) {
      var g = BED_GRID[i % BED_GRID.length], u = g[0], v = g[1];
      var xb = BEDQ.bl[0] + (BEDQ.br[0] - BEDQ.bl[0]) * u;
      var xf = BEDQ.fl[0] + (BEDQ.fr[0] - BEDQ.fl[0]) * u;
      return {
        x: r2(xb + (xf - xb) * v),
        y: r2(BEDQ.bl[1] + (BEDQ.fl[1] - BEDQ.bl[1]) * v),
        s: r2(0.95 + 0.52 * v)
      };
    }

  /* ============================================================
   * 静态场景
   * ============================================================ */
  function sceneSVG() {
    var o = [], i;
    o.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H +
      '" preserveAspectRatio="xMidYMid meet" class="scene-svg" id="scene-svg">');

    o.push('<defs>' +
      '<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" result="n"/>' +
      '<feColorMatrix in="n" type="saturate" values="0"/>' +
      '<feComponentTransfer><feFuncA type="linear" slope="0.11"/></feComponentTransfer></filter>' +
      /* 手绘笔触：低频湍流把每条线推歪一点点 —— 直线不会直得那么假 */
      '<filter id="sketch" x="-3%" y="-3%" width="106%" height="106%">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.021 0.028" numOctaves="2" seed="11" result="warp"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="warp" scale="5.4" xChannelSelector="R" yChannelSelector="G"/>' +
      '</filter>' +
      /* 小物件（青蛙/三叶草/蜗牛）用轻一点的抖动：避免小笔画被推糊 */
      '<filter id="sketchFine" x="-6%" y="-6%" width="112%" height="112%">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.024 0.032" numOctaves="2" seed="11" result="warp2"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="warp2" scale="2.2" xChannelSelector="R" yChannelSelector="G"/>' +
      '</filter>' +
      /* 纸纤维：大尺度絮状斑（是"纸"，不是水彩色块） */
      '<filter id="fiber" x="0" y="0" width="100%" height="100%">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.013 0.017" numOctaves="4" seed="5" result="f"/>' +
      '<feColorMatrix in="f" type="saturate" values="0"/>' +
      '<feComponentTransfer><feFuncA type="linear" slope="0.09" intercept="0"/></feComponentTransfer>' +
      '</filter>' +
      '<linearGradient id="wallG" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#f1e8d2"/><stop offset="100%" stop-color="' + C.wall + '"/></linearGradient>' +
      '<linearGradient id="skyG" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + C.sky + '"/><stop offset="100%" stop-color="' + C.skyD + '"/></linearGradient>' +
      '<radialGradient id="lampG" cx="50%" cy="50%" r="50%">' +
      '<stop offset="0%" stop-color="#ffe9a8" stop-opacity=".95"/>' +
      '<stop offset="100%" stop-color="#ffe9a8" stop-opacity="0"/></radialGradient>' +
      '</defs>');
    /* 整幅画收进「笔触层」：低频湍流把每条线推歪一点，直线不会直得那么假 */
    o.push('<g class="ink" filter="url(#sketch)">');

/* ================= 树：左侧一根圆柱，不是一块平板 ================= */
    /* 圆柱感靠三样：上下粗细差、横向"箍"弧、纵向包裹线 */
    o.push(p('M0 0 L122 0 L136 180 Q150 320 138 470 Q128 620 142 820 L0 820 Z', C.trunk, { w: 2.4 }));
    o.push(p('M86 0 L122 0 L136 180 Q150 320 138 470 Q128 620 142 820 L96 820 Z', C.trunkD, { op: .45, ink: false }));
    /* 左侧受光带 */
    o.push(p('M6 0 L30 0 L36 820 L4 820 Z', C.trunkL, { op: .5, ink: false }));
    /* 箍：三个向下的弧（说明我们略低于树腰在看它） */
    [[60, 18], [300, 26], [600, 22]].forEach(function (h) {
      o.push(p('M' + r2(h[0] < 300 ? 2 : 6) + ' ' + h[0] + ' Q74 ' + (h[0] + h[1]) + ' ' + r2(h[0] < 300 ? 134 : 140) + ' ' + h[0],
        'none', { w: 1.9, op: .5 }));
    });
    /* 包裹线：顺着圆柱转的纵线 */
    o.push(p('M34 0 Q52 240 40 460 Q30 660 44 820', 'none', { w: 1.7, op: .35 }));
    o.push(p('M70 0 Q86 250 74 470 Q64 660 78 820', 'none', { w: 1.7, op: .3 }));
    /* 树疤：同心椭圆（原作的树干就靠这个读成圆柱） */
    o.push(ell(74, 168, 20, 13, C.trunkD, { w: 1.8 }));
    o.push(ell(74, 168, 12, 7.5, C.ring, { w: 1.5, op: .9 }));
    o.push(ell(74, 168, 4.5, 3, C.trunkD, { w: 1.3, op: .8 }));
    o.push(ell(58, 620, 15, 10, C.trunkD, { w: 1.6, op: .85 }));
    o.push(ell(58, 620, 8, 5, C.ring, { w: 1.3, op: .8 }));

    /* ================= 树屋内部：一个真正的"盒子" ================= */
    /* 天花板（暗）→ 后墙（亮）→ 左右侧墙（一侧压暗）→ 地板（有板缝） */
    o.push(quad([ROOM.l, ROOM.t], [ROOM.r, ROOM.t], [px(ROOM.r, 1), py(ROOM.t, 1)], [px(ROOM.l, 1), py(ROOM.t, 1)],
      C.beamD, { w: 2.2 }));                                            // 天花板
    o.push(el('rect', { x: px(ROOM.l, 1), y: py(ROOM.t, 1), width: r2(px(ROOM.r, 1) - px(ROOM.l, 1)),
      height: r2(py(ROOM.b, 1) - py(ROOM.t, 1)), fill: 'url(#wallG)' }));// 后墙
    o.push(p('M' + px(ROOM.l, 1) + ' ' + py(ROOM.t, 1) + ' L' + px(ROOM.l, 1) + ' ' + py(ROOM.b, 1) +
      ' L' + ROOM.l + ' ' + ROOM.b + ' L' + ROOM.l + ' ' + ROOM.t + ' Z', C.wallD, { w: 2 })); // 左墙（暗）
    o.push(p('M' + px(ROOM.r, 1) + ' ' + py(ROOM.t, 1) + ' L' + ROOM.r + ' ' + ROOM.t + ' L' + ROOM.r + ' ' + ROOM.b +
      ' L' + px(ROOM.r, 1) + ' ' + py(ROOM.b, 1) + ' Z', C.wallD, { w: 2 }));                    // 右墙
    /* 地板：梯形 + 等比收窄的板缝 */
    o.push(quad([ROOM.l, ROOM.b], [ROOM.r, ROOM.b], [px(ROOM.r, 1), py(ROOM.b, 1)], [px(ROOM.l, 1), py(ROOM.b, 1)],
      C.floor, { w: 2.2 }));
    (function () {
      var xl = function (y) { return r2(ROOM.l + (px(ROOM.l, 1) - ROOM.l) * (ROOM.b - y) / (ROOM.b - py(ROOM.b, 1))); };
      var xr = function (y) { return r2(ROOM.r - (ROOM.r - px(ROOM.r, 1)) * (ROOM.b - y) / (ROOM.b - py(ROOM.b, 1))); };
      for (var i = 1; i < 9; i++) {
        var y = floorY(i);
        o.push(p('M' + xl(y) + ' ' + y + ' L' + xr(y) + ' ' + y, 'none', { w: 1.4, op: .55 }));
      }
    })();
    /* 天花板木条 */
    (function () {
      for (var i = 1; i < 5; i++) {
        var t = i / 5;
        o.push(p('M' + px(ROOM.l, t) + ' ' + py(ROOM.t, t) + ' L' + px(ROOM.r, t) + ' ' + py(ROOM.t, t),
          'none', { w: 1.3, op: .4 }));
      }
    })();

    /* ---- 后墙上的东西：窗 / 挂架陶罐 / 书架（都贴在后墙平面上） ---- */
    var WB = { l: px(ROOM.l, 1), r: px(ROOM.r, 1), t: py(ROOM.t, 1), b: py(ROOM.b, 1) };
    o.push(el('rect', { x: 288, y: WB.t + 14, width: 44, height: 62, fill: 'url(#skyG)' }));   // 窗
    o.push(p('M288 ' + (WB.t + 14) + ' L332 ' + (WB.t + 14) + ' L332 ' + (WB.t + 76) + ' L288 ' + (WB.t + 76) + ' Z',
      'none', { w: 2.1 }));
    o.push(p('M310 ' + (WB.t + 14) + ' L310 ' + (WB.t + 76) + ' M288 ' + (WB.t + 45) + ' L332 ' + (WB.t + 45), 'none', { w: 1.6 }));
    o.push(p('M284 ' + (WB.t + 80) + ' L336 ' + (WB.t + 80) + ' L332 ' + (WB.t + 86) + ' L288 ' + (WB.t + 86) + ' Z',
      C.wood, { w: 1.6 }));                                                                     // 窗台（略突出）
    o.push(p('M298 ' + (WB.t + 66) + ' q 6 -14 16 -14 q 8 10 -4 16 Z', C.leaf, { w: 1.4, op: .9 }));// 窗外一点绿
    /* 挂架 + 三个陶罐 */
    o.push(p('M' + (WB.l + 8) + ' ' + (WB.t + 96) + ' L' + (WB.l + 66) + ' ' + (WB.t + 96), C.wood, { w: 2 }));
    [0, 1, 2].forEach(function (k) {
      var cx = WB.l + 20 + k * 18, by = WB.t + 96;
      o.push(p('M' + (cx - 7) + ' ' + (by - 2) + ' q 7 5 14 0 l -2 -15 q -5 -3 -10 0 Z', k === 1 ? C.pot : C.clothD, { w: 1.5 }));
      o.push(ell(cx, by - 17, 5.2, 2, C.potD, { w: 1.3 }));
    });
    /* 书架 + 三本书 */
    o.push(p('M' + (WB.l + 10) + ' ' + (WB.t + 40) + ' L' + (WB.l + 62) + ' ' + (WB.t + 40) + ' L' + (WB.l + 62) + ' ' + (WB.t + 78) +
      ' L' + (WB.l + 10) + ' ' + (WB.t + 78) + ' Z', C.wood, { w: 1.8 }));
    [0, 1, 2].forEach(function (k) {
      o.push(p('M' + (WB.l + 16 + k * 15) + ' ' + (WB.t + 42) + ' L' + (WB.l + 27 + k * 15) + ' ' + (WB.t + 42) +
        ' L' + (WB.l + 27 + k * 15) + ' ' + (WB.t + 76) + ' L' + (WB.l + 16 + k * 15) + ' ' + (WB.t + 76) + ' Z',
        k === 0 ? C.red : (k === 1 ? C.blue : C.grassD), { w: 1.4 }));
    });

    /* ---- 地板上的东西：床（沿左墙向里收）、被、枕 ---- */
    var BQ = { a: [160, 384], b: [256, 384] };
    BQ.d = [r2(BQ.a[0] + (VP.x - BQ.a[0]) * .32), r2(BQ.a[1] + (VP.y - BQ.a[1]) * .32)];
    BQ.c = [r2(BQ.b[0] + (VP.x - BQ.b[0]) * .32), BQ.d[1]];
    o.push(shadow(212, 396, 62, 11));
    o.push(quad([BQ.a[0] - 6, BQ.a[1] + 10], [BQ.b[0] + 6, BQ.b[1] + 10], BQ.c, BQ.d, C.woodD, { w: 2 }));  // 床框
    o.push(quad(BQ.a, BQ.b, BQ.c, BQ.d, C.cloth, { w: 2.1 }));                                                  // 褥子
    o.push(quad([BQ.a[0] + 8, BQ.a[1] - 6], [BQ.b[0] - 2, BQ.b[1] - 6],
      [BQ.c[0] - 6, BQ.c[1] + 4], [BQ.d[0] + 6, BQ.d[1] + 4], C.red, { w: 1.9, op: .92 }));                    // 被
    o.push(p('M' + (BQ.a[0] + 22) + ' ' + (BQ.a[1] - 2) + ' Q' + ((BQ.a[0] + BQ.b[0]) / 2) + ' ' + (BQ.a[1] - 12) +
      ' ' + (BQ.b[0] - 12) + ' ' + (BQ.a[1] - 2), 'none', { w: 1.5, op: .6 }));
    o.push(quad([BQ.a[0] + 4, BQ.a[1] - 2], [BQ.a[0] + 34, BQ.a[1] - 2],
      [BQ.d[0] + 26, BQ.d[1] + 6], [BQ.d[0] + 4, BQ.d[1] + 6], C.paper, { w: 1.8 }));                          // 枕头
    /* 左墙：钉着的便条（原作的墙上就是这种零碎，否则侧墙是一大片空灰） */
    (function () {
      [[172, 196, -.07], [186, 224, .05], [168, 254, -.03]].forEach(function (n) {
        var w = 24, h = 20;
        o.push('<g transform="translate(' + n[0] + ',' + n[1] + ') rotate(' + r2(n[2] * 57) + ')">' +
          p('M0 0 L' + w + ' 2 L' + (w - 1) + ' ' + h + ' L-1 ' + (h - 2) + ' Z', C.paper, { w: 1.5 }) +
          p('M4 7 L' + (w - 4) + ' 8 M4 12 L' + (w - 7) + ' 13', 'none', { w: 1.2, op: .45 }) +
          '<circle cx="5" cy="3" r="1.7" fill="' + INK + '"/></g>');
      });
    })();
    /* 毛巾 + 挂钩（挂左墙上） */
    o.push(p('M168 250 q 16 -4 30 2 l -3 40 q -14 -5 -26 0 Z', C.cloth, { w: 1.7, op: .95 }));
    o.push(p('M182 246 q 2 -8 6 0', 'none', { w: 1.8 }));
    /* 右墙：挂衣钩 + 小壁架（壁架必须画成往消失点收的平行四边形，否则一贴上去就露馅） */
    o.push(p('M398 268 L398 300', 'none', { w: 2.2 }));
    o.push(p('M392 276 q 10 -8 6 18 q -8 4 -6 -18 Z', C.cloth, { w: 1.6, op: .95 }));
    (function () {
      var k = 0.34, a = [400, 214], b = [366, 214];
      var bb = [a[0] + (VP.x - a[0]) * k, a[1] + (VP.y - a[1]) * k];
      var cc = [b[0] + (VP.x - b[0]) * k, b[1] + (VP.y - b[1]) * k];
      o.push(p('M' + a[0] + ' ' + a[1] + ' L' + b[0] + ' ' + b[1] + ' L' + cc[0] + ' ' + cc[1] + ' L' + bb[0] + ' ' + bb[1] + ' Z',
        C.wood, { w: 1.9 }));
      o.push(p('M' + r2(bb[0] + (a[0] - bb[0]) * .35) + ' ' + r2(bb[1] + (a[1] - bb[1]) * .35) + ' L' + r2(bb[0] + (a[0] - bb[0]) * .35) + ' ' + r2(bb[1] + (a[1] - bb[1]) * .35 - 16),
        'none', { w: 1.5, op: .7 }));
      o.push(cyl(r2(bb[0] + (a[0] - bb[0]) * .28), r2(bb[1] + (a[1] - bb[1]) * .28), 7, 3, 12, C.pot, C.potD, { w: 1.5 }));
      o.push(cyl(r2(bb[0] + (a[0] - bb[0]) * .68), r2(bb[1] + (a[1] - bb[1]) * .68), 6, 2.6, 10, C.blue, C.blueD, { w: 1.5 }));
    })();
    /* 床头板：立在床的里端，让床有"靠头" */
    o.push(p('M' + BQ.d[0] + ' ' + BQ.d[1] + ' L' + BQ.c[0] + ' ' + BQ.c[1] + ' L' + BQ.c[0] + ' ' + (BQ.c[1] - 16) +
      ' L' + BQ.d[0] + ' ' + (BQ.d[1] - 16) + ' Z', C.wood, { w: 1.9 }));
    o.push(p('M' + (BQ.a[0] + 14) + ' ' + (BQ.a[1] - 4) + ' L' + (BQ.b[0] - 10) + ' ' + (BQ.b[1] - 4), 'none', { w: 1.4, op: .5 }));
    o.push(p('M' + (BQ.a[0] + 10) + ' ' + (BQ.a[1] - 14) + ' L' + (BQ.b[0] - 6) + ' ' + (BQ.b[1] - 14), 'none', { w: 1.4, op: .45 }));
    /* 门口木箱 + 柴堆 + 水缸（都在地板上，按进深放大缩小） */
    o.push(shadow(346, 392, 26, 7));
    o.push(cyl(346, 390, 17, 6.5, 22, C.wood, C.woodD, { w: 1.8 }));
    o.push(shadow(300, 396, 20, 6));
    o.push(cyl(300, 394, 13, 5.5, 17, C.pot, C.potD, { w: 1.7 }));
    o.push(shadow(178, 372, 30, 7));
    [0, 1, 2].forEach(function (k) {
      o.push(cyl(164 + k * 12, 372 + k * 3, 8, 5, 6, C.trunkL, C.trunkD, { w: 1.5 }));
    });
    o.push(shadow(322, 396, 18, 5));
    o.push(cyl(322, 392, 15, 6, 13, C.trunkL, C.woodD, { w: 1.7 }));                  // 地板上的篮筐
    o.push(p('M309 384 Q322 374 335 384', 'none', { w: 1.5 }));
    /* 吊篮 + 垂绳木桶：绳子从天花板里出来，这是纵深最便宜的提示 */
    o.push(p('M250 ' + (py(ROOM.t, 1) - 30) + ' L250 118', 'none', { w: 1.6, op: .8 }));
    o.push(cyl(250, 132, 20, 7, 20, C.wood, C.woodD, { w: 1.8 }));
    o.push(p('M232 118 Q250 106 268 118', 'none', { w: 1.6 }));
    o.push(p('M384 ' + (py(ROOM.t, 1) - 34) + ' L384 150', 'none', { w: 1.6, op: .8 }));
    o.push(cyl(384, 176, 15, 5.5, 26, C.wood, C.woodD, { w: 1.8 }));
    o.push(p('M369 ' + 160 + ' L399 160 M369 170 L399 170', 'none', { w: 1.4, op: .7 }));
    /* 右墙上的门（门板按透视收束：竖边仍然竖直，横边指向消失点） */
    (function () {
      var nb = [406, 388], nt = [406, 252], k = 0.22;
      var fb = [r2(nb[0] + (VP.x - nb[0]) * k), r2(nb[1] + (VP.y - nb[1]) * k)];
      var ft = [r2(nt[0] + (VP.x - nt[0]) * k), r2(nt[1] + (VP.y - nt[1]) * k)];
      o.push(p('M' + nb[0] + ' ' + nb[1] + ' L' + fb[0] + ' ' + fb[1] + ' L' + ft[0] + ' ' + ft[1] + ' L' + nt[0] + ' ' + nt[1] + ' Z',
        '#7a6752', { w: 2 }));
      o.push(p('M' + (nb[0] - 6) + ' ' + (nb[1] + 4) + ' L' + nb[0] + ' ' + nb[1] + ' L' + nt[0] + ' ' + nt[1] + ' L' + (nt[0] - 6) + ' ' + (nt[1] - 4) + ' Z',
        C.beam, { w: 1.8 }));
      o.push('<circle cx="' + (nb[0] - 4) + '" cy="' + 320 + '" r="2.6" fill="' + INK + '"/>');
    })();

    /* ================= 庭院：从上（远）往下（近）分层 ================= */
    /* 远景：树篱 + 五棵远树剪影（小、压灰） */
    o.push(p('M0 400 L420 400 L420 452 Q300 438 200 448 Q110 456 0 444 Z', '#8cb06b', { w: 2.2, op: .85 }));
    [[24, 12], [96, 9], [286, 10], [338, 8], [396, 11]].forEach(function (t, k) {
      var tx = t[0], r = t[1];
      o.push(p('M' + tx + ' 448 L' + tx + ' ' + (448 - r * 2.4), 'none', { w: 2.2, op: .85 }));   // 树干
      o.push(ell(tx, 448 - r * 2.4, r * 1.5, r * 1.15, '#7d9e63', { w: 1.6, op: .85 }));         // 树冠
      o.push(ell(tx - r * .8, 448 - r * 2.0, r * .95, r * .8, '#73915a', { w: 1.4, op: .8 }));
      o.push(ell(tx + r * .7, 448 - r * 2.8, r * .8, r * .7, '#8aa772', { w: 1.4, op: .8 }));
    });
    /* 石板路：梯形 + 等比收窄的石缝 */
    (function () {
      var fL = [150, 806], fR = [368, 806], bL = [206, 468], bR = [286, 468];
      o.push(quad(fL, fR, bR, bL, '#d3cdbd', { w: 2.2 }));
      o.push(quad(fL, fR, bR, bL, 'none', { w: 2.2 }));
      for (var i = 1; i < 7; i++) {
        var y = r2(VP.y + (fL[1] - VP.y) * Math.pow(0.78, i * 0.86));
        if (y > 800) continue;
        var k = (fL[1] - y) / (fL[1] - bL[1]);
        var xl = r2(fL[0] + (bL[0] - fL[0]) * k), xr = r2(fR[0] + (bR[0] - fR[0]) * k);
        o.push(p('M' + xl + ' ' + y + ' L' + xr + ' ' + y, 'none', { w: 1.5, op: .7 }));
        o.push(p('M' + r2(xl + (xr - xl) * .52) + ' ' + y + ' L' + r2(xl + (xr - xl) * .48) + ' ' + r2(y + 26), 'none', { w: 1.2, op: .45 }));
      }
    })();
    /* 土畦：梯形，12 株三叶草按同一个梯形分布（坐标只在这一处算） */
    o.push(quad(BEDQ.fl, BEDQ.fr, BEDQ.br, BEDQ.bl, C.soil, { w: 2.2 }));
    (function () {
      for (var i = 1; i < 5; i++) {
        var v = i / 5;
        var yb = BEDQ.bl[1], yf = BEDQ.fl[1], y = r2(yb + (yf - yb) * v);
        var xl = r2(BEDQ.bl[0] + (BEDQ.fl[0] - BEDQ.bl[0]) * v), xr = r2(BEDQ.br[0] + (BEDQ.fr[0] - BEDQ.br[0]) * v);
        o.push(p('M' + r2(xl + 6 * (1 - v)) + ' ' + y + ' Q' + r2((xl + xr) / 2) + ' ' + r2(y + 3) + ' ' + r2(xr - 6 * (1 - v)) + ' ' + y,
          'none', { w: 1.4, op: .5 }));
      }
    })();
    o.push(p('M' + BEDQ.bl[0] + ' ' + BEDQ.bl[1] + ' L' + BEDQ.fl[0] + ' ' + BEDQ.fl[1], 'none', { w: 2, op: .9 }));
    o.push(p('M' + BEDQ.br[0] + ' ' + BEDQ.br[1] + ' L' + BEDQ.fr[0] + ' ' + BEDQ.fr[1], 'none', { w: 2, op: .9 }));

    /* ---- 庭院物件：树桩桌 / 圆木凳 / 邮筒 / 洒水壶 / 蘑菇 / 苔石（都露顶面） ---- */
    o.push(shadow(258, 690, 56, 14));
    o.push(cyl(258, 686, 44, 15, 44, C.wood, C.woodD, { w: 2.2 }));                  // 树桩桌
    o.push(ell(258, 642, 44, 15, 'none', { w: 1.5, op: .55 }));
    o.push(ell(258, 642, 30, 9.5, C.woodD, { w: 1.4, op: .8 }));
    [[242, 636, 0], [258, 640, 1], [274, 636, 0]].forEach(function (f) {             // 桌上的蜡烛/碎屑
      o.push(ell(f[0], f[1], 3.4, 1.4, f[2] ? C.flame : C.trunkD, { w: 1.2 }));
    });
    o.push(shadow(172, 726, 34, 9));
    o.push(cyl(172, 722, 26, 10, 18, C.trunkL, C.trunkD, { w: 1.9 }));               // 圆木凳
    o.push(shadow(342, 700, 30, 8));
    o.push(cyl(342, 696, 22, 9, 16, C.trunkL, C.trunkD, { w: 1.9 }));
    /* 邮筒：柱 + 筒身 + 顶面 + 红旗 */
    o.push(shadow(356, 570, 26, 7));
    o.push(p('M356 570 L356 524', 'none', { w: 6 }));
    o.push(cyl(356, 526, 24, 10, 34, C.red, C.redD, { w: 2.1 }));                     // 筒身
    o.push(ell(356, 492, 24, 10, C.red, { w: 2.1 }));                                 // 顶盖
    o.push(ell(356, 492, 15, 6, C.redD, { ink: false, op: .5 }));
    o.push(p('M336 508 L376 508', 'none', { w: 2, op: .8 }));                         // 投信口
    o.push(p('M380 500 L380 470 L394 470 L394 486 Z', C.flame, { w: 1.6 }));           // 侧面红旗
    o.push(p('M380 500 L394 486', 'none', { w: 1.4, op: .7 }));
    /* 洒水壶 + 蘑菇 + 苔石 */
    o.push(shadow(104, 612, 18, 5));
    o.push(cyl(104, 608, 14, 6, 20, C.blue, C.blueD, { w: 1.8 }));
    o.push(p('M116 594 q 14 -6 12 6', 'none', { w: 1.6 }));
    [[306, 596, 1], [318, 604, 0], [296, 606, 0]].forEach(function (m) {
      var s = dscale(m[1], .7, .95);
      o.push('<g transform="translate(' + m[0] + ',' + m[1] + ') scale(' + s + ')">' +
        cyl(0, 0, 7, 3.4, 6, m[2] ? C.red : C.cloth, C.clothD, { w: 1.5 }) + '</g>');
    });
    [[64, 588, 15, 6], [250, 596, 11, 4.5], [330, 640, 9, 4]].forEach(function (s2) {
      o.push(ell(s2[0], s2[1], s2[2], s2[3], '#b6bba7', { w: 1.5, op: .95 }));
      o.push(ell(s2[0], r2(s2[1] - s2[3] * .5), r2(s2[2] * .6), r2(s2[3] * .5), '#ced3bd', { ink: false, op: .8 }));
    });
    /* 花 */
    [[38, 660, C.red], [226, 660, C.cloth], [136, 592, C.flame]].forEach(function (f2) {
      var s3 = dscale(f2[1], .7, 1);
      o.push('<g transform="translate(' + f2[0] + ',' + f2[1] + ') scale(' + s3 + ')">' +
        p('M0 0 L0 -10', 'none', { w: 1.6 }) +
        [0, 1, 2, 3, 4].map(function (k) {
          var a = -Math.PI / 2 + k * (Math.PI * 2 / 5);
          return ell(r2(Math.cos(a) * 5), r2(Math.sin(a) * 5 - 10), 3.4, 3.4, f2[2], { w: 1.3 });
        }).join('') + ell(0, -10, 2.4, 2.4, C.flame, { w: 1.2 }) + '</g>');
    });

    /* ---- 栅栏 / 灯柱：近景，画大、画深，压在草地前面 ---- */
    o.push(p('M0 762 Q210 754 420 762 L420 774 Q210 766 0 774 Z', C.woodD, { w: 2 }));
    for (var fi = 0; fi < 10; fi++) {
      var fx = r2(14 + fi * 44 + jit(fi * 3.1, 3)), fh = r2(58 + jit(fi * 7.7, 7));
      o.push(p('M' + fx + ' 772 L' + fx + ' ' + r2(772 - fh) + ' L' + r2(fx + 11 + jit(fi * 5.3, 1.6)) + ' ' + r2(772 - fh) +
        ' L' + r2(fx + 11) + ' 772 Z', C.wood, { w: 1.7 }));
      o.push(p('M' + r2(fx + 2) + ' ' + r2(772 - fh * .62) + ' L' + r2(fx + 9) + ' ' + r2(772 - fh * .62), 'none', { w: 1.2, op: .5 }));
    }
    o.push(p('M0 792 Q210 784 420 792 L420 802 Q210 794 0 802 Z', C.woodD, { w: 2 }));
    /* 灯柱：柱身 + 顶面 + 灯焰 + 光晕 */
    o.push(shadow(384, 730, 26, 7));
    o.push(cyl(384, 726, 15, 5.5, 9, C.stone, C.stoneD, { w: 1.7 }));
    o.push(p('M378 718 L378 646 M390 718 L390 646', 'none', { w: 4.4 }));
    o.push(cyl(384, 650, 17, 7, 20, C.trunkL, C.trunkD, { w: 1.9 }));                 // 灯座
    o.push(p('M372 630 L396 630 L392 618 L376 618 Z', C.woodD, { w: 1.6 }));           // 灯罩
    o.push(ell(384, 614, 10, 15, C.flame, { w: 1.7, op: .95 }));                       // 火苗
    o.push(ell(384, 616, 34, 40, '#ffe9a8', { ink: false, op: .26 }));                 // 光晕
    /* 栅栏上的鸟 */
    o.push(p('M104 748 q 10 -9 20 0 q -10 7 -20 0 Z', '#8fa8c0', { w: 1.6 }));
    o.push('<circle cx="122" cy="744" r="1.8" fill="' + INK + '"/>');

    /* ---- 草簇：按深度缩放，位置/角度都抖（机器排的等间距是"矢量味"的来源） ---- */
    for (var gi = 0; gi < 30; gi++) {
      var gx = r2(8 + (gi % 6) * 68 + jit(gi * 2.7, 26));
      var gy = r2(452 + Math.floor(gi / 6) * 62 + jit(gi * 4.3, 22));
      if (gy > 760) continue;
      var gs = dscale(gy, .6, 1.1);
      var pk = Math.max(0, Math.min(1, (806 - gy) / (806 - 468)));
      var pxl = 150 + 56 * pk, pxr = 368 - 82 * pk;              // 石板路在 y 处的左右边
      if (gx > pxl - 6 && gx < pxr + 6) continue;                // 別長在石板路上
      o.push('<g transform="translate(' + gx + ',' + gy + ') scale(' + gs + ') rotate(' + r2(jit(gi * 6.1, 7)) + ')">' +
        p('M-6 0 q -3 -12 -9 -16', 'none', { w: 1.6, op: .8 }) +
        p('M0 0 q 1 -14 -1 -19', 'none', { w: 1.6, op: .85 }) +
        p('M6 0 q 4 -11 10 -14', 'none', { w: 1.6, op: .8 }) + '</g>');
    }

    /* ============================================================
     * 生活痕迹（密度实验版）：屋子、树干、庭院都塞上"用过的东西"
     * ------------------------------------------------------------
     * 原作的密度来自三处：① 屋里挂的/堆的家什 ② 树干上的攀附物 ③ 庭院里的
     * 农具、石堆、蘑菇、木屑。这里按同样三层加，并避开土畦、石板路、树桩桌
     * 与三个动态槽位（青蛙 / 三叶草 / 蜗牛）。
     * 想撤掉这一整块：删掉本段即可（上方那些是基础场景）。
     * ============================================================ */
    /* ---- ① 屋里：梁下吊物 + 后墙挂件 + 地上堆物 + 地垫 ---- */
    o.push(p('M268 ' + (py(ROOM.t, 1) - 24) + ' L268 128', 'none', { w: 1.4, op: .7 }));      // 吊绳
    o.push(p('M256 128 L284 128', C.woodD, { w: 1.6 }));
    [0, 1, 2, 3].forEach(function (k) {                                                       // 干草药束
      o.push(p('M' + (260 + k * 6) + ' 128 q ' + (k % 2 ? 4 : -4) + ' 14 ' + (k % 2 ? 2 : -2) + ' 24', C.grassD, { w: 1.5, op: .8 }));
    });
    o.push(p('M318 ' + (py(ROOM.t, 1) - 26) + ' L318 118', 'none', { w: 1.4, op: .7 }));      // 提灯
    o.push(cyl(318, 140, 11, 4.5, 20, '#f6d78a', C.woodD, { w: 1.7 }));
    o.push(p('M309 122 q 9 -8 18 0', 'none', { w: 1.5 }));
    o.push(ell(318, 128, 16, 14, '#ffe9a8', { ink: false, op: .3 }));
    o.push(p('M' + (WB.l + 54) + ' ' + (WB.t + 10) + ' L' + (WB.l + 54) + ' ' + (WB.t + 20), 'none', { w: 1.8 }));  // 挂钩
    o.push(p('M' + (WB.l + 42) + ' ' + (WB.t + 20) + ' q 12 -2 24 0 q -2 14 -12 15 q -10 -1 -12 -15 Z', C.stoneD, { w: 1.7 }));  // 小锅
    o.push(p('M' + (WB.l + 50) + ' ' + (WB.t + 22) + ' L' + (WB.l + 50) + ' ' + (WB.t + 32), 'none', { w: 1.5 }));
    o.push(quad([176, 394], [240, 394], [232, 364], [186, 364], C.clothD, { w: 1.8, op: .9 }));   // 地垫
    o.push(p('M184 378 Q208 374 232 378', 'none', { w: 1.3, op: .5 }));
    o.push(shadow(282, 399, 20, 5));                                                          // 一摞书
    [0, 1, 2].forEach(function (k) {
      o.push(p('M' + (268 + k) + ' ' + (393 - k * 5) + ' L' + (296 - k) + ' ' + (393 - k * 5) +
        ' L' + (296 - k) + ' ' + (398 - k * 5) + ' L' + (268 + k) + ' ' + (398 - k * 5) + ' Z',
        k === 1 ? C.red : C.blue, { w: 1.5 }));
    });
    o.push(p('M412 300 L404 386', 'none', { w: 3 }));                                          // 门口的扫帚
    o.push(p('M404 386 q -6 6 -8 14 M406 386 q 2 8 0 14 M408 386 q 6 6 9 12', C.trunkL, { w: 1.5, op: .9 }));

    /* ---- ② 树干：攀爬的藤 + 木耳 + 靠在外侧的梯子（解释青蛙怎么上树屋） ---- */
    o.push(p('M18 470 q 26 -60 12 -120 q -10 -50 6 -96', 'none', { w: 2 }));
    [[30, 420], [38, 392], [34, 356], [40, 320], [30, 288]].forEach(function (l, k) {
      o.push(p('M' + l[0] + ' ' + l[1] + ' q ' + (k % 2 ? 14 : -14) + ' -8 ' + (k % 2 ? 22 : -20) + ' 2 q ' +
        (k % 2 ? -8 : 8) + ' 8 ' + (k % 2 ? -22 : 20) + ' -2 Z', C.leaf, { w: 1.5, op: .9 }));
    });
    o.push(ell(96, 330, 9, 5, C.trunkD, { w: 1.5, op: .95 }));
    o.push(ell(112, 372, 7, 4, C.trunkD, { w: 1.4, op: .9 }));
    o.push(p('M150 476 L108 322', C.trunkL, { w: 2.6 }));
    o.push(p('M140 470 L102 318', C.trunkL, { w: 2.6 }));
    (function () {
      for (var i = 1; i <= 6; i++) {
        var t = i / 7;
        o.push(p('M' + r2(150 - 42 * t) + ' ' + r2(476 - 154 * t) + ' L' + r2(140 - 38 * t) + ' ' + r2(470 - 152 * t), C.trunkD, { w: 2.2 }));
      }
    })();

    /* ---- ③ 庭院：柴堆 + 火塘石圈 + 独轮车 + 蘑菇 + 蝴蝶 + 木屑 ---- */
    o.push(shadow(58, 542, 36, 9));
    [[46, 512], [62, 508], [78, 514], [54, 504], [70, 502]].forEach(function (lg) {
      o.push(cyl(lg[0], lg[1], 15, 6.5, 9, C.trunkL, C.trunkD, { w: 1.6 }));
      o.push(p('M' + (lg[0] - 15) + ' ' + (lg[1] - 9) + ' l -1 -3 M' + (lg[0] + 15) + ' ' + (lg[1] - 9) + ' l 1 -3', 'none', { w: 1.3, op: .7 }));
    });
    o.push(ell(150, 518, 26, 10, C.soilD, { w: 1.6, op: .5 }));                                // 火塘
    [0, 1, 2, 3, 4, 5].forEach(function (k) {
      var a = Math.PI * (0.15 + k / 5 * 0.95);
      o.push(ell(r2(150 + Math.cos(a) * 25), r2(518 + Math.sin(a) * 9.5), 6.5, 4.6, k % 2 ? C.stone : C.stoneD, { w: 1.5 }));
    });
    o.push(cyl(150, 513, 12, 5, 13, '#6d6f70', '#55585a', { w: 1.6 }));
    o.push(shadow(208, 738, 42, 10));                                                          // 独轮车
    o.push(p('M182 710 L238 710 L232 738 L186 738 Z', C.blue, { w: 2 }));
    o.push(p('M178 706 L242 706 L238 715 L182 715 Z', C.blueL, { w: 1.8 }));
    o.push(p('M186 738 L224 738', 'none', { w: 2.4 }));
    o.push(ell(205, 740, 11, 7.5, C.trunkD, { w: 1.8 }));
    o.push(p('M238 710 L264 694 L270 702', 'none', { w: 2.6 }));
    [[214, 730, 1], [230, 738, 0], [318, 476, 1]].forEach(function (m) {                        // 蘑菇
      var s = dscale(m[1], .7, .95);
      o.push('<g transform="translate(' + m[0] + ',' + m[1] + ') scale(' + s + ')">' +
        cyl(0, 0, 6.5, 3.2, 6, m[2] ? C.red : C.cloth, C.clothD, { w: 1.5 }) + '</g>');
    });
    o.push('<g transform="translate(196,486) scale(.9)">' +                                     // 蝴蝶
      p('M0 0 q -9 -8 -13 0 q 4 8 13 0 Z', C.blueL, { w: 1.4 }) +
      p('M0 0 q 9 -8 13 0 q -4 8 -13 0 Z', C.blue, { w: 1.4 }) + '</g>');
    (function () {                                                                              // 地面木屑 / 碎石
      for (var i = 0; i < 18; i++) {
        var cx = r2(18 + ((i * 53) % 384) + jit(i * 3.3, 12));
        var cy = r2(486 + ((i * 71) % 250) + jit(i * 5.7, 14));
        var pk = Math.max(0, Math.min(1, (806 - cy) / (806 - 468)));
        var pxl = 150 + 56 * pk, pxr = 368 - 82 * pk;             // 石板路的左右边
        if (cx > pxl - 4 && cx < pxr + 4) continue;
        o.push(p('M' + cx + ' ' + cy + ' l ' + r2(jit(i * 7.1, 4)) + ' ' + r2(jit(i * 9.3, 2.4)), 'none', { w: 1.3, op: .45 }));
        o.push(ell(r2(cx + 6), r2(cy + 3), 1.8, 1.1, C.soilD, { ink: false, op: .4 }));
      }
    })();

    /* ============================================================
     * 手绘层：主轮廓重描 + 排线阴影 + 色块内扫笔（同前几轮的做法）
     * ============================================================ */
    var CONTOURS = [
      'M' + ROOM.l + ' ' + ROOM.t + ' L' + ROOM.l + ' ' + ROOM.b,                       // 门洞左沿（树干内缘）
      'M' + px(ROOM.l, 1) + ' ' + py(ROOM.t, 1) + ' L' + px(ROOM.r, 1) + ' ' + py(ROOM.t, 1),  // 后墙上沿
      'M' + px(ROOM.l, 1) + ' ' + py(ROOM.b, 1) + ' L' + px(ROOM.r, 1) + ' ' + py(ROOM.b, 1),  // 后墙下沿 = 地板里端
      'M' + ROOM.l + ' ' + ROOM.b + ' L' + ROOM.r + ' ' + ROOM.b,                       // 地板前沿
      'M' + ROOM.r + ' ' + ROOM.t + ' L' + ROOM.r + ' ' + ROOM.b,                       // 门洞右沿
      'M136 180 Q150 320 138 470',                                                      // 树干右缘（只到屋里）
      'M' + BEDQ.fl[0] + ' ' + BEDQ.fl[1] + ' L' + BEDQ.fr[0] + ' ' + BEDQ.fr[1],        // 土畦前缘
      'M' + BEDQ.bl[0] + ' ' + BEDQ.bl[1] + ' L' + BEDQ.fl[0] + ' ' + BEDQ.fl[1],        // 土畦左边
      'M258 686 q -44 0 -44 -15',                                                       // 树桩桌左侧
      'M214 642 q 44 -6 88 0',                                                          // 树桩顶面
      'M0 762 Q210 754 420 762',                                                        // 栅栏上梁
      'M288 ' + (WB.t + 14) + ' L332 ' + (WB.t + 14)                                    // 窗框上沿
    ];
    o.push('<g fill="none" stroke="' + INK + '" stroke-linecap="round" stroke-linejoin="round">');
    CONTOURS.forEach(function (d) { o.push('<path d="' + d + '" stroke-width="4" opacity=".16"/>'); });
    CONTOURS.forEach(function (d) { o.push('<path d="' + d + '" stroke-width="1.5" opacity=".8"/>'); });
    o.push('</g>');

    var STROKES = [
      /* 后墙：竖向扫笔 */
      ['M' + r2(WB.l + 16) + ' ' + r2(WB.t + 8) + ' Q' + r2(WB.l + 20) + ' ' + r2((WB.t + WB.b) / 2) + ' ' + r2(WB.l + 14) + ' ' + r2(WB.b - 8), '#dbcca9', .30, 3.4],
      ['M' + r2(WB.l + 74) + ' ' + r2(WB.t + 6) + ' Q' + r2(WB.l + 80) + ' ' + r2((WB.t + WB.b) / 2) + ' ' + r2(WB.l + 72) + ' ' + r2(WB.b - 6), '#dbcca9', .24, 3.0],
      ['M' + r2(WB.r - 30) + ' ' + r2(WB.t + 10) + ' Q' + r2(WB.r - 24) + ' ' + r2((WB.t + WB.b) / 2) + ' ' + r2(WB.r - 32) + ' ' + r2(WB.b - 6), '#dbcca9', .28, 3.6],
      /* 左墙：一道压暗的竖扫 */
      ['M158 60 Q164 210 156 380', '#b9a988', .32, 3.4],
      /* 地板：顺着板缝方向 */
      ['M170 396 Q280 392 412 398', '#c19867', .30, 3.0],
      ['M186 376 Q290 372 400 378', '#c19867', .24, 2.8],
      ['M200 352 Q296 348 386 354', '#c19867', .26, 2.8],
      /* 树干：树皮纹 */
      ['M30 40 Q42 240 30 460 Q22 640 32 800', '#a8815a', .34, 3.6],
      ['M62 30 Q74 250 62 470 Q54 650 64 810', '#a8815a', .26, 3.2],
      ['M96 40 Q106 250 96 470 Q88 650 98 810', '#a8815a', .30, 3.4],
      /* 草地：按深度方向的扫笔 */
      ['M12 480 Q160 470 320 482 Q380 488 416 482', '#7cad5a', .22, 3.4],
      ['M8 540 Q170 528 320 542 Q380 550 414 542', '#7cad5a', .18, 3.0],
      ['M14 620 Q170 610 306 624 Q380 632 414 624', '#7cad5a', .20, 3.2],
      ['M16 700 Q170 692 300 702', '#7cad5a', .18, 3.0],
      ['M20 750 Q170 742 320 752 Q386 758 416 752', '#7cad5a', .20, 3.2],
      /* 土畦：顺着梯形方向 */
      ['M62 592 Q120 650 96 706', '#7a5c40', .26, 3.2],
      ['M130 588 Q170 648 146 712', '#7a5c40', .22, 3.0],
      ['M186 592 Q206 650 190 714', '#7a5c40', .24, 3.2]
    ];
    o.push('<g fill="none" stroke-linecap="round">');
    STROKES.forEach(function (s) {
      o.push('<path d="' + s[0] + '" stroke="' + s[1] + '" stroke-width="' + s[3] + '" opacity="' + s[2] + '"/>');
    });
    o.push('</g>');

    var HATCHES = [
      [px(ROOM.l, 1), py(ROOM.b, 1) - 6, 7, 13, 0, -5, .16, 101],      // 后墙根
      [WB.l + 4, WB.b - 30, 5, 12, 0, -6, .14, 112],
      [ROOM.l + 8, 380, 5, 12, 0, -6, .15, 123],                        // 左墙根
      [212, 402, 6, 11, 0, -5, .14, 134],                               // 床底落影
      [244, 404, 6, 10, 0, -5, .13, 145],
      [346, 398, 4, 10, 0, -5, .15, 156],                               // 木箱底
      [300, 402, 4, 9, 0, -5, .14, 167],
      [128, 250, 6, 12, 0, -6, .16, 178],                               // 树干内侧
      [128, 380, 5, 12, 0, -6, .15, 189],
      [380, 250, 4, 12, 0, -5, .14, 190],                               // 门内侧
      [214, 648, 6, 12, 0, -5, .16, 201],                               // 树桩桌左
      [302, 652, 5, 11, 0, -5, .15, 212],
      [140, 730, 5, 11, 0, -5, .15, 223],                               // 圆木凳下
      [312, 706, 5, 10, 0, -5, .14, 234],
      [348, 570, 4, 10, 0, -5, .14, 245],                               // 邮筒底座
      [72, 618, 4, 9, 0, -5, .14, 256],                                 // 洒水壶底
      [96, 560, 5, 10, 0, -5, .13, 267],                                // 苔石靠左
      [368, 736, 5, 12, 0, -6, .16, 278],                               // 灯柱底
      [46, 780, 5, 12, 0, -6, .15, 289],                                // 栅栏根
      [236, 786, 5, 12, 0, -6, .15, 300],
      [356, 790, 5, 12, 0, -6, .15, 311],
      [112, 700, 4, 10, 0, -5, .13, 322]                                // 土畦边
    ];
    HATCHES.forEach(function (h) {
      o.push(hatch(h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]));
    });
    /* 交叉排线：最深的几处（床下、树桩底、门口） */
    o.push(hatch(226, 404, 6, 10, 5, 4, .15, 401));
    o.push(hatch(268, 700, 6, 11, -5, 4, .16, 412));
    o.push(hatch(392, 300, 6, 11, 5, 4, .15, 423));
    o.push(hatch(150, 700, 6, 11, 6, 5, .14, 434));
    o.push(hatch(60, 620, 5, 11, -5, 5, .14, 445));
    o.push(hatch(340, 600, 5, 10, 5, 5, .14, 456));
    o.push(hatch(210, 470, 5, 10, -5, 4, .13, 467));

    /* ---- 远景压灰：一条淡罩，把庭院顶部推远（明暗分层也是透视） ---- */
    o.push(el('rect', { x: 0, y: ROOM.b, width: W, height: 84, fill: '#f4ecda', opacity: .34 }));
    /* ---- 前景大叶子：让画面有"框"，也是最近的深度层 ---- */
    o.push(p('M0 820 q 22 -48 48 -62 q -10 32 4 62 Z', '#6f9752', { w: 2.2, op: .95 }));
    o.push(p('M-4 820 q 36 -30 68 -34 q -32 16 -36 34 Z', '#618747', { w: 1.9, op: .9 }));
    o.push(p('M420 820 q -26 -52 -58 -64 q 14 34 -2 64 Z', '#6f9752', { w: 2.2, op: .95 }));
    o.push(p('M424 820 q -32 -26 -62 -30 q 30 14 34 30 Z', '#618747', { w: 1.9, op: .9 }));
    o.push('</g>');                                   // 收束笔触层

    /* ---- 动态槽位：各自过一遍笔触滤镜（小物件用轻抖动）；青蛙单独一层，动画只重绘它自己那一小块 ---- */
    o.push('<g id="tf-clovers" filter="url(#sketchFine)"></g>');
    o.push('<g id="tf-snail" filter="url(#sketchFine)"></g>');
    o.push('<g id="tf-frog" filter="url(#sketchFine)"></g>');

    /* ---- 纸：暖色薄罩 + 粗纤维絮状斑（让颜色像"画在纸上"而不是屏幕色块）---- */
    o.push(el('rect', { x: 0, y: 0, width: W, height: H, fill: '#fbf3e0', opacity: .07 }));
    o.push(el('rect', { x: 0, y: 0, width: W, height: H, filter: 'url(#fiber)', fill: '#fff', opacity: .8 }));
    /* ---- 纸纹噪点（最上层，轻微） ---- */
    o.push(el('rect', { x: 0, y: 0, width: W, height: H, filter: 'url(#grain)', opacity: .5, fill: 'none' }));
    o.push('</svg>');
    return o.join('');
  }

  /* ============================================================
   * 12 株三叶草：在土畦里有机散布（不是方格阵）
   * ============================================================ */
  function cloverPlant(i, ripe) {
    var b = bedPoint(i);
    if (!ripe) {
      return '<g class="clover" data-plot="' + i + '" transform="translate(' + b.x + ',' + b.y + ') scale(' + r2(b.s * 0.92) + ')">' +
        p('M0 9 L0 0', 'none', { w: 2.2 }) +
        p('M0 0 q -10 -3 -11 -12 q 10 0 11 12 Z', '#a7d47c', { w: 1.7 }) +
        p('M0 0 q 10 -3 11 -12 q -10 0 -11 12 Z', '#94c96c', { w: 1.7 }) +
        '</g>';
    }
    return '<g class="clover" data-plot="' + i + '" transform="translate(' + b.x + ',' + b.y + ') scale(' + b.s + ')">' +
      p('M0 16 L0 2', 'none', { w: 2.4 }) +
      p('M0 2 q -12 -1 -14 -13 q 12 -2 14 13 Z', C.leaf, { w: 1.8 }) +
      p('M0 2 q 12 -1 14 -13 q -12 -2 -14 13 Z', C.leafD, { w: 1.8 }) +
      p('M0 5 q -3 -11 3 -16 q 9 7 -3 16 Z', '#8fc264', { w: 1.8 }) +
      ell(0, 14, 6, 2.6, C.soilD, { ink: false, op: .35 }) +
      '</g>';
  }
  function cloversSVG(ripeness) {
    var s = '';
    for (var i = 0; i < 12; i++) s += cloverPlant(i, !!ripeness[i]);
    return s;
  }
  /** 12 株的点击热区坐标（UI 层不重复维护坐标） */
  function bedPoints() {
    var a = [];
    for (var i = 0; i < 12; i++) a.push(bedPoint(i));
    return a;
  }

  /* ============================================================
   * 青蛙：勾线 + 水彩平涂，姿态用部件开关表达
   * ============================================================ */
  var FROG = { cx: 312, cy: 349, s: 1.15 };      // 站在室内地板上（脚底 ≈ 386，落在地板梯形里）
  var POSES = {
    lie:   { eyes: 'closed', arms: 'front', legs: 'lie',   prop: 'book' },
    read:  { eyes: 'down',   arms: 'front', legs: 'sit',   prop: 'book' },
    write: { eyes: 'down',   arms: 'front', legs: 'sit',   prop: 'letter' },
    whittle: { eyes: 'down', arms: 'front', legs: 'sit',   prop: 'wood' },
    eat:   { eyes: 'open',   arms: 'front', legs: 'sit',   prop: 'bowl' },
    nap:   { eyes: 'closed', arms: 'down',  legs: 'sit',   prop: 'zzz' },
    idle:  { eyes: 'open',   arms: 'down',  legs: 'stand' },
    walk:  { eyes: 'open',   arms: 'swing', legs: 'walk' },
    /* 明信片里用到的姿态（与家里共用同一套部件开关） */
    sit:   { eyes: 'open',   arms: 'down',  legs: 'sit' },
    look:  { eyes: 'up',     arms: 'down',  legs: 'stand' },
    sleep: { eyes: 'closed', arms: 'down',  legs: 'lie',  prop: 'zzz' },
    swim:  { eyes: 'open',   arms: 'out',   legs: 'none' },
    bath:  { eyes: 'closed', arms: 'out',   legs: 'none', prop: 'steam' },
    climb: { eyes: 'open',   arms: 'up',    legs: 'walk' },
    umbrella: { eyes: 'open', arms: 'up',   legs: 'walk', prop: 'umbrella' }
  };
  /** 画青蛙：**侧面**（脸朝左）+ 头大身小 + 真实青蛙四肢（不拟人）
   *  ------------------------------------------------------------
   *  造型定稿：按「教程卡通」一版（用户选定），核心特征：
   *   · 巨眼：白眼球大、瞳孔几乎撑满，只留一圈白边 + 一点高光
   *   · 横贯全脸的宽嘴弧线；暖黄肚子；没有腮红
   *   · 后腿是最大的肢体：粗大腿在**身后**（+x），带蹼的大脚朝**前**（-x）、趾是圆钝的肉垫
   *   · 前腿短细，末端 2-3 个小趾 —— 没有手，也不摆人手手势
   *   · 远侧的后腿/前腿先画、画深一点、略偏移 —— 侧面才不会是"一条腿的剪影"
   *  姿态仍只用部件开关（eyes / arms / legs / prop），键名不变：内容侧守卫测试按它断言。
   *  opts.night 会把皮肤压深一点（明信片的夜景用）
   */
  function frogSVG(pose, opts) {
    var P = POSES[pose] || POSES.idle;
    var night = !!(opts && opts.night);
    var skin = night ? '#8cba55' : '#aed96e';
    var skinD = night ? '#6f9c42' : '#93bd57';
    var far = night ? '#618a3a' : '#84ac4d';        // 远侧肢体：更深一档
    var belly = '#f6e07a';                          // A 款：暖黄肚子
    var o = [];

    o.push('<g class="frog-body">');

    /* ---------------- 远侧的后腿（先画、更深、略偏移） ---------------- */
    function haunch(sx, opts2) {
      /* sx=1 近侧 / sx=-1 远侧；远侧水平偏移 +7、抬高 4，看起来在身体另一侧 */
      var dx = sx > 0 ? 0 : 7, dy = sx > 0 ? 0 : -4;
      var X = function (v) { return r2(v + dx); };
      var Y = function (v) { return r2(v + dy); };
      var thigh, foot, col = sx > 0 ? skinD : far, colF = sx > 0 ? skin : far, op = sx > 0 ? 1 : .92;
      if (P.legs === 'lie') {                      // 趴着：大腿摊平、脚向后拖
        thigh = 'M' + X(2) + ' ' + Y(6) + ' Q' + X(26) + ' ' + Y(2) + ' ' + X(28) + ' ' + Y(16) +
          ' Q' + X(30) + ' ' + Y(30) + ' ' + X(14) + ' ' + Y(30) + ' Q' + X(-2) + ' ' + Y(30) + ' ' + X(0) + ' ' + Y(18) + ' Z';
        foot = 'M' + X(14) + ' ' + Y(28) + ' Q' + X(26) + ' ' + Y(30) + ' ' + X(34) + ' ' + Y(31) +
          ' Q' + X(39) + ' ' + Y(32) + ' ' + X(38) + ' ' + Y(34) + ' Q' + X(35) + ' ' + Y(36) + ' ' + X(28) + ' ' + Y(35) +
          ' Q' + X(18) + ' ' + Y(34) + ' ' + X(12) + ' ' + Y(31) + ' Z';
      } else if (P.legs === 'walk') {               // 走路：一前一后
        var f = sx > 0 ? 1 : -1;
        thigh = 'M' + X(2) + ' ' + Y(2) + ' Q' + X(26) + ' ' + Y(-4) + ' ' + X(28) + ' ' + Y(13) +
          ' Q' + X(30) + ' ' + Y(28) + ' ' + X(13) + ' ' + Y(29) + ' Q' + X(-1) + ' ' + Y(29) + ' ' + X(0) + ' ' + Y(14) + ' Z';
        foot = 'M' + X(12 - f * 6) + ' ' + Y(27) + ' Q' + X(-6 - f * 12) + ' ' + Y(30) + ' ' + X(-18 - f * 10) + ' ' + Y(31) +
          ' Q' + X(-24 - f * 10) + ' ' + Y(32) + ' ' + X(-23 - f * 10) + ' ' + Y(34) + ' Q' + X(-21 - f * 10) + ' ' + Y(36) +
          ' ' + X(-14 - f * 10) + ' ' + Y(35) + ' Q' + X(0 - f * 6) + ' ' + Y(34) + ' ' + X(11 - f * 6) + ' ' + Y(31) + ' Z';
      } else if (P.legs === 'stand') {              // 站：腿伸开、脚往下落
        thigh = 'M' + X(3) + ' ' + Y(-1) + ' Q' + X(27) + ' ' + Y(-6) + ' ' + X(29) + ' ' + Y(11) +
          ' Q' + X(31) + ' ' + Y(26) + ' ' + X(14) + ' ' + Y(27) + ' Q' + X(0) + ' ' + Y(27) + ' ' + X(1) + ' ' + Y(12) + ' Z';
        foot = 'M' + X(13) + ' ' + Y(25) + ' Q' + X(-1) + ' ' + Y(28) + ' ' + X(-13) + ' ' + Y(29) +
          ' Q' + X(-19) + ' ' + Y(30) + ' ' + X(-18) + ' ' + Y(33) + ' Q' + X(-16) + ' ' + Y(35) + ' ' + X(-9) + ' ' + Y(34) +
          ' Q' + X(5) + ' ' + Y(33) + ' ' + X(15) + ' ' + Y(29) + ' Z';
      } else {                                      // sit：蹲（默认）—— 青蛙最典型的姿势
        thigh = 'M' + X(3) + ' ' + Y(3) + ' Q' + X(27) + ' ' + Y(-3) + ' ' + X(29) + ' ' + Y(14) +
          ' Q' + X(31) + ' ' + Y(29) + ' ' + X(14) + ' ' + Y(30) + ' Q' + X(0) + ' ' + Y(30) + ' ' + X(1) + ' ' + Y(15) + ' Z';
        /* 带蹼的大脚：比基础版更宽、前端更圆（A 款的蹼足） */
        foot = 'M' + X(14) + ' ' + Y(28) + ' Q' + X(-1) + ' ' + Y(31) + ' ' + X(-14) + ' ' + Y(32) +
          ' Q' + X(-22) + ' ' + Y(33) + ' ' + X(-21) + ' ' + Y(35) + ' Q' + X(-18) + ' ' + Y(37) + ' ' + X(-10) + ' ' + Y(36) +
          ' Q' + X(4) + ' ' + Y(35) + ' ' + X(16) + ' ' + Y(31) + ' Z';
      }
      return '<g opacity="' + op + '">' + p(thigh, col, { w: 2 }) + p(foot, colF, { w: 1.9 }) +
        /* 趾：圆钝的肉垫，不是细线 */
        ell(X(-18), Y(34), 4.4, 3.3, colF, { w: 1.4 }) +
        ell(X(-10), Y(35), 4.4, 3.3, colF, { w: 1.4 }) +
        ell(X(-2), Y(34), 4, 3, colF, { w: 1.4 }) + '</g>';
    }
    function foreLeg(sx) {
      /* 前腿：短而细，但是"有粗细的肢体"而不是一根线；末端 2-3 个小趾 */
      var dx = sx > 0 ? 0 : 6, dy = sx > 0 ? 0 : -3;
      var X = function (v) { return r2(v + dx); };
      var Y = function (v) { return r2(v + dy); };
      var col = sx > 0 ? skinD : far, d, tx, ty;
      if (P.arms === 'front') {                    // 向前伸（拿书/信）
        d = 'M' + X(-16) + ' ' + Y(4) + ' q -7 5 -8 12 q 1 3 4 2 q 3 -7 7 -11 Z'; tx = -22; ty = 18;
      } else if (P.arms === 'out') {               // 摊出去
        d = 'M' + X(-16) + ' ' + Y(4) + ' q -10 3 -14 9 q 0 3 3 3 q 6 -5 13 -8 Z'; tx = -29; ty = 15;
      } else if (P.arms === 'up') {                // 举起来（攀爬）
        d = 'M' + X(-16) + ' ' + Y(4) + ' q -8 -5 -7 -13 q 2 -3 4 -1 q 1 7 6 11 Z'; tx = -21; ty = -11;
      } else if (P.arms === 'swing') {             // 走路时前后摆
        d = 'M' + X(-16) + ' ' + Y(4) + ' q ' + r2(-8 - sx * 3) + ' 6 ' + r2(-7 - sx * 5) + ' 12 q 1 3 4 2 q 2 -7 ' + r2(5 - sx * 3) + ' -11 Z';
        tx = -21 - sx * 5; ty = 18;
      } else {                                     // down：自然垂在胸前
        d = 'M' + X(-16) + ' ' + Y(4) + ' q -3 8 -2 13 q 2 2 4 0 q 2 -7 0 -12 Z'; tx = -15; ty = 18;
      }
      return '<g opacity="' + (sx > 0 ? 1 : .92) + '">' + p(d, col, { w: 1.7 }) +
        p('M' + X(tx) + ' ' + Y(ty) + ' l -3 2 M' + X(tx) + ' ' + Y(ty) + ' l -1 3.4 M' + X(tx) + ' ' + Y(ty) + ' l 1.4 3',
          'none', { w: 1.5, op: .85 }) + '</g>';
    }
    /* 先远侧（后腿 → 前腿），再身体，再近侧的腿 */
    if (P.legs !== 'none') o.push(haunch(-1));
    if (P.arms !== 'none') o.push(foreLeg(-1));

    /* ---------------- 身体：比头小，只露后半截 ---------------- */
    o.push(p('M-14 -4 Q8 -13 20 2 Q27 14 14 24 Q-6 29 -17 14 Q-21 2 -14 -4 Z', skin, { w: 2.2 }));
    o.push(ell(-2, 12, 12.5, 8, belly, { ink: false, op: .95 }));

    /* ---------------- 头：比身子大得多、压在身上；吻部朝左 ---------------- */
    o.push(p('M-38 -15 Q-35 -40 -12 -42 Q17 -44 20 -19 Q22 -2 2 -2 Q-32 -2 -38 -15 Z', skin, { w: 2.5 }));
    /* 头顶斑点 */
    o.push(ell(-2, -32, 7, 3.6, skinD, { ink: false, op: .4 }));
    o.push(ell(10, -26, 4.6, 2.8, skinD, { ink: false, op: .35 }));

    /* ---------------- 巨眼：鼓在头顶；白眼球大、瞳孔几乎撑满 ---------------- */
    o.push(ell(-20, -35, 13.2, 13.2, skin, { w: 2.3 }));
    if (P.eyes === 'closed') {
      /* 闭眼：不画白眼球，只在鼓包上画一道弧 */
      o.push(p('M-30 -36 q 10 11 20 0', 'none', { w: 2.8 }));
    } else {
      o.push(ell(-20, -35, 11, 11.6, '#fffdf9', { w: 1.4 }));
      (function () {
        var dy = P.eyes === 'down' ? 3.5 : (P.eyes === 'up' ? -3.5 : 0);
        o.push('<ellipse cx="-22" cy="' + r2(-34 + dy) + '" rx="8.2" ry="9" fill="#2f2a24"/>' +
          '<circle cx="-25" cy="' + r2(-38 + dy) + '" r="2.6" fill="#fff"/>');
      })();
    }

    /* ---------------- 嘴：横贯全脸的宽弧线；鼻点在吻尖（A 款无腮红） ---------------- */
    if ((pose === 'nap' || pose === 'sleep' || pose === 'lie') && P.eyes === 'closed') {
      o.push(p('M-35 -12 q 8 5 16 -1', 'none', { w: 2.3 }));
    } else {
      o.push(p('M-39 -10 Q-17 3 4 -9', 'none', { w: 2.6 }));
      o.push(p('M-31 -5 q 6 4 12 2', 'none', { w: 1.5, op: .45 }));
    }
    o.push('<circle cx="-29" cy="-22" r="1.6" fill="' + INK + '"/>');

    /* ---------------- 近侧前腿 ---------------- */
    if (P.arms !== 'none') o.push(foreLeg(1));

    /* ---------------- 近侧后腿：最大的肢体，压在身体后半 ---------------- */
    if (P.legs !== 'none') o.push(haunch(1));

    /* ---------------- 道具（跟着侧面重新落位：都放在吻部/前腿前方） ---------------- */
    if (P.prop === 'book') {
      o.push(p('M-42 20 L-22 13 L-2 20 L-22 27 Z', C.paper, { w: 1.6 }));
      o.push(p('M-42 20 L-42 14 L-22 7 L-22 13 Z', '#fdfaf0', { w: 1.6 }));
      o.push(p('M-2 20 L-2 14 L-22 7 L-22 13 Z', C.paper, { w: 1.6 }));
      o.push(p('M-38 21 L-22 15 L-22 24 Z', C.paperD, { w: 1.2 }));
    } else if (P.prop === 'letter') {
      o.push(p('M-44 16 L-16 16 L-16 30 L-44 30 Z', C.paper, { w: 1.6 }));
      o.push(p('M-44 17 L-30 25 L-16 17', 'none', { w: 1.4 }));
    } else if (P.prop === 'wood') {
      o.push(p('M-42 22 L-18 22 L-18 29 L-42 29 Z', C.trunkL, { w: 1.5 }));
      o.push(ell(-42, 25.5, 3.2, 3.6, C.trunkD, { w: 1.3 }));
      o.push(p('M-26 16 L-15 24', 'none', { w: 2.6 }));
    } else if (P.prop === 'bowl') {
      o.push(p('M-44 22 q 15 15 30 0 Z', C.wood, { w: 1.7 }));
      o.push(ell(-29, 22, 15, 4.6, C.woodD, { w: 1.4 }));
      o.push(ell(-29, 21, 10, 3, '#fffdf4', { ink: false }));
      o.push(p('M-37 17 q 3 -4 0 -7 M-21 17 q -3 -4 0 -7', 'none', { op: .4, w: 1.3 }));
    } else if (P.prop === 'zzz') {
      o.push('<text class="zzz" x="-2" y="-46" font-size="13" fill="#8fa8c0" font-family="sans-serif">z</text>' +
        '<text class="zzz z2" x="8" y="-56" font-size="10" fill="#a8bcd0" font-family="sans-serif">z</text>');
    } else if (P.prop === 'steam') {
      o.push(p('M-24 -44 q 5 -9 0 -16 M-6 -46 q -5 -9 0 -16', 'none', { op: .45, w: 1.9 }));
    } else if (P.prop === 'umbrella') {
      o.push(p('M-46 -50 q 36 -30 72 0 q -18 -12 -36 0 q -18 -12 -36 0 Z', C.red, { w: 2 }));
      o.push(p('M-10 -51 L-10 -21', 'none', { w: 2 }));
      o.push(p('M-10 -21 q 0 7 7 7', 'none', { w: 1.8 }));
    }
    o.push('</g>');
    return o.join('');
  }

  /** 把青蛙放到场景坐标里（出门时返回空串） */
  function frogSlot(pose, away) {
    if (away) return '';
    return '<g transform="translate(' + FROG.cx + ',' + FROG.cy + ') scale(' + FROG.s + ')">' +
      frogSVG(pose) + '</g>';
  }
  /** 出门时在门口挂一封「信」，代替原作的信封提示 */
  function awaySlot() {
    return '<g transform="translate(388,300) scale(.85)">' +
      p('M-18 -12 L18 -12 L18 12 L-18 12 Z', C.paper, { w: 1.8 }) +
      p('M-18 -11 L0 3 L18 -11', 'none', { w: 1.5 }) +
      ell(16, -14, 7, 7, C.flame, { w: 1.4 }) +
      '</g>';
  }

  /* ============================================================
   * 蜗牛访客
   * ============================================================ */
  var SNAIL = { x: 338, y: 648 };   // 坐在树桩桌旁的草地上
  function snailPoint() { return { x: SNAIL.x, y: SNAIL.y }; }
  function snailSlot(show) {
    if (!show) return '';
    return '<g class="snail" transform="translate(' + SNAIL.x + ',' + SNAIL.y + ')">' +
      p('M-16 6 q 16 8 34 0 q 4 -4 -2 -5 q -16 -3 -32 0 q -4 2 0 5 Z', '#f0e6ca', { w: 1.9 }) +
      p('M2 -18 q 16 -2 18 12 q 2 14 -12 16 q -14 2 -16 -12 q -2 -14 10 -16 Z', C.trunkL, { w: 2 }) +
      p('M4 -12 q 10 -1 11 8 q 1 9 -8 10 q -9 1 -10 -8 q -1 -9 7 -10 Z', 'none', { w: 1.4, op: .7 }) +
      '<circle cx="2" cy="-10" r="2.2" fill="#2f2a24"/>' +
      p('M-8 -4 q -3 -10 -8 -12', 'none', { w: 1.6 }) +
      '<circle cx="-16" cy="-17" r="2.4" fill="#2f2a24"/>' +
      '</g>';
  }

  /* ============================================================
   * 青蛙角度变体：45°（四分之三侧）与 30°（接近正面）
   * ------------------------------------------------------------
   * 都是 A 造型（巨眼满瞳 + 宽嘴 + 蹼足圆趾 + 暖黄肚），只改"朝向"：
   *   · 45°：吻部没那么突、右颊圆过来；两只眼都露——近眼大低、远眼小高（3/4 的特征）；
   *          身体略宽（露出更多正面）；两条后腿都在，远侧压深、略偏里。
   *   · 30°：脸几乎正对观众；双眼接近对称；嘴变成横贯脸下部的 U；两个鼻孔；
   *          两个大腿分列两侧、蹼足朝前下；身体更宽、肚子居中。
   * 姿态开关（eyes/arms/legs/prop）与键名不变。当前默认款仍是 0°（纯侧视）。
   * ============================================================ */
  function frog45(pose, opts) {
    var P = POSES[pose] || POSES.idle, night = !!(opts && opts.night);
    var skin = night ? '#8cba55' : '#aed96e', skinD = night ? '#6f9c42' : '#93bd57', far = night ? '#618a3a' : '#84ac4d';
    var o = ['<g class="frog-body">'];
    /* 3/4 的腿：大腿分列身体左右两侧，两只蹼足都朝前（左）伸到身下前方；远侧压深、略偏里 */
    function thigh(sx) {
      var dx = sx > 0 ? 0 : -4, dy = sx > 0 ? 0 : -2;
      var X = function (v) { return r2(v + dx); }, Y = function (v) { return r2(v + dy); };
      var col = sx > 0 ? skinD : far;
      var d = 'M' + X(8) + ' ' + Y(10) + ' Q' + X(30) + ' ' + Y(4) + ' ' + X(30) + ' ' + Y(18) +
        ' Q' + X(30) + ' ' + Y(30) + ' ' + X(12) + ' ' + Y(30) + ' Q' + X(2) + ' ' + Y(30) + ' ' + X(6) + ' ' + Y(18) + ' Z';
      return '<g opacity="' + (sx > 0 ? 1 : .92) + '">' + p(d, col, { w: 2 }) + '</g>';
    }
    function foot(sx) {
      var dx = sx > 0 ? 0 : 3, dy = sx > 0 ? 0 : -3;
      var X = function (v) { return r2(v + dx); }, Y = function (v) { return r2(v + dy); };
      var colF = sx > 0 ? skin : far;
      var d = 'M' + X(6) + ' ' + Y(27) + ' Q' + X(-12) + ' ' + Y(31) + ' ' + X(-24) + ' ' + Y(32) +
        ' Q' + X(-31) + ' ' + Y(33) + ' ' + X(-30) + ' ' + Y(35) + ' Q' + X(-27) + ' ' + Y(37) + ' ' + X(-18) + ' ' + Y(36) +
        ' Q' + X(-4) + ' ' + Y(35) + ' ' + X(8) + ' ' + Y(30) + ' Z';
      return '<g opacity="' + (sx > 0 ? 1 : .92) + '">' + p(d, colF, { w: 1.9 }) +
        ell(X(-28), Y(34), 4.4, 3.3, colF, { w: 1.4 }) + ell(X(-20), Y(35), 4.4, 3.3, colF, { w: 1.4 }) +
        ell(X(-12), Y(34), 4, 3, colF, { w: 1.4 }) + '</g>';
    }
    function fore(sx) {
      var dx = sx > 0 ? 0 : 5, dy = sx > 0 ? 0 : -2;
      var X = function (v) { return r2(v + dx); }, Y = function (v) { return r2(v + dy); };
      var col = sx > 0 ? skinD : far, d, tx, ty;
      if (P.arms === 'front') { d = 'M' + X(-15) + ' ' + Y(5) + ' q -7 5 -8 12 q 1 3 4 2 q 3 -7 7 -11 Z'; tx = -21; ty = 19; }
      else if (P.arms === 'out') { d = 'M' + X(-15) + ' ' + Y(5) + ' q -10 3 -14 9 q 0 3 3 3 q 6 -5 13 -8 Z'; tx = -28; ty = 16; }
      else if (P.arms === 'up') { d = 'M' + X(-15) + ' ' + Y(5) + ' q -8 -5 -7 -13 q 2 -3 4 -1 q 1 7 6 11 Z'; tx = -20; ty = -10; }
      else { d = 'M' + X(-15) + ' ' + Y(5) + ' q -3 8 -2 13 q 2 2 4 0 q 2 -7 0 -12 Z'; tx = -14; ty = 19; }
      return '<g opacity="' + (sx > 0 ? 1 : .9) + '">' + p(d, col, { w: 1.8 }) +
        p('M' + X(tx) + ' ' + Y(ty) + ' l -3 2 M' + X(tx) + ' ' + Y(ty) + ' l -1 3.4 M' + X(tx) + ' ' + Y(ty) + ' l 1.4 3',
          'none', { w: 1.4, op: .8 }) + '</g>';
    }
    if (P.legs !== 'none') { o.push(thigh(-1)); o.push(foot(-1)); }
    /* 身体：宽墩（比侧视短一截），肚皮居中 —— 和头同一个 3/4 朝向 */
    o.push(p('M-24 2 Q0 -14 25 4 Q31 17 14 28 Q-11 31 -24 15 Q-28 5 -24 2 Z', skin, { w: 2.2 }));
    o.push(ell(1, 14, 16, 9, '#f6e07a', { ink: false, op: .95 }));
    /* 头：3/4 —— 吻部比侧视短（前缘从 -33 收到 -30），右颊圆过来 */
    o.push(p('M-30 -12 Q-27 -40 -7 -42 Q16 -43 22 -20 Q24 -2 2 -2 Q-26 -2 -30 -12 Z', skin, { w: 2.5 }));
    o.push(ell(-3, -33, 6.5, 3.4, skinD, { ink: false, op: .4 }));
    /* 眼睛：两只都露且都要顶出头壳轮廓 —— 近眼大低，远眼小高（远眼骑在头壳右上，只露上半） */
    o.push(ell(12, -37.5, 9, 9, skin, { w: 2 }));
    o.push(ell(-19, -35.5, 13.5, 13.5, skin, { w: 2.3 }));
    if (P.eyes === 'closed') {
      o.push(p('M2 -38 q 10 9 20 0', 'none', { w: 2.2 }));
      o.push(p('M-29 -36 q 10 11 20 0', 'none', { w: 2.8 }));
    } else {
      o.push(ell(12, -37.5, 7.2, 7.6, '#fffdf9', { w: 1.3 }));
      o.push(ell(-19, -35.5, 11.2, 11.9, '#fffdf9', { w: 1.4 }));
      (function () {
        var dy = P.eyes === 'down' ? 3.5 : (P.eyes === 'up' ? -3.5 : 0);
        o.push('<ellipse cx="-21" cy="' + r2(-34.5 + dy) + '" rx="8.2" ry="9" fill="#2f2a24"/>' +
          '<circle cx="-24" cy="' + r2(-38.5 + dy) + '" r="2.6" fill="#fff"/>');
        o.push('<ellipse cx="10" cy="' + r2(-36.5 + dy) + '" rx="5.3" ry="5.9" fill="#2f2a24"/>' +
          '<circle cx="8" cy="' + r2(-40 + dy) + '" r="1.7" fill="#fff"/>');
      })();
    }
    /* 嘴：横在吻部前方、比侧视短（-30..-4，前端收短） */
    if ((pose === 'nap' || pose === 'sleep' || pose === 'lie') && P.eyes === 'closed') o.push(p('M-28 -11 q 8 5 16 -1', 'none', { w: 2.3 }));
    else o.push(p('M-30 -8 Q-16 1 -4 -8', 'none', { w: 2.6 }));
    o.push('<circle cx="-24" cy="-20" r="1.6" fill="' + INK + '"/>');
    if (P.arms !== 'none') { o.push(fore(-1)); o.push(fore(1)); }
    if (P.legs !== 'none') { o.push(thigh(1)); o.push(foot(1)); }
    o.push(frogProp(P, pose));
    o.push('</g>');
    return o.join('');
  }

  function frog30(pose, opts) {
    var P = POSES[pose] || POSES.idle, night = !!(opts && opts.night);
    var skin = night ? '#8cba55' : '#aed96e', skinD = night ? '#6f9c42' : '#93bd57', far = night ? '#618a3a' : '#84ac4d';
    var o = ['<g class="frog-body">'];
    /* 近正面的腿：大腿分列左右两侧，两只蹼足朝前伸到身下；远侧压深、略偏里 */
    function thigh(sx) {
      var dx = sx > 0 ? 0 : -3, dy = sx > 0 ? 0 : -2;
      var X = function (v) { return r2(v + dx); }, Y = function (v) { return r2(v + dy); };
      var col = sx > 0 ? skinD : far;
      var d = 'M' + X(8) + ' ' + Y(10) + ' Q' + X(30) + ' ' + Y(3) + ' ' + X(30) + ' ' + Y(17) +
        ' Q' + X(30) + ' ' + Y(30) + ' ' + X(12) + ' ' + Y(30) + ' Q' + X(2) + ' ' + Y(30) + ' ' + X(6) + ' ' + Y(18) + ' Z';
      return '<g opacity="' + (sx > 0 ? 1 : .92) + '">' + p(d, col, { w: 2 }) + '</g>';
    }
    function foot(sx) {
      var dx = sx > 0 ? 0 : 2, dy = sx > 0 ? 0 : -2;
      var X = function (v) { return r2(v + dx); }, Y = function (v) { return r2(v + dy); };
      var colF = sx > 0 ? skin : far;
      var d = 'M' + X(5) + ' ' + Y(27) + ' Q' + X(-13) + ' ' + Y(31) + ' ' + X(-22) + ' ' + Y(32) +
        ' Q' + X(-28) + ' ' + Y(33) + ' ' + X(-27) + ' ' + Y(35) + ' Q' + X(-24) + ' ' + Y(37) + ' ' + X(-16) + ' ' + Y(36) +
        ' Q' + X(-3) + ' ' + Y(35) + ' ' + X(7) + ' ' + Y(30) + ' Z';
      return '<g opacity="' + (sx > 0 ? 1 : .92) + '">' + p(d, colF, { w: 1.9 }) +
        ell(X(-25), Y(34), 4.2, 3.2, colF, { w: 1.4 }) + ell(X(-17), Y(35), 4.2, 3.2, colF, { w: 1.4 }) +
        ell(X(-9), Y(34), 3.8, 3, colF, { w: 1.4 }) + '</g>';
    }
    function fore(sx) {
      var dx = sx > 0 ? 0 : 4, dy = sx > 0 ? 0 : -1;
      var X = function (v) { return r2(v + dx); }, Y = function (v) { return r2(v + dy); };
      var col = sx > 0 ? skinD : far, d, tx, ty;
      if (P.arms === 'front') { d = 'M' + X(-14) + ' ' + Y(5) + ' q -6 5 -7 11 q 1 3 4 2 q 3 -6 6 -10 Z'; tx = -20; ty = 18; }
      else if (P.arms === 'out') { d = 'M' + X(-14) + ' ' + Y(5) + ' q -9 3 -13 8 q 0 3 3 3 q 6 -4 12 -7 Z'; tx = -26; ty = 15; }
      else if (P.arms === 'up') { d = 'M' + X(-14) + ' ' + Y(5) + ' q -7 -5 -6 -12 q 2 -3 4 -1 q 1 6 5 10 Z'; tx = -18; ty = -9; }
      else { d = 'M' + X(-14) + ' ' + Y(5) + ' q -3 7 -2 12 q 2 2 4 0 q 2 -6 0 -11 Z'; tx = -13; ty = 18; }
      return '<g opacity="' + (sx > 0 ? 1 : .9) + '">' + p(d, col, { w: 1.8 }) +
        p('M' + X(tx) + ' ' + Y(ty) + ' l -3 2 M' + X(tx) + ' ' + Y(18) + ' l -1 3.4 M' + X(tx) + ' ' + Y(ty) + ' l 1.4 3',
          'none', { w: 1.4, op: .8 }) + '</g>';
    }
    if (P.legs !== 'none') { o.push(thigh(-1)); o.push(foot(-1)); }
    /* 身体：更宽、居中 */
    o.push(p('M-24 2 Q0 -14 24 4 Q30 17 13 28 Q-12 30 -24 15 Q-28 5 -24 2 Z', skin, { w: 2.2 }));
    o.push(ell(0, 14, 16, 9, '#f6e07a', { ink: false, op: .95 }));
    /* 头：接近正脸 —— 圆顶两边对称，只有一点点左吻部 */
    o.push(p('M-31 -12 Q-30 -42 -4 -44 Q24 -43 26 -19 Q27 -2 2 -2 Q-27 -2 -31 -12 Z', skin, { w: 2.5 }));
    o.push(ell(-1, -33, 8, 3.8, skinD, { ink: false, op: .4 }));
    /* 双眼几乎对称：近眼略大略低 */
    o.push(ell(12, -35, 12, 12, skin, { w: 2.3 }));
    o.push(ell(-12, -36, 12.6, 12.6, skin, { w: 2.3 }));
    if (P.eyes === 'closed') {
      o.push(p('M-21 -37 q 9 10 18 0', 'none', { w: 2.7 }));
      o.push(p('M3 -36 q 9 10 18 0', 'none', { w: 2.7 }));
    } else {
      o.push(ell(12, -35, 10, 10.6, '#fffdf9', { w: 1.4 }));
      o.push(ell(-12, -36, 10.6, 11.2, '#fffdf9', { w: 1.4 }));
      (function () {
        var dy = P.eyes === 'down' ? 3.4 : (P.eyes === 'up' ? -3.4 : 0);
        o.push('<ellipse cx="-14" cy="' + r2(-35 + dy) + '" rx="7.8" ry="8.6" fill="#2f2a24"/>' +
          '<circle cx="-17" cy="' + r2(-39 + dy) + '" r="2.5" fill="#fff"/>');
        o.push('<ellipse cx="10" cy="' + r2(-34 + dy) + '" rx="7.2" ry="8" fill="#2f2a24"/>' +
          '<circle cx="7" cy="' + r2(-38 + dy) + '" r="2.3" fill="#fff"/>');
      })();
    }
    /* 嘴：横贯脸下部的 U + 两个鼻孔 */
    if ((pose === 'nap' || pose === 'sleep' || pose === 'lie') && P.eyes === 'closed') o.push(p('M-10 -10 q 10 7 20 0', 'none', { w: 2.4 }));
    else o.push(p('M-24 -9 Q0 7 24 -9', 'none', { w: 2.6 }));
    o.push('<circle cx="-8" cy="-20" r="1.5" fill="' + INK + '"/><circle cx="6" cy="-20" r="1.5" fill="' + INK + '"/>');
    if (P.arms !== 'none') { o.push(fore(-1)); o.push(fore(1)); }
    if (P.legs !== 'none') { o.push(thigh(1)); o.push(foot(1)); }
    o.push(frogProp(P, pose));
    o.push('</g>');
    return o.join('');
  }

  /** 道具：三个角度共用同一份（都摆在吻部/前腿前方） */
  function frogProp(P, pose) {
    var o = [];
    if (P.prop === 'book') {
      o.push(p('M-42 20 L-22 13 L-2 20 L-22 27 Z', C.paper, { w: 1.6 }));
      o.push(p('M-42 20 L-42 14 L-22 7 L-22 13 Z', '#fdfaf0', { w: 1.6 }));
      o.push(p('M-2 20 L-2 14 L-22 7 L-22 13 Z', C.paper, { w: 1.6 }));
      o.push(p('M-38 21 L-22 15 L-22 24 Z', C.paperD, { w: 1.2 }));
    } else if (P.prop === 'letter') {
      o.push(p('M-44 16 L-16 16 L-16 30 L-44 30 Z', C.paper, { w: 1.6 }));
      o.push(p('M-44 17 L-30 25 L-16 17', 'none', { w: 1.4 }));
    } else if (P.prop === 'wood') {
      o.push(p('M-42 22 L-18 22 L-18 29 L-42 29 Z', C.trunkL, { w: 1.5 }));
      o.push(ell(-42, 25.5, 3.2, 3.6, C.trunkD, { w: 1.3 }));
    } else if (P.prop === 'bowl') {
      o.push(p('M-44 22 q 15 15 30 0 Z', C.wood, { w: 1.7 }));
      o.push(ell(-29, 22, 15, 4.6, C.woodD, { w: 1.4 }));
      o.push(ell(-29, 21, 10, 3, '#fffdf4', { ink: false }));
    } else if (P.prop === 'zzz') {
      o.push('<text class="zzz" x="0" y="-50" font-size="13" fill="#8fa8c0" font-family="sans-serif">z</text>' +
        '<text class="zzz z2" x="10" y="-60" font-size="10" fill="#a8bcd0" font-family="sans-serif">z</text>');
    } else if (P.prop === 'steam') {
      o.push(p('M-24 -46 q 5 -9 0 -16 M-6 -48 q -5 -9 0 -16', 'none', { op: .45, w: 1.9 }));
    } else if (P.prop === 'umbrella') {
      o.push(p('M-44 -54 q 36 -30 72 0 q -18 -12 -36 0 q -18 -12 -36 0 Z', C.red, { w: 2 }));
      o.push(p('M-8 -55 L-8 -25', 'none', { w: 2 }));
      o.push(p('M-8 -25 q 0 7 7 7', 'none', { w: 1.8 }));
    }
    return o.join('');
  }
  /** 角度分发：opts.style = '45' | '30'，不给就是默认款 0° */
  function frogStyled(pose, opts) {
    var st = opts && opts.style;
    if (st === '45') return frog45(pose, opts);
    if (st === '30') return frog30(pose, opts);
    return frogSVG(pose, opts);
  }

  return {
    W: W, H: H, INK: INK, C: C,
    sceneSVG: sceneSVG,
    cloversSVG: cloversSVG,
    cloverPlant: cloverPlant,
    bedPoints: bedPoints,
    snailPoint: snailPoint,
    frogSVG: frogSVG,
    frogFigure: frogStyled,       // 明信片也用它；opts.style='45'|'30' 看角度（默认 0° 侧视）
    frogSlot: frogSlot,
    awaySlot: awaySlot,
    snailSlot: snailSlot,
    POSES: POSES
  };
});
