/* ============================================================
 * 御风启程 · 启动 (js/main.js)
 * ------------------------------------------------------------
 * 单一职责：装配。引擎挂真实时钟与存档；主循环 250ms 推引擎 tick +
 * 每帧跑飞行动画（卷轴/滑翔物理）；存活期自动存盘；
 * 输入策略：指针/键盘（ui 内部）+ 体感（戒指倾斜=滑翔俯仰，手杖轻敲=收草）。
 * 参数：?fast=N 加速（调试）；?reset=1 清档。
 * ============================================================ */
(function () {
  'use strict';
  var TF = window.TF;

  var qs = new URLSearchParams(location.search);
  var timeScale = Math.max(1, Math.min(200, Number(qs.get('fast')) || 1));
  if (qs.get('reset') === '1') { try { localStorage.removeItem(TF.DATA.CONFIG.saveKey); } catch (e) {} }

  /* ---------- 存档介质：localStorage 被拒就退回内存 ---------- */
  function pickStorage() {
    try {
      var s = window.localStorage;
      s.setItem('__wr_probe', '1');
      s.removeItem('__wr_probe');
      return { storage: s, persistent: true };
    } catch (e) {
      return { storage: TF.Engine.memStorage(), persistent: false };
    }
  }
  var picked = pickStorage();

  /* ---------- 引擎 ---------- */
  var engine = TF.Engine.createEngine({
    now: function () { return Date.now() * timeScale; },
    storage: picked.storage
  });

  /* ---------- 界面 ---------- */
  var UI = TF.UI.init(engine);

  /* ---------- 主循环：250ms 引擎 tick + 每帧飞行动画 ---------- */
  var lastTick = 0;
  function loop(now) {
    if (!now) now = Date.now();
    if (now - lastTick >= 250) {
      lastTick = now;
      engine.tick(Date.now() * timeScale);
      UI.tick();
    }
    UI.flightFrame(now);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  /* ---------- 存活期 ---------- */
  setInterval(function () { engine.save(); }, 10000);
  var SAVE_ON = { summoned: 1, departed: 1, 'glide-start': 1, 'glide-end': 1, landed: 1, settled: 1, harvest: 1, pick: 1 };
  engine.on(function (ev) { if (SAVE_ON[ev.type]) engine.save(); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { engine.save(); return; }
    engine.tick(Date.now() * timeScale);
    UI.refresh();
    UI.tick();
  });
  window.addEventListener('pagehide', function () { engine.save(); });
  window.addEventListener('beforeunload', function () { engine.save(); });

  /* ---------- 键盘（桌面调试） ---------- */
  window.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '0' || e.key === 'Escape') { UI.closeSheet(); return; }
    if (e.key === 'h' || e.key === 'H') UI.harvestAll();
    if (e.key === 'f' || e.key === 'F') { engine.advance(5 * 60 * 1000); UI.refresh(); UI.toast('快进 5 分钟'); }
    if (e.key === 'm' || e.key === 'M') { UI.openSheet('menu'); }
  });

  /* ---------- 体感输入：戒指倾斜 = 滑翔俯仰；手杖轻敲 = 收草 ---------- */
  var Input = {
    enabled: false,
    ringLast: 0, caneLast: 0,
    supported: typeof window.DeviceOrientationEvent !== 'undefined' || typeof window.DeviceMotionEvent !== 'undefined',
    needsPermission: typeof window.DeviceOrientationEvent !== 'undefined' &&
      typeof window.DeviceOrientationEvent.requestPermission === 'function'
  };
  function onOrient(e) {
    if (!Input.enabled) return;
    var v = engine.view();
    if (!v.ride || v.ride.phase !== 'gliding') return;
    var beta = e.beta || 0;                      // 前后倾斜：-90..90，前倾为负
    UI.setPitch(-Math.max(-1, Math.min(1, (beta - 45) / 45)));
  }
  function onMotion(e) {
    if (!Input.enabled) return;
    var a = e.accelerationIncludingGravity || {};
    var mag = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
    var now = Date.now();
    if (mag < 18 || now - Input.caneLast < 1200) return;
    Input.caneLast = now;
    var v = engine.view();
    if (v.ride && v.ride.phase === 'gliding') { UI.setPitch(-1); setTimeout(function () { UI.setPitch(0); }, 260); return; }
    UI.harvestAll();
  }
  function enableInput() {
    Input.enabled = true;
    window.addEventListener('deviceorientation', onOrient);
    window.addEventListener('devicemotion', onMotion);
    UI.toast('体感已开启：戒指倾斜=滑翔俯仰 · 手杖轻敲=收草');
  }
  Input.open = function () {
    if (Input.enabled) { UI.toast('体感已经开着了'); return; }
    if (Input.needsPermission) {
      Promise.all([
        window.DeviceOrientationEvent.requestPermission(),
        window.DeviceMotionEvent.requestPermission()
      ]).then(function (rs) {
        if (rs.every(function (r) { return r === 'granted'; })) enableInput();
        else UI.toast('体感权限被拒绝了');
      }).catch(function () { UI.toast('这台设备不支持体感'); });
    } else {
      enableInput();
    }
  };
  TF.Input = Input;

  /* ---------- 调试出口 ---------- */
  TF.game = engine;
  TF.debug = {
    engine: engine,
    advance: function (ms) { var e = engine.advance(ms); UI.refresh(); return e; },
    fastForwardToLanding: function () {
      var v = engine.view();
      if (!v.ride) return null;
      if (v.ride.phase === 'flying' || v.ride.phase === 'gliding') return TF.debug.advance(Math.max(0, v.ride.backAt - v.t) + 1000);
      if (v.ride.phase === 'summoning' || v.ride.phase === 'boarding') return TF.debug.advance(Math.max(0, v.ride.backAt - v.t) + 1000);
      return null;
    },
    view: function () { return engine.view(); },
    state: function () { return engine.view(); },
    ui: UI
  };

  if (engine.isFresh) {
    engine.save();
    UI.toast('摇铃召唤坐骑，和小鸡一起去旅行');
  }
  if (!picked.persistent) UI.toast('这个环境不让存档，本次进度关掉就没了');
})();
