/* ============================================================
 * 御风启程 · 界面 (js/ui.js)
 * ------------------------------------------------------------
 * 单一职责：把引擎只读视图渲染成 DOM，把点击/拖动翻译成引擎动作。
 * 不含游戏规则（规则全在 engine.js）。两个画面模式：
 *   home   —— 出发台（树冠平台 + 三叶草畦 + 铃铛）
 *   flight —— 天空分层卷轴（自动巡航观看 / 滑翔段可操控）
 * 相位切换由引擎 tick 驱动，UI 只读相位；滑翔物理在 UI 帧循环里算，
 * 撞圈/撞云只回引擎记数，不推相位。新增输入设备 = 往 setPitch 喂值。
 * ============================================================ */
(function (root, factory) {
  root.TF = root.TF || {};
  root.TF.UI = factory(root.TF);
})(typeof window !== 'undefined' ? window : this, function (TF) {
  'use strict';

  var D = TF.DATA, W = TF.World, Sc = TF.Scene;
  var eng = null;
  var ui = {
    mode: 'home',              // home | flight
    fx: { scrollX: 0, scrollSpeed: 0, glide: null, wisps: [], lastT: 0 },
    mountBox: null, lastPhase: null, bannerTimer: 0
  };
  var sig = {};
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>\"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function changed(key, s) { if (sig[key] === s) return false; sig[key] = s; return true; }
  function invalidate() { sig = {}; }

  /* ---------------- 纸片提示（沿用：合并 + 上限） ---------------- */
  var MAX_SLIPS = 2;
  function toast(msg) {
    var host = $('slips');
    if (!host) return;
    var same = null;
    Array.prototype.forEach.call(host.children, function (n) { if (n.dataset.msg === msg) same = n; });
    if (same) {
      same.dataset.n = String((+same.dataset.n || 1) + 1);
      same.textContent = msg + ' ×' + same.dataset.n;
      clearTimeout(+same.dataset.timer);
      same.dataset.timer = String(setTimeout(function () { fade(same); }, 1900));
      return;
    }
    while (host.children.length >= MAX_SLIPS) host.removeChild(host.firstChild);
    var t = document.createElement('div');
    t.className = 'slip'; t.textContent = msg; t.dataset.msg = msg; t.dataset.n = '1';
    host.appendChild(t);
    t.dataset.timer = String(setTimeout(function () { fade(t); }, 1900));
  }
  function fade(node) {
    node.classList.add('out');
    setTimeout(function () { if (node.parentNode) node.remove(); }, 320);
  }

  /* ---------------- 弹窗 ---------------- */
  function openModalRaw(html) {
    var box = $('modal-box');
    box.innerHTML = html;
    $('modal').classList.remove('hidden');
    return box;
  }
  function openModal(opts) {
    var box = openModalRaw(
      '<div class="m-head"><span>' + esc(opts.title || '') + '</span>' +
      '<button class="m-close" data-m="close">✕</button></div>' +
      '<div class="m-body">' + (opts.body || '') + '</div>' +
      (opts.buttons && opts.buttons.length
        ? '<div class="m-foot">' + opts.buttons.map(function (b, i) {
          return '<button class="' + (b.cls || 'm-ghost') + '" data-m="btn" data-i="' + i + '">' + esc(b.label) + '</button>';
        }).join('') + '</div>'
        : ''));
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

  /* ---------------- 家模式 ---------------- */
  function timeOfDay(t) {
    var h = new Date(t).getHours();
    return h >= 19 || h < 5 ? 'night' : 'day';   // MVP：白天/夜行两档（19–5 夜，含凌晨）
  }

  function renderHome(v, force) {
    var key = 'home|' + v.ride + '|' + JSON.stringify(v.patch) + '|' + v.clovers + '|' + v.cooldownLeft;
    if (force || changed('home', key)) {
      var night = timeOfDay(v.t);
      $('scene').innerHTML = W.launchScene(night, v.patch.map(function (p) { return p.ripe; }));
      /* 热区：三叶草畦 + 铃铛（坐标来源 = world.LAUNCH_HOTSPOTS） */
      var H = W.LAUNCH_HOTSPOTS;
      var hits = v.patch.map(function (p, i) {
        var x = H.patch.x - H.patch.w / 2 + 8 + i * 15;
        return '<button class="hit' + (p.ripe ? ' ripe' : '') + '" data-patch="' + i +
          '" style="left:' + (x / 320 * 100).toFixed(2) + '%;top:' + ((H.patch.y - 12) / 700 * 100).toFixed(2) +
          '%;width:9%;height:8%" aria-label="三叶草 ' + (i + 1) + '"></button>';
      }).join('');
      var bellReady = !v.ride && !v.cooldownLeft;
      hits += '<button class="hit hit-bell' + (bellReady ? ' ready' : '') + '" data-bell="1" ' +
        'style="left:' + ((H.bell.x - H.bell.w / 2) / 320 * 100).toFixed(2) + '%;top:' + ((H.bell.y - H.bell.h / 2) / 700 * 100).toFixed(2) +
        '%;width:11%;height:20%" aria-label="摇铃召唤坐骑"></button>';
      $('scene-hits').innerHTML = hits;
      /* 坐骑飞入（召唤阶段）——只在 home 模式管 mount-box，飞行模式由 enterFlight 管 */
      var mb = $('mount-box');
      if (ui.mode !== 'home') { /* 不动 */ }
      else if (v.ride && (v.ride.phase === 'summoning' || v.ride.phase === 'boarding')) {
        mb.classList.remove('hidden');
        mb.classList.add('arriving');
        mb.innerHTML = W.mountSVG(v.ride.mountId, false);
        if (v.ride.phase === 'boarding') mb.classList.add('landed');
      } else if (v.ride) {
        mb.classList.add('hidden');
      } else {
        mb.classList.add('hidden');
      }
    }
    $('num-clover').textContent = v.clovers;
    var bell = $('btn-bell');
    bell.classList.toggle('hidden', !(!v.ride && !v.cooldownLeft));
  }

  /* ---------------- 飞行模式 ---------------- */
  var skyCache = {};
  /* data URI：必须加引号——SVG 里 url(#fsky) 的括号不会被 encodeURIComponent 编码，
     裸 url() 记号会被数据里的第一个 ) 提前掐断，Chrome 整个丢弃声明 */
  function dataUri(svg) {
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg).replace(/'/g, '%27') + '")';
  }
  function enterFlight(v) {
    ui.mode = 'flight';
    $('scene').classList.add('hidden');
    $('sky-layers').classList.remove('hidden');
    $('mount-box').classList.remove('hidden');
    $('mount-box').classList.remove('arriving', 'landed');
    var mountId = v.ride.mountId;
    if (!skyCache[mountId]) {
      var L = W.skyLayers(mountId);
      skyCache[mountId] = {};
      ['bg', 'far', 'mid', 'near'].forEach(function (k) {
        skyCache[mountId][k] = dataUri(L[k]);
      });
    }
    var C = skyCache[mountId];
    $('lay-bg').style.backgroundImage = C.bg;
    $('lay-far').style.backgroundImage = C.far;
    $('lay-mid').style.backgroundImage = C.mid;
    $('lay-near').style.backgroundImage = C.near;
    $('sky-layers').dataset.mount = mountId;    // jsdom 读不回 data:image 的 style，留一个可断言的数据标记
    $('mount-box').innerHTML = W.mountSVG(mountId, D.MOUNT_BY_ID[mountId].dayNight === 'night');
    ui.fx.scrollX = 0;
    ui.fx.scrollSpeed = D.CONFIG.skySpeed * (D.MOUNT_BY_ID[mountId].speed || 1);
    ui.fx.wisps = [];
    ui.fx.glide = null;
    banner('起飞啦！' + (D.MOUNT_BY_ID[mountId] ? D.MOUNT_BY_ID[mountId].name : '') + '载着小鸡出发');
  }
  function exitFlight() {
    ui.mode = 'home';
    $('scene').classList.remove('hidden');
    $('sky-layers').classList.add('hidden');
    $('mount-box').classList.add('hidden');
    $('flight-hud').classList.add('hidden');
    $('flight-fx').innerHTML = '';
    $('phase-banner').classList.add('hidden');
    ui.fx.glide = null;
    ui.fx.wisps = [];
    invalidate();
  }

  function banner(text) {
    var b = $('phase-banner');
    b.textContent = text;
    b.classList.remove('hidden');
    b.classList.remove('pop');
    void b.offsetWidth;
    b.classList.add('pop');
    clearTimeout(ui.bannerTimer);
    ui.bannerTimer = setTimeout(function () { b.classList.add('hidden'); }, 2600);
  }

  function startGlide() {
    var g = {
      y: 0, vy: 0, pitch: 0,
      rings: [], clouds: [], thermals: [],
      collected: 0, lastT: performance.now(),
      cloudSlowUntil: 0
    };
    /* 生成一圈道具：从右往左排开（屏幕坐标用百分比 x，y 居中偏上） */
    var n = D.GLIDE.rings;
    for (var i = 0; i < n; i++) {
      g.rings.push({ x: 92 + i * 26 + Math.random() * 8, y: 18 + Math.random() * 40, hit: false });
    }
    for (i = 0; i < 4; i++) {
      g.clouds.push({ x: 110 + i * 34 + Math.random() * 14, y: 12 + Math.random() * 56, w: 13, h: 9 });
    }
    for (i = 0; i < 3; i++) {
      g.thermals.push({ x: 100 + i * 38 + Math.random() * 12, y: 40 + Math.random() * 30, w: 9, h: 16 });
    }
    ui.fx.glide = g;
    renderGlideFX();
    banner('滑翔段！拖动屏幕上下——乘气流、穿光圈、躲乌云');
  }
  function renderGlideFX() {
    var g = ui.fx.glide;
    var host = $('flight-fx');
    var html = '';
    g.rings.forEach(function (r, i) {
      if (r.hit) return;
      html += '<div class="fx-ring" data-ring="' + i + '" style="left:' + r.x.toFixed(1) + '%;top:' + r.y.toFixed(1) + '%">' + W.ringSVG() + '</div>';
    });
    g.clouds.forEach(function (c, i) {
      html += '<div class="fx-cloud" data-cloud="' + i + '" style="left:' + c.x.toFixed(1) + '%;top:' + c.y.toFixed(1) + '%;width:' + c.w + '%;">' + W.stormCloudSVG() + '</div>';
    });
    g.thermals.forEach(function (t, i) {
      html += '<div class="fx-thermal" data-thermal="' + i + '" style="left:' + t.x.toFixed(1) + '%;top:' + t.y.toFixed(1) + '%;width:' + t.w + '%;">' + W.thermalSVG() + '</div>';
    });
    host.innerHTML = html;
  }

  /* ---------------- 飞行帧（rAF）：卷轴 + 滑翔物理 + 碰撞 ---------------- */
  var MOUNT_X = 26;   // 坐骑屏幕位置（%，从左上）
  function flightFrame(now) {
    var v = eng.view();
    var r = v.ride;
    if (!r || (r.phase !== 'flying' && r.phase !== 'gliding')) return;
    var fx = ui.fx;
    var dt = Math.min(64, now - (fx.lastT || now));
    fx.lastT = now;
    var mount = D.MOUNT_BY_ID[r.mountId];
    var speed = fx.scrollSpeed;

    if (r.phase === 'gliding' && !fx.glide) startGlide();
    var g = fx.glide;

    /* 滑翔物理 */
    if (g) {
      var slowed = now < g.cloudSlowUntil;
      if (slowed) speed *= D.GLIDE.cloudSlow;
      g.vy += g.pitch * 900 * (dt / 1000);
      g.vy *= Math.pow(0.996, dt / 16.7);
      g.y += g.vy * (dt / 1000);
      g.y = Math.max(-30, Math.min(30, g.y));
      /* 热区判定（坐骑位置 vs 道具位置） */
      var H = window.innerHeight || 600;
      var mx = MOUNT_X + 9, my = 34 + g.y * 0.16;    // 坐骑中心（%）
      g.thermals.forEach(function (t) {
        if (Math.abs(t.x - mx) < t.w && Math.abs(t.y - my) < t.h * 0.6) g.vy -= 34 * (dt / 1000) * (mount.glideLift || 1);
      });
      g.clouds.forEach(function (c) {
        if (Math.abs(c.x - mx) < c.w * 0.8 && Math.abs(c.y - my) < c.h * 0.9) {
          if (!c.hit) { c.hit = true; g.cloudSlowUntil = now + 900; eng.cloudHit(); toast('撞进乌云里了'); }
        }
      });
      g.rings.forEach(function (rg) {
        if (!rg.hit && Math.abs(rg.x - mx) < 4.5 && Math.abs(rg.y - my) < 4.5) {
          rg.hit = true; g.collected++;
          var res = eng.glideRing();
          var node = document.querySelector('[data-ring="' + g.rings.indexOf(rg) + '"]');
          if (node) node.classList.add('got');
          toast('光圈 +1 三叶草');
          if (g.rings.every(function (x) { return x.hit; })) banner('光圈全收！');
        }
      });
    }

    /* 卷轴推进（百分比取模：不依赖层的像素宽，容器任意尺寸都对） */
    fx.scrollX = (fx.scrollX + speed * dt / 1000) % 640;
    var shX = (-fx.scrollX / 640 * 100) + '%';
    $('lay-far').style.backgroundPositionX = shX;
    $('lay-mid').style.backgroundPositionX = shX;
    $('lay-near').style.backgroundPositionX = shX;

    /* 坐骑颠簸 + 滑翔位姿 */
    var bob = Math.sin(now / 300) * (mount.bobbing || 3);
    var tilt = g ? -g.pitch * 6 : Math.sin(now / 260) * 2;
    var yOff = g ? g.y * (window.innerHeight || 600) / 220 : bob;
    $('mount-box').style.transform = 'translateY(' + (yOff * 0.9).toFixed(1) + 'px) rotate(' + tilt.toFixed(1) + 'deg)';

    /* 浮游三叶草：自动段生成 + 漂移 + 点击收 */
    if (!g && Math.random() < dt / 2600) {
      fx.wisps.push({ x: 96, y: 12 + Math.random() * 60, id: 'w' + Math.random().toString(36).slice(2) });
      var wh = $('flight-fx');
      if (wh && fx.wisps.length < 8) {
        wh.insertAdjacentHTML('beforeend', '<button class="fx-wisp" data-wisp="' + fx.wisps[fx.wisps.length - 1].id +
          '" style="left:96%;top:' + fx.wisps[fx.wisps.length - 1].y.toFixed(1) + '%">' + W.wispSVG() + '</button>');
      }
    }
    fx.wisps.forEach(function (wp) {
      wp.x -= speed * dt / 1000 / 6.4;   // 屏幕宽的百分比
      var node = document.querySelector('[data-wisp="' + wp.id + '"]');
      if (wp.x < -10) {
        if (node) node.remove();
        fx.wisps.splice(fx.wisps.indexOf(wp), 1);
      } else if (node) {
        node.style.left = wp.x + '%';
      }
    });

    /* HUD */
    var prog = $('flight-prog');
    if (prog) prog.style.width = Math.round((r.progress || 0) * 100) + '%';
    var dist = Math.round((v.t - r.departAt) * 0.02 * (mount.speed || 1));
    $('flight-dist').textContent = dist + ' 米';
  }

  /* ---------------- 主渲染：按相位切模式 ---------------- */
  function render(force) {
    var v = eng.view();
    var r = v.ride;
    var inFlight = r && (r.phase === 'flying' || r.phase === 'gliding');
    if (inFlight && ui.mode !== 'flight') enterFlight(v);
    if (!inFlight && ui.mode !== 'home') exitFlight();

    if (r && r.phase === 'landed' && !sig.settleShown) {
      sig.settleShown = true;
      showSettle(v, r);
    }
    if (!r) sig.settleShown = false;

    if (ui.mode === 'home') {
      renderHome(v, force);
      /* 滑翔提示牌只在家里/飞行 HUD 出现 */
      $('flight-hud').classList.add('hidden');
    } else {
      renderHome(v, force);   // 计数片也要更新
      $('flight-hud').classList.remove('hidden');
      var g = ui.fx.glide;
      $('glide-hint').classList.toggle('hidden', !(r.phase === 'gliding'));
      if (r.phase !== 'gliding' && g) { ui.fx.glide = null; $('flight-fx').innerHTML = ''; }
    }
    guideRender();
  }

  /* ---------------- 结算卡 ---------------- */
  function showSettle(v, r) {
    var l = r.loot || eng.previewLoot(r, v.t);
    var dest = D.DEST_BY_ID[r.destId] || {};
    var mount = D.MOUNT_BY_ID[r.mountId] || {};
    var row = function (label, val) {
      return '<div class="kv-row"><span>' + label + '</span><b>' + val + '</b></div>';
    };
    openModal({
      title: '抵达「' + esc(dest.name || '?') + '」',
      body: '<div class="settle-card">' + W.settleCardSVG(r.destId, r.mountId) + '</div>' +
        '<div class="kv">' +
        row('飞行', l.meters + ' 米') +
        row('里程', '+' + l.distClovers) +
        row('光圈', '+' + l.ringClovers) +
        row('顺手摘', '+' + l.autoPick) +
        '</div>' +
        '<div class="memento">纪念品 · ' + esc(l.memento || '—') + '</div>',
      buttons: [{ label: '收下', cls: 'm-primary', onClick: function () { eng.settle(); refresh(); } }]
    });
  }

  /* ---------------- 新手引导（状态推导，跳过存档） ---------------- */
  var GUIDE_STEPS = {
    summon: { tip: '摇一摇铃铛，坐骑会飞过来接小鸡', target: '[data-bell]' },
    board: { tip: '坐骑落地了 —— 点它一下，登机出发', target: '#mount-box' },
    glide: { tip: '滑翔段！按住屏幕上下拖动，穿越光圈', target: null }
  };
  function onboardStep(v) {
    if (v.onboarded || v.tripCount > 0) return null;
    if (!v.ride) return 'summon';
    if (v.ride.phase === 'summoning' || v.ride.phase === 'boarding') return 'board';
    if (v.ride.phase === 'gliding') return 'glide';
    return null;
  }
  function guideRender() {
    var v = eng.view();
    var step = onboardStep(v);
    var g = $('guide');
    if (!step) { g.classList.add('hidden'); return; }
    var def = GUIDE_STEPS[step];
    $('guide-tip').textContent = def.tip;
    g.classList.remove('hidden');
    var target = def.target ? document.querySelector(def.target) : null;
    var ring = $('guide-ring');
    if (!target) { ring.style.display = 'none'; return; }
    ring.style.display = '';
    var r = target.getBoundingClientRect();
    ring.style.left = Math.round(r.left + r.width / 2) + 'px';
    ring.style.top = Math.round(r.top + r.height / 2) + 'px';
  }
  function guideOff() { $('guide').classList.add('hidden'); }

  /* ---------------- 操作 ---------------- */
  function tapBell() {
    var v = eng.view();
    if (v.ride) return toast('已经有坐骑了');
    var res = eng.summon();
    if (!res.ok) {
      if (res.reason === 'cooldown') toast('刚飞回来，坐骑要歇会儿（' + Math.ceil(v.cooldownLeft / 1000) + ' 秒）');
      return;
    }
    toast('铃铛响了……');
    refresh();
  }
  function tapMount() {
    var v = eng.view();
    var r = v.ride;
    if (!r) return;
    if (r.phase === 'boarding') {
      var res = eng.board();
      if (res.ok) {
        if (!eng.view().onboarded) eng.markOnboarded();
        toast('起飞！');
        refresh();
      }
    }
  }
  function tapPatch(i) {
    var res = eng.harvestPatch(i);
    if (res.ok) toast('三叶草 +1');
    else if (res.reason === 'not-ripe') toast('还没长好，再等等');
    refresh();
  }
  function tapWisp(id) {
    var res = eng.collectAutoPick();
    if (res.ok) {
      var node = document.querySelector('[data-wisp="' + id + '"]');
      if (node) { node.classList.add('got'); setTimeout(function () { node.remove(); }, 300); }
      var ws = ui.fx.wisps;
      for (var i = 0; i < ws.length; i++) if (ws[i].id === id) { ws.splice(i, 1); break; }
      toast('摘到浮游三叶草');
    }
  }

  /* 滑翔操控：外部输入（指针/键盘/体感）都走这一个口 */
  function setPitch(v) {
    if (ui.fx.glide) ui.fx.glide.pitch = Math.max(-1, Math.min(1, v));
  }
  function harvestAll() {
    var n = eng.harvestAll();
    if (n.got) toast('收了三叶草 ×' + n.got);
    else toast('还没有长好的三叶草');
    refresh();
  }

  /* ---------------- 引擎事件 ---------------- */
  function bindEngine() {
    eng.on(function (ev) {
      if (ev.type === 'summoned') {
        refresh();
      } else if (ev.type === 'departed') {
        refresh();
      } else if (ev.type === 'glide-start') {
        if (ui.mode === 'flight') startGlide();
      } else if (ev.type === 'glide-end') {
        ui.fx.glide = null;
        $('flight-fx').innerHTML = '';
      } else if (ev.type === 'landed') {
        refresh();
      } else if (ev.type === 'settled') {
        refresh();
      } else if (ev.type === 'harvest') {
        refresh();
      }
    });
  }

  /* ---------------- 菜单 ---------------- */
  function renderMenu(force) {
    var v = eng.view();
    var key = 'menu|' + v.tripCount + '|' + v.mementos.join(',') + '|' + v.clovers;
    if (!force && !changed('menu', key)) return;
    $('menu-status').innerHTML =
      '<div class="kv-row"><span>旅程</span><b>' + v.tripCount + ' 次</b></div>' +
      '<div class="kv-row"><span>三叶草</span><b>' + v.clovers + '</b></div>' +
      '<div class="kv-row"><span>纪念品</span><b>' + (v.mementos.length ? v.mementos.join(' · ') : '还没有') + '</b></div>' +
      '<div class="hint-line">存档在本机，关掉再打开会按真实时间继续。三叶草在出发台长，摇铃召唤坐骑出发。</div>' +
      '<div class="menu-btns">' +
      '<button class="mini" id="btn-motion">开启体感</button>' +
      '<button class="mini" id="btn-reset">重开一局</button>' +
      '</div>';
    var rb = $('btn-reset');
    if (rb) rb.onclick = confirmReset;
    var mb = $('btn-motion');
    if (mb) {
      if (!(TF.Input && TF.Input.supported)) mb.style.display = 'none';
      else mb.onclick = function () { TF.Input.open(); };
    }
  }
  function openSheet(name) {
    ui.sheet = name;
    $('sheet-menu').classList.toggle('hidden', name !== 'menu');
    if (name === 'menu') renderMenu(true);
    guideRender();
  }
  function closeSheet() { ui.sheet = null; $('sheet-menu').classList.add('hidden'); }

  function confirmReset() {
    openModal({
      title: '确认重开一局？',
      body: '会清空三叶草、纪念品和旅程记录，无法撤销。',
      buttons: [
        { label: '再想想', cls: 'm-ghost' },
        { label: '清空重开', cls: 'm-primary', onClick: function () {
          try { localStorage.removeItem(D.CONFIG.saveKey); } catch (e) {}
          location.reload();
        } }
      ]
    });
  }

  function refresh() { invalidate(); render(true); }

  /* ---------------- 入口 ---------------- */
  function init(engine) {
    eng = engine;
    bindEngine();
    bindClicks();
    bindFlightInput();
    $('btn-menu').onclick = function () { openSheet('menu'); };
    $('guide-skip').onclick = function () { eng.markOnboarded(); guideOff(); };
    document.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = closeSheet; });
    render(true);
    window.addEventListener('resize', function () { invalidate(); render(true); }, { passive: true });
    return { refresh: refresh, tick: tick, flightFrame: flightFrame, toast: toast, setPitch: setPitch, guideOff: guideOff, ui: ui };
  }

  function bindClicks() {
    $('scene-hits').addEventListener('click', function (e) {
      var p = e.target.closest('[data-patch]');
      if (p) return tapPatch(+p.dataset.patch);
      var b = e.target.closest('[data-bell]');
      if (b) return tapBell();
    });
    $('btn-bell').onclick = tapBell;
    $('mount-box').addEventListener('click', tapMount);
    $('flight-fx').addEventListener('click', function (e) {
      var w = e.target.closest('[data-wisp]');
      if (w) tapWisp(w.dataset.wisp);
    });
  }

  /* ---------------- 飞行输入策略表：指针拖动 / 方向键；体感走 setPitch ---------------- */
  function bindFlightInput() {
    var dragging = false;
    $('stage').addEventListener('pointerdown', function (e) {
      var v = eng.view();
      if (!v.ride || v.ride.phase !== 'gliding') return;
      dragging = true;
      ui.fx.glide && (ui.fx.glide.pointerY = e.clientY);
    });
    window.addEventListener('pointermove', function (e) {
      if (!dragging || !ui.fx.glide) return;
      var dy = (ui.fx.glide.pointerY - e.clientY);
      ui.fx.glide.pointerY = e.clientY;
      var H = window.innerHeight || 600;
      ui.fx.glide.pitch = Math.max(-1, Math.min(1, dy / (H * 0.25)));
    });
    window.addEventListener('pointerup', function () { dragging = false; });
    window.addEventListener('keydown', function (e) {
      var v = eng.view();
      if (!v.ride || v.ride.phase !== 'gliding') return;
      if (e.key === 'ArrowUp') { setPitch(-1); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { setPitch(1); e.preventDefault(); }
    });
    window.addEventListener('keyup', function (e) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') setPitch(0);
    });
  }

  /* ---------------- 轻量 tick（250ms，从 main 调）：只更新计数/进度 ---------------- */
  function tick() {
    var v = eng.view();
    $('num-clover').textContent = v.clovers;
    render(false);
  }

  return {
    init: init,
    tick: tick,
    flightFrame: flightFrame,
    setPitch: setPitch,
    harvestAll: harvestAll,
    openSheet: openSheet,
    closeSheet: closeSheet,
    guideOff: guideOff,
    refresh: refresh,
    toast: toast,
    ui: ui
  };
});
