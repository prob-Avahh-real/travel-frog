/* ============================================================
 * 旅行青蛙 · 美术 (js/art.js)
 * ------------------------------------------------------------
 * 单一职责：把数据表渲染成 SVG 字符串。纯函数、零副作用、零 DOM，
 * 所以在 Node 里也能直接断言（见 test/ 的 art 用例）。
 * 出口：
 *   sceneSVG(kind, time, seed)   明信片风景
 *   itemIcon(kind, id, size)     便当 / 道具 / 特产 图标
 *   bundleSVG(kind, id, px)      商店货格上的布包
 * 青蛙只有一个渲染器（js/scene.js 的 frogFigure），明信片直接借用。
 * 新增一种风景：在 FEATURES 里加一个 key 的函数即可，主流程不动。
 * ============================================================ */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else { root.TF = root.TF || {}; root.TF.Art = mod; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------- 确定性随机：同一张明信片永远长一样 ---------- */
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
  function r2(x) { return Math.round(x * 100) / 100; }

  /* ---------- 调色板 ---------- */
  /* 夜里不能压太黑：远景山体会糊成一团黑块，看不出是什么地方。
     用「月照夜」的蓝灰调，保留星空与雪点的对比度。 */
  var PAL = {
    dawn:  { sky: ['#ffe0b0', '#ffc79a', '#a9c9e6', '#e6eff7'], sun: '#fff0c0', sunOp: .95, ground: '#9fb98a', dark: '#6d7f5e', tint: 'rgba(255,190,140,.12)', star: 0, warm: '#ffd9a8' },
    day:   { sky: ['#8ed0f2', '#b7e4f8', '#dcf1fb', '#eef8fd'], sun: '#fffbe0', sunOp: .95, ground: '#8fb573', dark: '#5f7f4a', tint: 'rgba(255,255,255,0)', star: 0, warm: '#ffffff' },
    dusk:  { sky: ['#ffb27a', '#ff9268', '#8a6f9e', '#4c3f6b'], sun: '#ff9a5c', sunOp: 1, ground: '#7a7a63', dark: '#4e4a45', tint: 'rgba(120,70,110,.20)', star: 8, warm: '#ffc79a' },
    night: { sky: ['#1c2c4e', '#2a3f66', '#3d5380', '#4d638f'], sun: '#f6f3dc', sunOp: 1, ground: '#55617b', dark: '#3a4763', tint: 'rgba(28,44,86,.20)', star: 34, warm: '#d6dff2' }
  };
  function pal(t) { return PAL[t] || PAL.day; }

  /* ---------- 天空 + 远景（所有场景共用） ---------- */
  function skyLayer(time, r, o) {
    var p = pal(time);
    o.push('<rect width="320" height="220" fill="url(#sky)"/>');
    if (p.star) {
      for (var i = 0; i < p.star; i++) {
        var x = r2(r() * 316), y = r2(r() * 120), rad = r2(0.6 + r() * 1.3);
        o.push('<circle cx="' + x + '" cy="' + y + '" r="' + rad + '" fill="#fff" opacity="' + r2(.35 + r() * .6) + '"/>');
      }
    }
    // 日 / 月
    if (time === 'night') {
      o.push('<circle cx="248" cy="52" r="17" fill="' + p.sun + '" opacity="' + p.sunOp + '"/>');
      o.push('<circle cx="241" cy="46" r="15" fill="url(#sky)" opacity=".92"/>');
    } else {
      o.push('<circle cx="' + (time === 'dusk' ? 236 : 252) + '" cy="' + (time === 'dawn' ? 74 : 48) + '" r="19" fill="' + p.sun + '" opacity="' + p.sunOp + '"/>');
      o.push('<circle cx="' + (time === 'dusk' ? 236 : 252) + '" cy="' + (time === 'dawn' ? 74 : 48) + '" r="30" fill="' + p.sun + '" opacity=".18"/>');
    }
    // 云
    for (var c = 0; c < 3; c++) {
      var cx = r2(30 + r() * 240), cy = r2(28 + r() * 46), s = r2(.7 + r() * .7);
      o.push('<g opacity="' + r2(time === 'night' ? .12 : .55) + '" fill="' + p.warm + '" transform="translate(' + cx + ',' + cy + ') scale(' + s + ')">' +
        '<ellipse rx="26" ry="9"/><ellipse cx="16" ry="11"/><ellipse cx="-18" cy="2" rx="20" ry="8"/></g>');
    }
  }
  /* 远山 */
  function hills(time, r, o, color) {
    var p = pal(time);
    var c1 = color || p.dark, c2 = p.ground;
    for (var i = 0; i < 4; i++) {
      var bx = -40 + i * 100 + r() * 30, h = 46 + r() * 44, w = 90 + r() * 60;
      o.push('<path d="M' + r2(bx) + ' 172 L' + r2(bx + w / 2) + ' ' + r2(172 - h) + ' L' + r2(bx + w) + ' 172 Z" fill="' + (i % 2 ? c1 : c2) + '" opacity=".55"/>');
    }
  }
  /* 地面 */
  function ground(time, o, color) {
    var p = pal(time);
    o.push('<rect x="0" y="172" width="320" height="48" fill="' + (color || p.ground) + '"/>');
    o.push('<rect x="0" y="172" width="320" height="5" fill="' + p.dark + '" opacity=".35"/>');
  }
  /* 水面 */
  function water(time, r, o, y, h, color) {
    var p = pal(time);
    o.push('<rect x="0" y="' + y + '" width="320" height="' + h + '" fill="' + (color || '#5fa8c9') + '" opacity="' + (time === 'night' ? .72 : .9) + '"/>');
    for (var i = 0; i < 9; i++) {
      var wy = y + 8 + r() * (h - 12), wx = 8 + r() * 280, ww = 14 + r() * 34;
      o.push('<path d="M' + r2(wx) + ' ' + r2(wy) + ' q ' + r2(ww / 2) + ' 5 ' + r2(ww) + ' 0" stroke="' + p.warm + '" stroke-width="1.6" fill="none" opacity="' + r2(.25 + r() * .3) + '"/>');
    }
  }
  /* 树（针叶） */
  function pine(x, y, s, color, o) {
    o.push('<g transform="translate(' + r2(x) + ',' + r2(y) + ') scale(' + r2(s) + ')">' +
      '<rect x="-2" y="-6" width="4" height="10" fill="#7a5a3a"/>' +
      '<path d="M0 -46 L15 -18 L-15 -18 Z" fill="' + color + '"/>' +
      '<path d="M0 -34 L18 -4 L-18 -4 Z" fill="' + color + '"/></g>');
  }
  /* 阔叶树 */
  function broad(x, y, s, color, o) {
    o.push('<g transform="translate(' + r2(x) + ',' + r2(y) + ') scale(' + r2(s) + ')">' +
      '<rect x="-2.5" y="-12" width="5" height="16" fill="#7a5a3a"/>' +
      '<circle cx="0" cy="-24" r="15" fill="' + color + '"/>' +
      '<circle cx="-11" cy="-16" r="10" fill="' + color + '"/>' +
      '<circle cx="11" cy="-16" r="10" fill="' + color + '"/></g>');
  }
  /* 椰子树：弯曲树干 + 五片下垂的羽叶（早年画成直杆 + 几片叶子，看起来像栅栏） */
  function palm(x, y, s, o) {
    var top = 'q -9 -30 -4 -56';
    o.push('<g transform="translate(' + r2(x) + ',' + r2(y) + ') scale(' + r2(s) + ')">' +
      '<path d="M0 0 ' + top + '" stroke="#a97f52" stroke-width="5.5" fill="none" stroke-linecap="round"/>' +
      '<path d="M0 0 ' + top + '" stroke="#c69a68" stroke-width="2" fill="none" stroke-linecap="round" opacity=".8"/>' +
      '<g transform="translate(-4,-56)">' +
      '<path d="M0 0 q -26 -16 -40 -2 q 20 10 40 2 Z" fill="#3f8f5a"/>' +
      '<path d="M0 0 q 26 -18 42 -4 q -22 12 -42 4 Z" fill="#4aa066"/>' +
      '<path d="M0 0 q -10 -26 8 -38 q 10 20 -8 38 Z" fill="#357f50"/>' +
      '<path d="M0 0 q -30 6 -34 24 q 24 -4 34 -24 Z" fill="#57b073"/>' +
      '<path d="M0 0 q 30 8 34 26 q -26 -6 -34 -26 Z" fill="#2f7048"/>' +
      '<circle cx="-7" cy="4" r="3.2" fill="#c98a4a"/><circle cx="6" cy="6" r="3.2" fill="#c98a4a"/>' +
      '</g></g>');
  }

  /* ============================================================
   * 风景：每个 key 一个构建函数。新增地点 = 加一个 key。
   * ============================================================ */
  var FEATURES = {
    forest: function (t, r, o) {
      hills(t, r, o, '#4f6f45');
      for (var i = 0; i < 7; i++) pine(22 + i * 45 + r() * 16, 176 + r() * 8, .8 + r() * .5, i % 2 ? '#3f6b3a' : '#4d7c42', o);
      ground(t, o, '#7fa061');
      for (i = 0; i < 5; i++) broad(30 + i * 62 + r() * 20, 200, .5 + r() * .25, '#67a04c', o);
    },
    river: function (t, r, o) {
      hills(t, r, o, '#5d7a52');
      ground(t, o, '#8aa86b');
      var d = 'M0 178 C 60 168, 100 200, 160 196 C 220 192, 260 176, 320 186 L320 220 L0 220 Z';
      o.push('<path d="' + d + '" fill="#63aecb"/>');
      for (var i = 0; i < 7; i++) o.push('<path d="M' + r2(20 + i * 42) + ' ' + r2(186 + r() * 22) + ' q 10 4 20 0" stroke="#dff3fb" stroke-width="1.4" fill="none" opacity=".5"/>');
      for (i = 0; i < 6; i++) pine(18 + i * 54 + r() * 14, 180, .55 + r() * .35, '#456f3d', o);
      for (i = 0; i < 8; i++) {
        var rx = r() * 300, ry = 196 + r() * 18;
        o.push('<path d="M' + r2(rx) + ' ' + r2(ry) + ' q 3 -14 8 -20" stroke="#6f9a4e" stroke-width="2" fill="none"/>');
      }
    },
    field: function (t, r, o) {
      hills(t, r, o, '#7f9b57');
      ground(t, o, '#c9c063');
      for (var i = 0; i < 26; i++) {
        var x = 6 + i * 12 + r() * 5, h = 12 + r() * 12;
        o.push('<path d="M' + r2(x) + ' ' + r2(182 + r() * 26) + ' q 2 -' + r2(h) + ' 5 -' + r2(h) + '" stroke="#a8a03e" stroke-width="1.8" fill="none" opacity=".85"/>');
      }
      for (i = 0; i < 4; i++) broad(30 + i * 78 + r() * 20, 186, .5 + r() * .3, '#5f8f45', o);
    },
    beach: function (t, r, o) {
      water(t, r, o, 150, 34, '#3f9fc4');
      ground(t, o, '#efdcae');
      o.push('<path d="M0 150 C 60 144, 120 156, 180 150 C 240 144, 280 152, 320 148 L320 158 L0 158 Z" fill="#8fd6e8" opacity=".7"/>');
      for (var i = 0; i < 4; i++) {
        var bx = 40 + i * 74 + r() * 20;
        o.push('<ellipse cx="' + r2(bx) + '" cy="' + r2(190 + r() * 16) + '" rx="' + r2(6 + r() * 8) + '" ry="3" fill="#d8c184" opacity=".8"/>');
      }
      for (i = 0; i < 3; i++) o.push('<path d="M' + r2(60 + i * 80 + r() * 30) + ' ' + r2(40 + r() * 26) + ' q 6 -6 12 0 q 6 -6 12 0" stroke="#fff" stroke-width="1.6" fill="none" opacity=".75"/>');
      o.push('<g transform="translate(46,168) scale(.7)"><path d="M0 0 q 6 -26 8 -30 q 2 4 8 30 Z" fill="#7fae54"/><path d="M0 0 q 6 -20 8 -24 q 2 4 8 24" fill="#93c063"/></g>');
    },
    lake: function (t, r, o) {
      hills(t, r, o, '#586f4e');
      ground(t, o, '#8aa86b');
      o.push('<ellipse cx="160" cy="196" rx="150" ry="26" fill="#5aa8c6"/>');
      for (var i = 0; i < 8; i++) o.push('<path d="M' + r2(30 + i * 34) + ' ' + r2(188 + r() * 18) + ' q 9 4 18 0" stroke="#e2f4fb" stroke-width="1.4" fill="none" opacity=".45"/>');
      for (i = 0; i < 5; i++) pine(24 + i * 66 + r() * 12, 178, .7 + r() * .4, '#43683c', o);
      o.push('<rect x="196" y="180" width="46" height="6" fill="#8a6a48"/><rect x="206" y="168" width="5" height="14" fill="#8a6a48"/><rect x="228" y="168" width="5" height="14" fill="#8a6a48"/>');
    },
    onsen: function (t, r, o) {
      hills(t, r, o, '#556b4a');
      ground(t, o, '#93876f');
      o.push('<ellipse cx="170" cy="192" rx="104" ry="30" fill="#7fc6d6"/>');
      o.push('<ellipse cx="170" cy="192" rx="86" ry="22" fill="#a5dbe6" opacity=".75"/>');
      for (var i = 0; i < 6; i++) {
        var sx = 96 + r() * 150, sy = 168 + r() * 10;
        o.push('<path d="M' + r2(sx) + ' ' + r2(sy) + ' c 6 -10 -6 -16 0 -26 c 6 -10 -4 -14 0 -22" stroke="#fff" stroke-width="2.4" fill="none" opacity="' + r2(.28 + r() * .3) + '"/>');
      }
      o.push('<ellipse cx="72" cy="190" rx="22" ry="14" fill="#8c8272"/><ellipse cx="262" cy="196" rx="26" ry="15" fill="#7f7666"/>');
      for (i = 0; i < 5; i++) o.push('<rect x="' + r2(8 + i * 16) + '" y="162" width="4" height="26" fill="#8a6a48" opacity=".9"/>');
      for (i = 0; i < 2; i++) pine(30 + i * 250, 176, .8, '#3f6b3a', o);
    },
    town: function (t, r, o) {
      hills(t, r, o, '#6a6a7a');
      ground(t, o, '#9b8f7c');
      for (var i = 0; i < 6; i++) {
        var x = i * 54 + r() * 6, w = 40 + r() * 12, h = 42 + r() * 34, y = 172 - h;
        var col = ['#e5d3b0', '#dcc6a4', '#e9dcc2', '#d6c19d'][i % 4];
        o.push('<rect x="' + r2(x) + '" y="' + r2(y) + '" width="' + r2(w) + '" height="' + r2(h) + '" fill="' + col + '"/>');
        o.push('<path d="M' + r2(x - 4) + ' ' + r2(y) + ' L' + r2(x + w / 2) + ' ' + r2(y - 13) + ' L' + r2(x + w + 4) + ' ' + r2(y) + ' Z" fill="#8e5a4a"/>');
        for (var k = 0; k < 3; k++) {
          var wy = y + 12 + k * 13;
          o.push('<rect x="' + r2(x + 8) + '" y="' + r2(wy) + '" width="8" height="8" fill="' + (t === 'night' ? '#ffd98a' : '#9fb6c4') + '"/>');
          o.push('<rect x="' + r2(x + 24) + '" y="' + r2(wy) + '" width="8" height="8" fill="' + (t === 'night' ? '#ffd98a' : '#9fb6c4') + '"/>');
        }
      }
      if (t === 'night' || t === 'dusk') for (i = 0; i < 4; i++) o.push('<circle cx="' + r2(30 + i * 82) + '" cy="132" r="5" fill="#ffcf7a" opacity=".9"/><rect x="' + r2(28 + i * 82) + '" y="120" width="2" height="14" fill="#6b5a4a"/>');
    },
    snow: function (t, r, o) {
      o.push('<path d="M-20 168 L60 72 L130 168 Z" fill="#f3f7fb"/><path d="M90 168 L180 58 L272 168 Z" fill="#e8f0f8"/><path d="M230 168 L300 92 L340 168 Z" fill="#f3f7fb"/>');
      o.push('<path d="M60 72 L84 100 L36 100 Z" fill="#fff"/><path d="M180 58 L210 96 L150 96 Z" fill="#fff"/>');
      ground(t, o, '#eef4fa');
      for (var i = 0; i < 10; i++) pine(12 + i * 33 + r() * 8, 182, .5 + r() * .3, '#6b8f7a', o);
      for (i = 0; i < 40; i++) o.push('<circle cx="' + r2(r() * 316) + '" cy="' + r2(r() * 200) + '" r="' + r2(.8 + r() * 1.6) + '" fill="#fff" opacity="' + r2(.4 + r() * .5) + '"/>');
    },
    desert: function (t, r, o) {
      o.push('<path d="M0 172 C 60 128, 120 168, 190 150 C 250 136, 290 164, 320 158 L320 220 L0 220 Z" fill="#e8c078"/>');
      o.push('<path d="M0 186 C 70 158, 140 196, 220 178 C 270 168, 300 186, 320 182 L320 220 L0 220 Z" fill="#dcaf62"/>');
      ground(t, o, '#e8c078');
      // 三丛仙人掌（早年版只有一株，画面空得看不出是哪儿）
      [[252, 176, 1], [52, 184, .8], [150, 190, .6]].forEach(function (c) {
        o.push('<g transform="translate(' + c[0] + ',' + c[1] + ') scale(' + c[2] + ')">' +
          '<rect x="-6" y="-50" width="12" height="50" rx="6" fill="#5f8f52"/>' +
          '<rect x="-22" y="-36" width="13" height="9" rx="4.5" fill="#5f8f52"/>' +
          '<rect x="-22" y="-52" width="13" height="9" rx="4.5" fill="#5f8f52"/>' +
          '<rect x="-24" y="-29" width="12" height="24" rx="6" fill="#578549"/>' +
          '<rect x="10" y="-42" width="11" height="7" rx="3.5" fill="#5f8f52"/>' +
          '<rect x="10" y="-26" width="10" height="22" rx="5" fill="#578549"/></g>');
      });
      for (var i = 0; i < 9; i++) o.push('<ellipse cx="' + r2(16 + r() * 280) + '" cy="' + r2(190 + r() * 20) + '" rx="' + r2(4 + r() * 9) + '" ry="1.6" fill="#c99a4e" opacity=".65"/>');
      for (i = 0; i < 4; i++) o.push('<ellipse cx="' + r2(30 + r() * 250) + '" cy="' + r2(180 + r() * 26) + '" rx="' + r2(4 + r() * 5) + '" ry="' + r2(2 + r() * 3) + '" fill="#b8913f" opacity=".55"/>');
    },
    temple: function (t, r, o) {
      hills(t, r, o, '#6d6a52');
      ground(t, o, '#a89a78');
      // 五重塔：白墙 + 深瓦顶（早年版把塔身也刷成红色，和鸟居糊成两座红门）
      var cx = 236;
      for (var i = 0; i < 4; i++) {
        var w = 74 - i * 11, y = 172 - i * 27;
        o.push('<rect x="' + r2(cx - w / 2 + 7) + '" y="' + r2(y - 17) + '" width="' + r2(w - 14) + '" height="17" fill="#f4f1e6"/>');
        o.push('<rect x="' + r2(cx - 6) + '" y="' + r2(y - 11) + '" width="12" height="6" fill="#8b93a0"/>');
        o.push('<path d="M' + r2(cx - w / 2 - 9) + ' ' + r2(y - 17) + ' Q' + cx + ' ' + r2(y - 30) + ' ' + r2(cx + w / 2 + 9) + ' ' + r2(y - 17) + ' Z" fill="#4a5260"/>');
      }
      o.push('<rect x="' + (cx - 2) + '" y="46" width="4" height="16" fill="#4a5260"/><circle cx="' + cx + '" cy="44" r="4" fill="#d8c45e"/>');
      // 石阶
      o.push('<rect x="' + (cx - 34) + '" y="178" width="68" height="5" fill="#cbbf9f"/><rect x="' + (cx - 28) + '" y="183" width="56" height="5" fill="#bdb092"/>');
      // 鸟居（朱红，做前景识别符号）
      o.push('<g transform="translate(48,180) scale(.95)" fill="#c1452f"><rect x="-22" y="-58" width="7" height="58"/><rect x="15" y="-58" width="7" height="58"/><rect x="-31" y="-65" width="62" height="7" rx="2"/><rect x="-26" y="-50" width="52" height="5"/></g>');
      for (i = 0; i < 5; i++) broad(20 + i * 44 + r() * 14, 186, .45 + r() * .28, (t === 'dusk' || t === 'night') ? '#8f5a49' : '#6b9a52', o);
      for (i = 0; i < 10; i++) o.push('<circle cx="' + r2(16 + r() * 300) + '" cy="' + r2(172 + r() * 34) + '" r="2" fill="#c1633f" opacity=".65"/>');
    },
    castle: function (t, r, o) {
      hills(t, r, o, '#5c6b62');
      o.push('<path d="M0 176 C 80 140, 200 168, 320 146 L320 220 L0 220 Z" fill="#7e8f6a"/>');
      ground(t, o, '#7e8f6a');
      // 天守
      for (var i = 0; i < 3; i++) {
        var w = 84 - i * 16, y = 150 - i * 26;
        o.push('<rect x="' + r2(160 - w / 2) + '" y="' + r2(y - 15) + '" width="' + w + '" height="15" fill="#f2efe4"/>');
        o.push('<path d="M' + r2(160 - w / 2 - 10) + ' ' + r2(y - 15) + ' L160 ' + r2(y - 27) + ' L' + r2(160 + w / 2 + 10) + ' ' + r2(y - 15) + ' Z" fill="#4a5260"/>');
        o.push('<rect x="' + r2(156) + '" y="' + r2(y - 9) + '" width="8" height="6" fill="' + (t === 'night' ? '#ffd98a' : '#8b93a0') + '"/>');
      }
      o.push('<rect x="155" y="52" width="10" height="14" fill="#4a5260"/><circle cx="160" cy="50" r="4" fill="#d8c45e"/>');
      // 护城河
      o.push('<rect x="0" y="196" width="320" height="24" fill="#5fa8c9" opacity=".85"/>');
      for (i = 0; i < 6; i++) o.push('<path d="M' + r2(20 + i * 52) + ' ' + r2(204 + r() * 10) + ' q 8 4 16 0" stroke="#e0f2fa" stroke-width="1.4" fill="none" opacity=".45"/>');
      for (i = 0; i < 4; i++) pine(20 + i * 92 + r() * 14, 190, .6 + r() * .3, '#3f6b3a', o);
    },
    port: function (t, r, o) {
      water(t, r, o, 156, 64, '#3b7f9e');
      // 灯塔
      o.push('<g transform="translate(46,156)"><path d="M-14 0 L-8 -66 L8 -66 L14 0 Z" fill="#f3f0e6"/><rect x="-12" y="-40" width="24" height="8" fill="#c1452f"/><rect x="-9" y="-20" width="18" height="8" fill="#c1452f"/><rect x="-11" y="-74" width="22" height="9" rx="2" fill="#5a6270"/><circle cx="0" cy="-70" r="4.5" fill="#ffe08a"/></g>');
      o.push('<path d="M46 -66 L140 -34 L140 -4 Z" fill="#ffe08a" opacity=".18" transform="translate(0,222)"/>');
      // 船
      var boats = [[228, 168, .9], [286, 182, .7]];
      boats.forEach(function (b) {
        o.push('<g transform="translate(' + b[0] + ',' + b[1] + ') scale(' + b[2] + ')"><path d="M-22 0 L22 0 L14 12 L-14 12 Z" fill="#6b7684"/><rect x="-2" y="-34" width="4" height="34" fill="#6b7684"/><path d="M2 -34 L20 -8 L2 -8 Z" fill="#f2efe4"/></g>');
      });
      o.push('<rect x="150" y="150" width="170" height="7" fill="#8a7a64"/>');
      for (var i = 0; i < 6; i++) o.push('<rect x="' + r2(160 + i * 26) + '" y="140" width="4" height="12" fill="#6b5a4a" opacity=".8"/>');
    },
    falls: function (t, r, o) {
      hills(t, r, o, '#5d7a52');
      ground(t, o, '#4e6b4a');
      // 左右两片崖壁，中间留出真正看得见的出水口（早年版是一整块死绿 + 水从画面顶边凭空落下）
      o.push('<path d="M0 44 L156 44 L150 108 L158 220 L0 220 Z" fill="#4e6b52"/>');
      o.push('<path d="M244 92 L320 92 L320 220 L250 220 Z" fill="#5a7758"/>');
      // 崖顶草沿
      o.push('<path d="M0 44 Q 78 38 156 44 L150 56 Q 78 50 0 56 Z" fill="#7fa061"/>');
      o.push('<path d="M244 92 Q 282 88 320 92 L320 102 Q 282 98 244 102 Z" fill="#7fa061"/>');
      // 崖顶的树
      for (var i = 0; i < 3; i++) pine(24 + i * 52 + r() * 12, 44 + r() * 4, .55 + r() * .28, '#356440', o);
      for (i = 0; i < 2; i++) pine(268 + i * 34, 92, .45 + r() * .2, '#356440', o);
      // 岩层纹理，让崖壁不是一块平色
      o.push('<path d="M0 96 q 70 12 150 -4" stroke="#3f5a44" stroke-width="3" fill="none" opacity=".45"/>');
      o.push('<path d="M0 152 q 74 -14 152 6" stroke="#3f5a44" stroke-width="3" fill="none" opacity=".35"/>');
      // 出水口小坎
      o.push('<rect x="156" y="44" width="88" height="9" fill="#8fd6e8"/>');
      o.push('<rect x="150" y="50" width="100" height="6" rx="3" fill="#6f8f6a"/>');
      // 瀑布主体
      o.push('<path d="M158 53 L246 53 L242 152 L162 152 Z" fill="#8fd6e8" opacity=".95"/>');
      for (i = 0; i < 5; i++) o.push('<path d="M' + r2(166 + i * 16) + ' 56 L' + r2(168 + i * 16) + ' 150" stroke="#fff" stroke-width="3" opacity="' + r2(.35 + r() * .3) + '"/>');
      // 水潭
      o.push('<ellipse cx="202" cy="160" rx="66" ry="22" fill="#7fc6d6"/>');
      o.push('<ellipse cx="202" cy="160" rx="46" ry="14" fill="#a5dbe6" opacity=".8"/>');
      // 水花
      for (i = 0; i < 14; i++) o.push('<circle cx="' + r2(168 + r() * 68) + '" cy="' + r2(138 + r() * 24) + '" r="' + r2(1 + r() * 2.4) + '" fill="#fff" opacity="' + r2(.35 + r() * .45) + '"/>');
      // 池边石头
      o.push('<ellipse cx="140" cy="164" rx="16" ry="10" fill="#8c8272"/><ellipse cx="266" cy="170" rx="19" ry="11" fill="#7f7666"/>');
      // 前景灌木
      for (i = 0; i < 5; i++) broad(10 + i * 66 + r() * 14, 196, .4 + r() * .22, '#3f7a45', o);
      if (t === 'dawn') o.push('<path d="M156 138 C 182 112, 226 114, 252 140" stroke="#ffd6e0" stroke-width="3" fill="none" opacity=".5"/>');
    },
    tropics: function (t, r, o) {
      water(t, r, o, 150, 70, '#2fbfc4');
      ground(t, o, '#f0dfa8');
      for (var i = 0; i < 40; i++) o.push('<circle cx="' + r2(r() * 316) + '" cy="' + r2(30 + r() * 100) + '" r="1.2" fill="#fff" opacity=".5"/>');
      palm(62, 188, 1.05, o);
      palm(168, 182, .8, o);
      palm(268, 190, .95, o);
      o.push('<circle cx="60" cy="60" r="20" fill="#ffe9a8" opacity=".8"/>');
      for (i = 0; i < 6; i++) o.push('<ellipse cx="' + r2(20 + r() * 280) + '" cy="' + r2(196 + r() * 14) + '" rx="' + r2(5 + r() * 7) + '" ry="1.8" fill="#d8c184" opacity=".6"/>');
    }
  };

  /* ---------- 明信片风景 ---------- */
  function sceneSVG(kind, time, seed) {
    time = time || 'day';
    var r = rngFor(String(kind) + '|' + time + '|' + String(seed === undefined ? '' : seed));
    var p = pal(time);
    var o = [];
    o.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" preserveAspectRatio="xMidYMid slice" class="scene-svg">');
    o.push('<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + p.sky[0] + '"/><stop offset="35%" stop-color="' + p.sky[1] + '"/>' +
      '<stop offset="72%" stop-color="' + p.sky[2] + '"/><stop offset="100%" stop-color="' + p.sky[3] + '"/></linearGradient></defs>');
    skyLayer(time, r, o);
    (FEATURES[kind] || FEATURES.field)(time, r, o);
    o.push(frogInScene(time, r, kind));
    o.push('<rect width="320" height="220" fill="' + p.tint + '"/>');
    // 胶片颗粒感
    o.push('<rect width="320" height="220" fill="url(#grain)" opacity="0"/>');
    o.push('</svg>');
    return o.join('');
  }

  /* ---------- 明信片里的青蛙：直接借用场景模块那只（只有一个渲染器） ---------- */
  function sceneModule() {
    if (typeof module === 'object' && module.exports) return require('./scene.js');
    return (typeof window !== 'undefined' && window.TF) ? window.TF.Scene : null;
  }
  /* scene.js 的青蛙以「身体中心」为原点，这里的 place 给的是脚底落点，
     而青蛙原点在身体中心 → 往上抬 (42 + 34*0.95) * scale 让脚正好踩在 place[1] 上 */
  var FROG_ORIGIN_Y = 42, FROG_FEET_Y = 34, FROG_INNER = 0.95;
  function frogInScene(time, r, kind) {
    var place = {
      beach: [232, 178, .62, 'walk'], lake: [96, 172, .6, 'look'], onsen: [150, 178, .62, 'bath'],
      snow: [150, 176, .6, 'climb'], desert: [110, 178, .6, 'walk'], port: [112, 146, .58, 'look'],
      falls: [206, 152, .62, 'swim'], tropics: [186, 172, .6, 'swim'], river: [96, 186, .58, 'walk'],
      temple: [116, 182, .58, 'sit'], castle: [96, 172, .56, 'look'], town: [96, 182, .58, 'walk'],
      forest: [110, 184, .6, 'walk'], field: [110, 184, .6, 'walk']
    }[kind] || [110, 184, .6, 'walk'];
    var Sc = sceneModule();
    var s = place[2];
    var wiggle = (r() - 0.5) * 8;
    var fx = r2(place[0] + wiggle);                       // 脚底横坐标
    var fy = place[1];                                    // 脚底纵坐标
    var top = r2(fy - (FROG_ORIGIN_Y + FROG_FEET_Y * FROG_INNER) * s);
    var night = time === 'night' || time === 'dusk';
    var g = '<g transform="translate(' + fx + ',' + top + ') scale(' + s + ')">' +
      '<g transform="translate(' + FROG_ORIGIN_Y + ' ' + FROG_ORIGIN_Y + ') scale(' + FROG_INNER + ')">' +
      (Sc ? Sc.frogFigure(place[3], { night: night }) : '') + '</g></g>';
    // 影子
    var sh = '<ellipse cx="' + fx + '" cy="' + r2(fy) + '" rx="15" ry="4.5" fill="#000" opacity=".16"/>';
    return sh + g;
  }

  /* ============================================================
   * 图标：便当 / 道具 / 特产
   * ============================================================ */
  var ICONS = {
    raisin_bread: function () { return '<ellipse cx="16" cy="17" rx="13" ry="9" fill="#d8a869"/><ellipse cx="16" cy="14" rx="11" ry="6" fill="#e8bf85"/><circle cx="10" cy="14" r="1.8" fill="#6b4a2a"/><circle cx="18" cy="12" r="1.8" fill="#6b4a2a"/><circle cx="22" cy="16" r="1.8" fill="#6b4a2a"/>'; },
    pumpkin_bagel: function () { return '<circle cx="16" cy="16" r="12" fill="#e0a04a"/><circle cx="16" cy="16" r="4" fill="#f6ecd8"/><circle cx="16" cy="16" r="12" fill="none" stroke="#c98a38" stroke-width="2"/>'; },
    grape_scone: function () { return '<path d="M4 18 q 12 -14 24 0 q -12 10 -24 0 Z" fill="#d2b083"/><circle cx="11" cy="14" r="2.6" fill="#7a4a86"/><circle cx="20" cy="15" r="2.6" fill="#7a4a86"/><circle cx="16" cy="19" r="2.4" fill="#7a4a86"/>'; },
    walnut_mochi: function () { return '<ellipse cx="16" cy="17" rx="12" ry="9" fill="#f4e7cf"/><circle cx="12" cy="15" r="3" fill="#c99a63"/><circle cx="20" cy="17" r="3" fill="#c99a63"/>'; },
    cheese_tart: function () { return '<path d="M4 20 L16 6 L28 20 Z" fill="#e8c46a"/><rect x="3" y="19" width="26" height="4" rx="2" fill="#c99a4a"/><circle cx="16" cy="15" r="2.4" fill="#fff6d8"/>'; },
    spinach_quiche: function () { return '<ellipse cx="16" cy="17" rx="13" ry="9" fill="#e8c46a"/><ellipse cx="16" cy="16" rx="10" ry="6" fill="#8fbf62"/><circle cx="12" cy="16" r="1.6" fill="#5f8f45"/><circle cx="20" cy="15" r="1.6" fill="#5f8f45"/>'; },
    eel_rice: function () { return '<rect x="6" y="14" width="20" height="12" rx="3" fill="#5a6a7a"/><ellipse cx="16" cy="15" rx="9" ry="4" fill="#fdf6e6"/><path d="M8 14 q 8 -5 16 0 q -8 3 -16 0 Z" fill="#a9683a"/>'; },
    mugwort_mochi: function () { return '<circle cx="16" cy="16" r="11" fill="#8fbf62"/><circle cx="16" cy="16" r="11" fill="none" stroke="#6f9a4a" stroke-width="2"/><circle cx="16" cy="13" r="2" fill="#e8f0d0"/>'; },
    headband: function () { return '<path d="M4 20 q 12 -12 24 0 q -12 6 -24 0 Z" fill="#e07a5f"/><path d="M4 20 q 6 -3 12 -1 M28 20 q -6 -3 -12 -1" stroke="#c25a3f" fill="none" stroke-width="1.4"/>'; },
    bell: function () { return '<path d="M16 5 q 8 2 8 12 q 0 6 3 8 L5 25 q 3 -2 3 -8 q 0 -10 8 -12 Z" fill="#e8c46a"/><circle cx="16" cy="6" r="2.6" fill="#c9a23a"/><circle cx="16" cy="27" r="3" fill="#c9a23a"/>'; },
    lantern: function () { return '<rect x="9" y="8" width="14" height="17" rx="4" fill="#f0dcae"/><rect x="7" y="6" width="18" height="3" rx="1.5" fill="#7a5a3a"/><rect x="7" y="24" width="18" height="3" rx="1.5" fill="#7a5a3a"/><path d="M16 12 v9" stroke="#c9a23a" stroke-width="1.4"/><circle cx="16" cy="17" r="5" fill="#ffd98a" opacity=".85"/>'; },
    bowl: function () { return '<path d="M4 14 q 12 16 24 0 Z" fill="#c99a63"/><ellipse cx="16" cy="14" rx="12" ry="3.4" fill="#e2b380"/><ellipse cx="16" cy="14" rx="9" ry="2.2" fill="#fdf6e6"/>'; },
    flask: function () { return '<rect x="11" y="10" width="10" height="16" rx="4" fill="#8fa8c0"/><rect x="14" y="5" width="4" height="6" rx="2" fill="#6b7f92"/><rect x="11" y="16" width="10" height="4" fill="#c2d4e2"/>'; },
    tent: function () { return '<path d="M3 25 L16 6 L29 25 Z" fill="#7fb069"/><path d="M16 6 L16 25" stroke="#5f8f45"/><path d="M12 25 L16 15 L20 25 Z" fill="#e8f0d8"/>'; },
    pass: function () { return '<rect x="4" y="8" width="24" height="16" rx="3" fill="#f4efe0" stroke="#c9b48a"/><circle cx="11" cy="16" r="4" fill="#9fb8d8"/><rect x="17" y="12" width="9" height="2" fill="#c9b48a"/><rect x="17" y="16" width="9" height="2" fill="#c9b48a"/><rect x="17" y="20" width="6" height="2" fill="#c9b48a"/>'; },
    fourleaf: function () { return '<g fill="#5f9f4a"><path d="M16 16 q -9 -4 -9 -9 q 6 -1 9 9 Z"/><path d="M16 16 q 9 -4 9 -9 q -6 -1 -9 9 Z"/><path d="M16 16 q -9 4 -9 9 q 6 1 9 -9 Z"/><path d="M16 16 q 9 4 9 9 q -6 1 -9 -9 Z"/></g><path d="M16 18 q -2 6 -1 9" stroke="#4a7f3a" stroke-width="1.6" fill="none"/>'; },
    clover: function () { return '<g fill="#6fb04a"><circle cx="12" cy="13" r="5.4"/><circle cx="20" cy="13" r="5.4"/><circle cx="16" cy="20" r="5.4"/></g><path d="M16 20 q -1 5 0 8" stroke="#4a7f3a" stroke-width="1.6" fill="none"/>'; },
    souvenir: function () { return '<path d="M7 12 h18 l-2 14 h-14 Z" fill="#d8b78a" stroke="#b8956a"/><path d="M12 12 q 4 -5 8 0" stroke="#b8956a" fill="none" stroke-width="1.6"/>'; }
  };
  function itemIcon(kind, id, size) {
    size = size || 32;
    var fn = ICONS[id] || ICONS.souvenir;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="' + size + '" height="' + size + '" class="icon-svg ' + (kind || '') + '">' + fn() + '</svg>';
  }

  /* ============================================================
   * 商店货格：布包（原作的便当/道具都是包在布巾里的）
   * 布巾颜色按 id 确定性取，同一件东西永远同一个花色。
   * ============================================================ */
  var CLOTHS = [
    { c: '#efc9d4', d: '#ddaebd', dot: '#f8e4ea' },   // 粉
    { c: '#c3e0a8', d: '#a3c785', dot: '#dcf0c6' },   // 绿
    { c: '#b7d8ea', d: '#93bcd4', dot: '#d6eaf5' },   // 蓝
    { c: '#f0dda0', d: '#d7bf7c', dot: '#f9edc4' },   // 黄
    { c: '#e5d5c0', d: '#cab69b', dot: '#f4ead9' },   // 米
    { c: '#d9c3e0', d: '#bca1c6', dot: '#ecdff2' }    // 紫
  ];
  function bundleSVG(kind, id, px) {
    px = px || 96;
    var cl = CLOTHS[hashStr(String(id)) % CLOTHS.length];
    var ink = '#4b433a';
    var inner = (ICONS[id] || ICONS.souvenir)();
    var dots = '';
    [[34, 42, 2.8], [66, 46, 2.8], [40, 56, 2.4], [62, 60, 2.4]].forEach(function (d) {
      dots += '<circle cx="' + d[0] + '" cy="' + d[1] + '" r="' + d[2] + '" fill="' + cl.dot + '"/>';
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="' + px + '" height="' + px +
      '" class="bundle-svg" aria-hidden="true">' +
      /* 布包主体 */
      '<path d="M16 32 Q14 22 26 22 L74 22 Q86 22 84 32 L86 82 Q88 94 76 94 L24 94 Q12 94 14 82 Z" fill="' + cl.c +
      '" stroke="' + ink + '" stroke-width="2.4" stroke-linejoin="round"/>' + dots +
      /* 包着的便当 / 道具 */
      '<g transform="translate(50 56) scale(1.5) translate(-16 -16)">' + inner + '</g>' +
      /* 前襟（盖住下半，读起来就是"包起来"） */
      '<path d="M14 66 Q30 57 50 63 Q70 69 86 61 L86 82 Q88 94 76 94 L24 94 Q12 94 14 82 Z" fill="' + cl.d +
      '" stroke="' + ink + '" stroke-width="2.2" stroke-linejoin="round"/>' +
      /* 顶上的结 */
      '<path d="M40 25 Q41 8 50 10 Q59 8 60 25 Q50 31 40 25 Z" fill="' + cl.d +
      '" stroke="' + ink + '" stroke-width="2.2" stroke-linejoin="round"/>' +
      '<path d="M44 22 Q50 28 56 22" fill="none" stroke="' + ink + '" stroke-width="1.6"/>' +
      '</svg>';
  }

  /* ============================================================
   * 手绘面板边框：真 SVG 路径（不是 CSS 圆角框）
   * ------------------------------------------------------------
   * CSS 边框做不出手绘感的两件事：四条边各自歪、角上"出锋"（手画时笔收不住）。
   * 所以边框交给真路径：每条边一个二次曲线（中点带确定性外凸/内凹），两端各延长 0-5%。
   * UI 层量出元素尺寸后用它生成一张覆盖用的 <svg>；这里是纯函数，可在 Node 里断言。
   * ============================================================ */
  function sketchBox(w, h, seed, opt) {
    opt = opt || {};
    function rr(x) { return Math.round(x * 100) / 100; }
    var pad = opt.pad === undefined ? 3 : opt.pad;
    var L = pad, R = w - pad, T = pad, B = h - pad;
    if (R - L < 10 || B - T < 10) return '';
    var k = opt.k === undefined ? 1.5 : opt.k;
    function jf(i, a) {
      var x = Math.sin((seed + i) * 127.1 + 311.7) * 43758.5453;
      return ((x - Math.floor(x)) * 2 - 1) * a;
    }
    var r = Math.min(opt.r === undefined ? 7 : opt.r, (R - L) / 4, (B - T) / 4);
    function edge(x1, y1, x2, y2, i, dir) {
      var nx = -(y2 - y1), ny = (x2 - x1), nl = Math.sqrt(nx * nx + ny * ny) || 1;
      nx /= nl; ny /= nl;
      var mx = (x1 + x2) / 2 + nx * jf(i, k) * dir;
      var my = (y1 + y2) / 2 + ny * jf(i, k) * dir;
      var o1 = jf(i + 1, 0.05), o2 = jf(i + 2, 0.05);
      var ax = x1 - (x2 - x1) * o1, ay = y1 - (y2 - y1) * o1;
      var bx = x2 + (x2 - x1) * o2, by = y2 + (y2 - y1) * o2;
      return 'M' + rr(ax) + ' ' + rr(ay) + ' Q' + rr(mx) + ' ' + rr(my) + ' ' + rr(bx) + ' ' + rr(by);
    }
    var d = edge(L + r, T, R - r, T, 1, -1) + edge(R, T + r, R, B - r, 11, 1) +
            edge(R - r, B, L + r, B, 21, 1) + edge(L, B - r, L, T + r, 31, -1);
    var ink = opt.ink || '#3c352d';
    var sw = opt.w === undefined ? 2 : opt.w;
    return '<svg class="sk-border" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">' +
      (opt.double === false ? '' :
        '<path d="' + d + '" fill="none" stroke="' + ink + '" stroke-width="' + rr(sw * 1.9) +
        '" stroke-linecap="round" opacity=".13" transform="translate(' + rr(opt.so || 1.1) + ',' + rr(opt.so || 1.1) + ')"/>') +
      '<path d="' + d + '" fill="none" stroke="' + ink + '" stroke-width="' + sw + '" stroke-linecap="round"/>' +
      '</svg>';
  }

  return {
    sceneSVG: sceneSVG, itemIcon: itemIcon, bundleSVG: bundleSVG, sketchBox: sketchBox,
    rngFor: rngFor, hashStr: hashStr, FEATURES: FEATURES, PAL: PAL
  };
});
