/* ============================================================
 * 旅行青蛙 · 界面 (js/ui.js)
 * ------------------------------------------------------------
 * 单一职责：把引擎的只读视图渲染成 DOM，并把点击翻译成引擎动作。
 * 不含游戏规则（规则全在 engine.js），不直接写 localStorage（在 engine.js）。
 * 性能策略：每个屏幕各自记一个「签名」，签名没变就不重建 DOM；
 * 时间相关的进度（生长条 / 行程条 / 倒计时）走轻量 lightTick。
 * ============================================================ */
(function (root, factory) {
  root.TF = root.TF || {};
  root.TF.UI = factory(root.TF);
})(typeof window !== 'undefined' ? window : this, function (TF) {
  'use strict';

  var D = TF.DATA, Art = TF.Art;
  var eng = null, el = {};
  var ui = { tab: 'home', shopKind: 'food', bagFood: null, bagItems: [], frogPose: null };
  var sig = {};                       // 每个屏幕的签名缓存

  /* ---------------- 小工具 ---------------- */
  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDur(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + ' 秒';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' 分钟';
    return Math.round(m / 60 * 10) / 10 + ' 小时';
  }
  function clk(ts) { var d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function ago(ts) {
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return '刚刚';
    if (s < 3600) return Math.round(s / 60) + ' 分钟前';
    return Math.round(s / 3600) + ' 小时前';
  }
  var TIME_NAME = { dawn: '清晨', day: '白天', dusk: '黄昏', night: '夜里' };
  var DIST_NAME = { near: '近郊', mid: '中程', far: '远行', exotic: '秘境' };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  /* 签名：变了才重建 DOM */
  function changed(key, s) { if (sig[key] === s) return false; sig[key] = s; return true; }
  function invalidate() { sig = {}; }

  /* ---------------- Toast / 弹窗 ---------------- */
  var MAX_TOASTS = 3;                 // 同屏最多留几条，多了会糊住整个画面
  function toast(msg) {
    var host = $('toasts');
    var same = null;
    Array.prototype.forEach.call(host.children, function (n) {
      if (n.dataset.msg === msg) same = n;
    });
    if (same) {                       // 同一条消息连续出现 → 合并成 ×N，而不是叠一摞
      same.dataset.n = String((+same.dataset.n || 1) + 1);
      same.textContent = msg + ' ×' + same.dataset.n;
      clearTimeout(+same.dataset.timer);
      same.dataset.timer = String(setTimeout(function () { same.classList.add('out'); setTimeout(function () { same.remove(); }, 320); }, 1900));
      return;
    }
    while (host.children.length >= MAX_TOASTS) host.removeChild(host.firstChild);
    var t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg; t.dataset.msg = msg; t.dataset.n = '1';
    host.appendChild(t);
    t.dataset.timer = String(setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 320); }, 1900));
  }
  function openModal(opts) {
    var box = $('modal-box');
    var html = '<div class="m-head"><span>' + esc(opts.title || '') + '</span>' +
      '<button class="hud-btn" data-m="close">✕</button></div>' +
      '<div class="m-body">' + (opts.body || '') + '</div>';
    if (opts.buttons && opts.buttons.length) {
      html += '<div class="m-foot">' + opts.buttons.map(function (b, i) {
        return '<button class="' + (b.cls || 'm-ghost') + '" data-m="btn" data-i="' + i + '">' + esc(b.label) + '</button>';
      }).join('') + '</div>';
    }
    box.innerHTML = html;
    $('modal').classList.remove('hidden');
    box.querySelector('[data-m="close"]').onclick = closeModal;
    box.querySelectorAll('[data-m="btn"]').forEach(function (b) {
      b.onclick = function () {
        var fn = opts.buttons[+b.dataset.i].onClick;
        if (fn && fn() === false) return;
        closeModal();
      };
    });
  }
  function closeModal() { $('modal').classList.add('hidden'); $('modal-box').innerHTML = ''; }

  /* ---------------- 顶栏 ---------------- */
  function renderHud() {
    var v = eng.view();
    $('num-clover').textContent = v.clover;
    $('num-fourleaf').textContent = v.fourLeaf;
    $('hud-title').textContent = v.title;
    $('album-badge').textContent = v.album.length ? String(v.album.length) : '';
  }

  /* ---------------- 家 ---------------- */
  var POSES = { idle: 'walk', read: 'read', write: 'write', whittle: 'whittle', eat: 'eat', nap: 'nap' };
  var ACT_NAME = {};
  D.ACTIVITIES.forEach(function (a) { ACT_NAME[a.id] = a.name; });

  function gardenHTML() {
    var sprout = '<svg viewBox="0 0 24 24" class="sprout"><path d="M12 22 V13" stroke="#6fb04a" stroke-width="2" fill="none"/>' +
      '<path d="M12 15 q -8 -2 -8 -8 q 8 0 8 8 Z" fill="#8fcf62"/>' +
      '<path d="M12 15 q 8 -2 8 -8 q -8 0 -8 8 Z" fill="#7cbb50"/></svg>';
    var s = '';
    for (var i = 0; i < eng.config.garden.plots; i++) {
      s += '<button class="plot" data-plot="' + i + '">' +
        Art.itemIcon('clover', 'clover', 24) + sprout + '<i class="prog"></i></button>';
    }
    return s;
  }

  function renderHome(force) {
    var v = eng.view();
    var key = 'home|' + v.frog.state + '|' + v.frog.activity + '|' + v.visitor.state + '|' +
      JSON.stringify(v.packed) + '|' + v.ripeCount + '|' + v.fourLeaf + '|' +
      v.log.length + '#' + (v.log[0] ? v.log[0].at : 0);
    if (force || changed('home', key)) {
      // 青蛙立绘
      var pose = v.frog.state === 'away' ? null : (POSES[v.frog.activity] || 'idle');
      if (pose !== ui.frogPose) {
        ui.frogPose = pose;
        $('frog-host').innerHTML = pose ? Art.frogSVG(pose) : '';
      }
      $('frog-host').className = 'frog-host' + (pose ? ' walking' : ' away');
      var b = $('frog-bubble');
      if (pose) { b.textContent = ACT_NAME[v.frog.activity] || '发呆'; b.classList.remove('hidden'); }
      else b.classList.add('hidden');

      // 行囊条
      var strip = $('bag-strip');
      if (v.packed.food) {
        var food = D.FOOD_BY_ID[v.packed.food];
        strip.innerHTML = '<div class="bag-slot filled">' + Art.itemIcon('food', food.id, 22) + esc(food.name) + '</div>' +
          v.packed.items.map(function (id) {
            var it = D.ITEM_BY_ID[id];
            return '<div class="bag-slot filled">' + Art.itemIcon('item', id, 22) + esc(it ? it.name : id) + '</div>';
          }).join('') + '<div class="grow"></div><span class="mini-btn" id="go-bag">准备出行</span>';
      } else {
        strip.innerHTML = '<div class="grow"><div class="bag-empty">行囊空着 —— 先给青蛙准备一个便当吧</div></div>' +
          '<button class="mini-btn" id="go-bag">准备行囊</button>';
      }
      var gb = $('go-bag');
      if (gb) gb.onclick = function () { showTab('bag'); };

      // 蜗牛
      $('visitor-spot').classList.toggle('hidden', v.visitor.state !== 'waiting');
      $('visitor-banner').classList.toggle('hidden', v.visitor.state !== 'waiting');
      $('garden').innerHTML = gardenHTML();
      // 首页动态：填掉房间下方那块空白，顺手把「刚才发生了什么」告诉玩家
      $('home-log').innerHTML = v.log.length
        ? v.log.slice(0, 3).map(function (l) {
          return '<div class="log-item"><time>' + clk(l.at) + '</time><span>' + esc(l.text) + '</span></div>';
        }).join('')
        : '<div class="empty" style="padding:8px 0">还很安静。</div>';
    }
    updateTimeUI();
  }

  /* 只随时间变化的东西：田地进度 / 行程进度 / 倒计时 */
  function updateTimeUI() {
    var v = eng.view();
    // 田地
    var plots = $('garden').children;
    for (var i = 0; i < plots.length; i++) {
      var p = v.plots[i]; if (!p) continue;
      var node = plots[i];
      if (p.ripe) { node.classList.add('ripe'); node.querySelector('.prog').style.width = '0'; }
      else {
        node.classList.remove('ripe');
        node.querySelector('.prog').style.width = Math.round(Math.max(0, Math.min(1, p.progress)) * 100) + '%';
      }
    }
    // 行程
    var aw = $('away-panel');
    if (v.frog.state === 'away' || v.frog.state === 'departing') {
      aw.classList.remove('hidden');
      if (v.frog.state === 'departing') {
        $('away-text').textContent = '青蛙在收拾行李……';
        $('away-sub').textContent = '它马上就出门了';
        $('away-fill').style.width = '4%';
      } else {
        var t = v.frog.trip;
        var total = v.frog.backAt - t.departAt, done = v.t - t.departAt;
        var pct = Math.max(0, Math.min(1, done / total));
        $('away-text').textContent = '青蛙带着「' + t.foodName + '」出门了';
        $('away-sub').innerHTML = '已经走了 ' + fmtDur(done) + '　·　预计还要 ' + fmtDur(v.frog.backAt - v.t) + '<br>' +
          '<span style="opacity:.7">' + (pct < .3 ? '还在附近转悠…' : pct < .7 ? '应该走了挺远了…' : '快到家了…') + '</span>';
        $('away-fill').style.width = Math.round(pct * 100) + '%';
      }
    } else {
      aw.classList.add('hidden');
    }
    renderHud();
  }

  /* ---------------- 商店 ---------------- */
  function locationNamesRequiring(itemId) {
    return D.LOCATIONS.filter(function (l) { return (l.requires || []).indexOf(itemId) >= 0; })
      .map(function (l) { return l.name; });
  }
  function renderShop() {
    var v = eng.view();
    var kind = ui.shopKind;
    var table = kind === 'food' ? D.FOODS : D.ITEMS;
    var key = 'shop|' + kind + '|' + v.clover + '|' + JSON.stringify(kind === 'food' ? v.pantry : v.items) + '|' + v.fourLeaf;
    if (!changed('shop', key)) return;

    $('shop-hint').textContent = kind === 'food'
      ? '便当决定青蛙走多远、走多久。越贵的便当，越可能带回稀有的明信片。'
      : '道具在出发时消耗，会推远行程、提高遇上好风景的概率，或打开某些只认道具的地方。';

    $('shop-list').innerHTML = table.map(function (it) {
      var own = kind === 'food' ? (v.pantry[it.id] || 0) : (v.items[it.id] || 0);
      var can = v.clover >= it.price && !it.loot;
      var extra = '';
      if (kind === 'food') extra = '<span class="tag d-' + it.dist + '">' + DIST_NAME[it.dist] + '</span>';
      else {
        var gates = locationNamesRequiring(it.id);
        if (gates.length) extra = '<span class="tag">开：' + esc(gates.join('·')) + '</span>';
      }
      return '<div class="row">' + Art.itemIcon(kind, it.id, 34) +
        '<div class="info"><div class="name">' + esc(it.name) + extra + '</div>' +
        '<div class="desc">' + esc(it.desc) + (own ? '　已有 ' + own + ' 个' : '') + '</div></div>' +
        '<div class="act"><span class="price' + (can ? '' : ' no') + '">🍀 ' + it.price + '</span>' +
        (it.loot ? '<span class="own">不可购买</span>'
          : '<button class="buy" data-buy="' + kind + ':' + it.id + '"' + (can ? '' : ' disabled') + '>买</button>') +
        '</div></div>';
    }).join('');
  }

  /* ---------------- 行囊 ---------------- */
  function renderBag() {
    var v = eng.view();
    var foods = Object.keys(v.pantry).filter(function (id) { return v.pantry[id] > 0 && D.FOOD_BY_ID[id]; });
    var items = Object.keys(v.items).filter(function (id) { return v.items[id] > 0 && D.ITEM_BY_ID[id]; });
    if (v.fourLeaf > 0) items.push('fourleaf');
    var key = 'bag|' + JSON.stringify(foods) + '|' + JSON.stringify(items) + '|' + ui.bagFood + '|' + ui.bagItems.join(',');
    if (!changed('bag', key)) return;

    // 便当
    $('bag-food').innerHTML = foods.length ? foods.map(function (id) {
      var f = D.FOOD_BY_ID[id];
      return '<div class="row' + (ui.bagFood === id ? ' picked' : '') + '" data-pick-food="' + id + '">' +
        Art.itemIcon('food', id, 34) +
        '<div class="info"><div class="name">' + esc(f.name) +
        '<span class="tag d-' + f.dist + '">' + DIST_NAME[f.dist] + '</span>' +
        '<span class="tag">约 ' + fmtDur(f.minMs) + '~' + fmtDur(f.maxMs) + '</span></div>' +
        '<div class="desc">' + esc(f.desc) + '</div></div>' +
        '<div class="act"><span class="own">×' + v.pantry[id] + '</span></div></div>';
    }).join('') : '<div class="empty">还没有便当。<br>去「商店」买一个吧。</div>';

    // 道具
    $('bag-item').innerHTML = items.length ? items.map(function (id) {
      var it = D.ITEM_BY_ID[id];
      var on = ui.bagItems.indexOf(id) >= 0;
      var stock = id === 'fourleaf' ? v.fourLeaf : v.items[id];
      return '<div class="row' + (on ? ' picked' : '') + '" data-pick-item="' + id + '">' +
        Art.itemIcon('item', id, 30) +
        '<div class="info"><div class="name">' + esc(it.name) + '</div>' +
        '<div class="desc">' + esc(it.desc) + '</div></div>' +
        '<div class="act"><span class="own">×' + stock + '</span></div></div>';
    }).join('') : '<div class="empty">没有道具。<br>道具能让青蛙走得更远、看得更多。</div>';

    // 预览
    var pv = ui.bagFood ? eng.previewTrip(ui.bagFood, ui.bagItems) : null;
    if (pv) {
      $('bag-preview').innerHTML = '预计 ' + fmtDur(pv.durationMin) + ' ~ ' + fmtDur(pv.durationMax) +
        '　·　' + (pv.guarantee ? '<b>必得稀有以上</b>' : '好照片概率 +' + Math.round(pv.rareBonus * 100) + '%') +
        '<br>可能去到：' + esc(pv.reachable.map(function (l) { return l.name; }).join('、'));
    } else {
      $('bag-preview').innerHTML = '选一个便当吧（道具可选，最多 3 件）';
    }
    $('btn-depart').disabled = !ui.bagFood;
    $('btn-depart').textContent = ui.bagFood ? '让青蛙出发' : '先选便当';
  }

  /* ---------------- 图鉴 ---------------- */
  function cardHTML(card, big) {
    var loc = D.LOC_BY_ID[card.locId];
    return '<div class="card r-' + card.rarity + (big ? '' : '') + '">' +
      '<span class="badge">' + D.RARITY[card.rarity].name + '</span>' +
      '<div class="photo">' + Art.sceneSVG(loc ? loc.scene : 'field', card.time, card.sceneId) + '</div>' +
      '<div class="cap">' + esc(card.caption) + '</div>' +
      '<div class="meta"><span>' + esc(loc ? loc.name : '?') + ' · ' + TIME_NAME[card.time] + '</span><span>' + ago(card.at) + '</span></div></div>';
  }
  function renderAlbum() {
    var v = eng.view();
    var key = 'album|' + v.album.length + '|' + v.album.map(function (c) { return c.id; }).join(',');
    if (!changed('album', key)) return;
    var got = {};
    v.album.forEach(function (c) { got[c.sceneId] = c; });
    var total = 0, have = 0, html = '';
    // 已收集的（新的在前）
    v.album.slice().reverse().forEach(function (c) {
      html += '<div class="card-wrap" data-card="' + c.id + '">' + cardHTML(c) + '</div>';
    });
    // 未收集的按地点列出
    var locked = '';
    D.LOCATIONS.forEach(function (l) {
      l.scenes.forEach(function (s) {
        total++;
        var sid = l.id + ':' + s[0] + ':' + s[1];
        if (got[sid]) { have++; return; }
        locked += '<div class="card locked"><div class="photo">🔒</div>' +
          '<div class="cap">还没去过的地方…</div>' +
          '<div class="meta"><span>' + esc(l.name) + '</span><span>?</span></div></div>';
      });
    });
    $('album-grid').innerHTML =
      '<div class="empty" style="padding:4px 0 8px">已收集 ' + have + ' / ' + total + ' 张明信片　·　' + esc(v.title) + '</div>' +
      (html || '<div class="empty">还没有明信片。<br>给青蛙准备行囊，让它出门吧。</div>') +
      (locked ? '<div class="empty" style="padding:10px 0 4px">— 尚未拍到 —</div>' + locked : '');
  }

  /* ---------------- 特产 ---------------- */
  function stuffInfo(sid) {
    var locId = sid.split(':')[0], name = sid.split(':')[1];
    var loc = D.LOC_BY_ID[locId];
    var val = 0, rar = 'common';
    if (loc) loc.souvenirs.forEach(function (s) { if (s[0] === name) { val = s[1]; rar = s[2]; } });
    return { locId: locId, name: name, locName: loc ? loc.name : '?', value: val, rarity: rar };
  }
  function renderStuff() {
    var v = eng.view();
    var ids = Object.keys(v.souvenirs).filter(function (k) { return v.souvenirs[k] > 0; });
    var key = 'stuff|' + JSON.stringify(v.souvenirs) + '|' + v.visitor.state;
    if (!changed('stuff', key)) return;
    if (!ids.length) {
      $('stuff-list').innerHTML = '<div class="empty">还没有特产。<br>青蛙出门回来时，会给你带一些。</div>';
      return;
    }
    ids.sort(function (a, b) { return stuffInfo(b).value - stuffInfo(a).value; });
    $('stuff-list').innerHTML = ids.map(function (sid) {
      var s = stuffInfo(sid), n = v.souvenirs[sid];
      var feeding = v.visitor.state === 'waiting';
      return '<div class="row"><div style="width:30px;text-align:center;font-size:20px">' +
        (s.rarity === 'epic' ? '💎' : s.rarity === 'rare' ? '🎁' : '🎀') + '</div>' +
        '<div class="info"><div class="name">' + esc(s.name) +
        '<span class="tag">' + esc(s.locName) + '</span>' +
        '<span class="tag d-' + (s.rarity === 'epic' ? 'exotic' : s.rarity === 'rare' ? 'mid' : 'near') + '">' + D.RARITY[s.rarity].name + '</span></div>' +
        '<div class="desc">持有 ×' + n + '</div></div>' +
        '<div class="act"><span class="price">🍀 ' + s.value + '</span>' +
        (feeding ? '<button class="buy" data-feed="' + esc(sid) + '">喂蜗牛</button>' : '') +
        '<button class="buy" style="background:#b8a67e;box-shadow:0 2px 0 #94835f" data-sell="' + esc(sid) + '">卖</button>' +
        '</div></div>';
    }).join('');
  }

  /* ---------------- 日记 ---------------- */
  function renderLog() {
    var v = eng.view();
    var key = 'log|' + v.log.length + '|' + (v.log[0] ? v.log[0].at : 0);
    if (!changed('log', key)) return;
    $('log-list').innerHTML = v.log.length ? v.log.map(function (l) {
      return '<div class="log-item"><time>' + clk(l.at) + '</time><span>' + esc(l.text) + '</span></div>';
    }).join('') : '<div class="empty">还很安静。<br>做点什么，这里就会热闹起来。</div>';
  }

  /* ---------------- 屏幕调度 ---------------- */
  var RENDERERS = { home: renderHome, shop: renderShop, bag: renderBag, album: renderAlbum, stuff: renderStuff, log: renderLog };
  function showTab(name) {
    ui.tab = name;
    document.querySelectorAll('.screen').forEach(function (s) {
      s.classList.toggle('hidden', s.dataset.screen !== name);
    });
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('on', t.dataset.tab === name);
    });
    var r = RENDERERS[name];
    if (r) r(true);
  }
  function refresh() { invalidate(); var r = RENDERERS[ui.tab]; if (r) r(true); renderHud(); updateTimeUI(); }

  /* ---------------- 一键收割（收 + 汇总提示，压住逐株提示） ---------------- */
  var bulkHarvest = false;
  function harvestAll() {
    var n;
    bulkHarvest = true;
    try { n = eng.harvestAll(); } finally { bulkHarvest = false; }
    if (n.count) toast('收了三叶草 ×' + n.count + (n.fourLeaf ? '，还有四叶草 ×' + n.fourLeaf + '！' : ''));
    else toast('还没有长好的三叶草');
    return n;
  }

  /* ---------------- 引擎事件 → 提示 / 弹窗 ---------------- */
  function bindEngine() {
    eng.on(function (ev) {
      if (ev.type === 'return') {
        var t = ev.trip;
        var body = '<div class="postcard-view"><div class="photo">' +
          Art.sceneSVG((D.LOC_BY_ID[t.locId] || {}).scene || 'field', t.postcard.time, t.postcard.sceneId) + '</div>' +
          '<div class="cap">' + esc(t.postcard.caption) + '</div>' +
          '<div style="text-align:center;margin-top:6px"><span class="stamp">' + D.RARITY[t.postcard.rarity].name + '</span></div></div>' +
          '<div class="kv"><span>📍 ' + esc(t.locName) + '</span><span>🕒 ' + TIME_NAME[t.postcard.time] + '</span>' +
          '<span>🍀 +' + t.clover + '</span></div>' +
          '<div style="margin-top:9px">带回的特产：' + t.souvenirs.map(function (s) { return esc(s.name); }).join('、') + '</div>';
        openModal({ title: '明信片到了', body: body, buttons: [{ label: '收下', cls: 'm-primary' }] });
        refresh();
      } else if (ev.type === 'harvest') {
        if (!bulkHarvest) toast(ev.fourLeaf ? '收割：三叶草 +1，捡到四叶草！🍀🍀🍀🍀' : '三叶草 +1');
        refresh();
      } else if (ev.type === 'depart') {
        toast('青蛙出发了 · 目的地是秘密');
        refresh();
      } else if (ev.type === 'departing') {
        refresh();
      } else if (ev.type === 'visitor-arrive') {
        toast('蜗牛来门口等你了 🐌');
        refresh();
      } else if (ev.type === 'visitor-left') {
        toast('蜗牛等不到东西，走了');
        refresh();
      } else if (ev.type === 'visitor-fed') {
        toast('蜗牛回礼：三叶草 +' + ev.clover + (ev.gift ? '，还留下一件道具' : ''));
        refresh();
      } else if (ev.type === 'buy' || ev.type === 'sell' || ev.type === 'unpack') {
        refresh();
      }
    });
  }

  /* ---------------- 点击：事件委托 ---------------- */
  function bindClicks() {
    // 标签
    $('tabs').addEventListener('click', function (e) {
      var t = e.target.closest('.tab'); if (!t) return;
      showTab(t.dataset.tab);
    });
    // 田地
    $('garden').addEventListener('click', function (e) {
      var p = e.target.closest('[data-plot]'); if (!p) return;
      var got = eng.harvest(+p.dataset.plot);
      if (!got) toast('这株还没长好，再等等');
    });
    $('btn-harvest-all').onclick = harvestAll;
    $('go-log').onclick = function () { showTab('log'); };
    // 商店
    $('shop-seg').addEventListener('click', function (e) {
      var b = e.target.closest('.seg-btn'); if (!b) return;
      ui.shopKind = b.dataset.kind;
      document.querySelectorAll('#shop-seg .seg-btn').forEach(function (x) { x.classList.toggle('on', x === b); });
      invalidate(); renderShop();
    });
    $('shop-list').addEventListener('click', function (e) {
      var b = e.target.closest('[data-buy]'); if (!b) return;
      var parts = b.dataset.buy.split(':');
      if (eng.buy(parts[0], parts[1])) toast('买好了');
      else toast('三叶草不够');
    });
    // 行囊
    $('bag-food').addEventListener('click', function (e) {
      var r = e.target.closest('[data-pick-food]'); if (!r) return;
      var id = r.dataset.pickFood;
      ui.bagFood = ui.bagFood === id ? null : id;
      invalidate(); renderBag();
    });
    $('bag-item').addEventListener('click', function (e) {
      var r = e.target.closest('[data-pick-item]'); if (!r) return;
      var id = r.dataset.pickItem;
      var i = ui.bagItems.indexOf(id);
      if (i >= 0) ui.bagItems.splice(i, 1);
      else if (ui.bagItems.length >= 3) { toast('行囊最多塞 3 件道具'); return; }
      else ui.bagItems.push(id);
      invalidate(); renderBag();
    });
    $('btn-depart').onclick = function () {
      if (!ui.bagFood) return;
      if (!eng.pack(ui.bagFood, ui.bagItems)) return toast('库存不足');
      if (!eng.depart()) return toast('青蛙现在不能出门');
      ui.bagFood = null; ui.bagItems = [];
      invalidate();
      showTab('home');
      toast('青蛙开始收拾行李…');
    };
    // 图鉴
    $('album-grid').addEventListener('click', function (e) {
      var w = e.target.closest('[data-card]');
      if (!w) { toast('这部分还没拍到'); return; }
      var c = eng.view().album.filter(function (x) { return x.id === w.dataset.card; })[0];
      if (!c) return;
      var loc = D.LOC_BY_ID[c.locId];
      openModal({
        title: loc ? loc.name + ' · ' + TIME_NAME[c.time] : '明信片',
        body: '<div class="postcard-view"><div class="photo">' +
          Art.sceneSVG(loc ? loc.scene : 'field', c.time, c.sceneId) + '</div>' +
          '<div class="cap">' + esc(c.caption) + '</div>' +
          '<div style="text-align:center;margin-top:6px"><span class="stamp">' + D.RARITY[c.rarity].name + '</span></div></div>' +
          '<div class="kv"><span>第 ' + (c.tripIndex + 1) + ' 次旅行</span><span>' + ago(c.at) + '</span></div>',
        buttons: [{ label: '合上相册', cls: 'm-primary' }]
      });
    });
    // 特产
    $('stuff-list').addEventListener('click', function (e) {
      var s = e.target.closest('[data-sell]');
      if (s) {
        var g = eng.sellSouvenir(s.dataset.sell, 1);
        return g ? toast('卖了，三叶草 +' + g) : toast('卖不出去');
      }
      var f = e.target.closest('[data-feed]');
      if (f) {
        var r = eng.feedVisitor(f.dataset.feed);
        if (!r) toast('蜗牛已经走了');
        return;
      }
    });
    // 蜗牛
    $('visitor-spot').onclick = function () {
      if (eng.view().visitor.state !== 'waiting') return;
      var ids = Object.keys(eng.view().souvenirs).filter(function (k) { return eng.view().souvenirs[k] > 0; });
      if (!ids.length) { toast('还没有特产可以喂它'); showTab('stuff'); return; }
      showTab('stuff');
      toast('挑一件特产喂它吧');
    };
    // 弹窗遮罩
    $('modal').addEventListener('click', function (e) {
      if (e.target.id === 'modal') closeModal();
    });
    // 快进（调试用）
    $('btn-speed').onclick = function () {
      var evs = eng.advance(5 * 60 * 1000);
      toast('快进 5 分钟');
      if (!evs.some(function (e) { return e.type === 'return'; })) refresh();
    };
    // 菜单
    $('btn-menu').onclick = function () {
      var v = eng.view();
      openModal({
        title: '关于与设置',
        body: '<div style="line-height:1.8">' +
          '<b>称号：</b>' + esc(v.title) + '<br>' +
          '<b>明信片：</b>' + v.album.length + ' 张<br>' +
          '<b>出行次数：</b>' + v.stats.trips + ' 次　<b>喂过蜗牛：</b>' + v.stats.fed + ' 次<br>' +
          '<b>三叶草田：</b>' + eng.config.garden.plots + ' 格（约 ' + fmtDur(eng.config.garden.growMs) + ' 长一轮）<br><br>' +
          '<span style="opacity:.75">存档保存在本机，关掉再打开会按真实时间继续（青蛙可能已经回来了）。<br>' +
          '⏩ 按钮可以快进 5 分钟，方便测试。</span></div>',
        buttons: [
          { label: '重开一局', cls: 'm-ghost', onClick: function () { confirmReset(); return false; } },
          { label: '好', cls: 'm-primary' }
        ]
      });
    };
  }
  function confirmReset() {
    openModal({
      title: '确认重开一局？',
      body: '会清空三叶草、行囊、明信片册和特产，无法撤销。',
      buttons: [
        { label: '再想想', cls: 'm-ghost' },
        { label: '清空重开', cls: 'm-primary', onClick: function () { eng.reset(); ui.bagFood = null; ui.bagItems = []; invalidate(); refresh(); toast('重新开始了'); } }
      ]
    });
  }

  /* ---------------- 房间窗外的天色（跟着真实时间走） ---------------- */
  function applySky() {
    var h = new Date().getHours();
    var cls = (h >= 5 && h < 8) ? 'dawn' : (h >= 8 && h < 17) ? '' : (h >= 17 && h < 19.5) ? 'dusk' : 'night';
    var w = $('win-sky');
    w.className = 'win-sky' + (cls ? ' ' + cls : '');
  }

  /* ---------------- 入口 ---------------- */
  function init(engine) {
    eng = engine;
    el = {};
    bindEngine();
    bindClicks();
    applySky();
    renderHud();
    showTab('home');
    // 启动时的离线结算提示
    var evs = eng.catchUpEvents || [];
    var back = evs.filter(function (e) { return e.type === 'return'; });
    if (back.length) toast('青蛙在你离开的时候回来了');
    return { refresh: refresh, tick: updateTimeUI, showTab: showTab, toast: toast, openModal: openModal, ui: ui };
  }

  return {
    init: init,
    harvestAll: harvestAll,
    // 供 main.js 的轻量循环使用
    tick: function () { updateTimeUI(); },
    // 供测试/调试
    _internal: { fmtDur: fmtDur, stuffInfo: stuffInfo, applySky: applySky }
  };
});
