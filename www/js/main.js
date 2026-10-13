/* ============================================================
 * 旅行青蛙 · 启动 (js/main.js)
 * ------------------------------------------------------------
 * 单一职责：装配。把引擎挂上真实时钟与 localStorage，启动主循环，
 * 处理存活期（自动存盘 / 回到前台 / 离线追赶），再挂上可选输入：
 *   键盘（桌面调试）· 体感（智能戒指倾斜切页 / 手杖轻敲收草）· 语音（智能眼镜）
 * 参数：?fast=N 加速 N 倍（调试）；?reset=1 清档。
 * ============================================================ */
(function () {
  'use strict';
  var TF = window.TF;

  /* ---------- 启动参数 ---------- */
  var qs = new URLSearchParams(location.search);
  var TABS = ['home', 'shop', 'bag', 'album', 'stuff', 'log'];
  var timeScale = Math.max(1, Math.min(200, Number(qs.get('fast')) || 1));
  if (qs.get('reset') === '1') { try { localStorage.removeItem(TF.DATA.CONFIG.saveKey); } catch (e) {} }

  /* ---------- 存档介质：优先 localStorage，被拒就退回内存（至少本次能玩） ---------- */
  function pickStorage() {
    try {
      var s = window.localStorage;
      s.setItem('__tf_probe', '1');
      s.removeItem('__tf_probe');
      return { storage: s, persistent: true };
    } catch (e) {
      // 某些浏览器在 file:// / 无痕模式下会直接抛 SecurityError，不能让整个游戏跟着崩
      return { storage: TF.Engine.memStorage(), persistent: false };
    }
  }
  var picked = pickStorage();

  /* ---------- 引擎：真实时钟 + 上面选定的存档介质 ---------- */
  var engine = TF.Engine.createEngine({
    now: function () { return Date.now(); },
    storage: picked.storage,
    config: { timeScale: timeScale }
  });

  /* ---------- 界面 ---------- */
  var UI = TF.UI.init(engine);
  /* 深链：?tab=album 之类，方便截图 / 调试 / 从通知直接进某个页面 */
  var startTab = qs.get('tab');
  if (startTab && TABS.indexOf(startTab) >= 0) UI.showTab(startTab);

  /* ---------- 主循环：250ms 推一格时间 + 刷新时间相关 UI ---------- */
  var last = 0;
  function loop() {
    var now = Date.now();
    if (now - last >= 250) {
      last = now;
      engine.tick(now);        // 到点的事件（归来 / 蜗牛 / 出发）会经事件回调刷新界面
      UI.tick();               // 轻量：生长条 / 行程进度 / 倒计时
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  /* ---------- 存活期 ---------- */
  var AUTOSAVE_MS = 10000;
  setInterval(function () { engine.save(); }, AUTOSAVE_MS);
  /* 有实质变化就立刻落盘：不然刚收到明信片就被强杀，这次出行就白跑了 */
  var SAVE_ON = { return: 1, depart: 1, harvest: 1, buy: 1, sell: 1, 'visitor-fed': 1, 'visitor-arrive': 1 };
  engine.on(function (ev) { if (SAVE_ON[ev.type]) engine.save(); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { engine.save(); return; }
    engine.tick(Date.now());   // 回到前台：把离开期间的时间补上
    if (UI.refresh) UI.refresh();
    UI.tick();
  });
  window.addEventListener('pagehide', function () { engine.save(); });
  window.addEventListener('beforeunload', function () { engine.save(); });

  /* ---------- 键盘（桌面调试用） ---------- */
  window.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var i = TABS.indexOf(e.key);
    if (i >= 0 || (e.key >= '1' && e.key <= '6')) { UI.showTab(TABS[(+e.key || i + 1) - 1]); return; }
    if (e.key === 'h' || e.key === 'H') UI.harvestAll();
    if (e.key === 'f' || e.key === 'F') { engine.advance(5 * 60 * 1000); UI.refresh(); UI.toast('快进 5 分钟'); }
  });

  /* ---------- 体感输入：智能戒指 / 手杖 ---------- */
  var Input = {
    enabled: false,
    ringLastTilt: 0,
    caneLastTap: 0,
    supported: typeof window.DeviceOrientationEvent !== 'undefined' || typeof window.DeviceMotionEvent !== 'undefined',
    needsPermission: typeof window.DeviceOrientationEvent !== 'undefined' &&
      typeof window.DeviceOrientationEvent.requestPermission === 'function'
  };
  function currentTab() {
    var on = document.querySelector('.tab.on');
    return on && on.dataset.tab ? on.dataset.tab : 'home';
  }
  function onOrient(e) {
    if (!Input.enabled) return;
    var gamma = e.gamma || 0;                       // 左右倾斜
    var now = Date.now();
    if (Math.abs(gamma) < 12 || now - Input.ringLastTilt < 600) return;
    Input.ringLastTilt = now;
    var idx = Math.max(0, TABS.indexOf(currentTab()));
    var next = gamma > 0 ? (idx + 1) % TABS.length : (idx - 1 + TABS.length) % TABS.length;
    UI.showTab(TABS[next]);
  }
  function onMotion(e) {
    if (!Input.enabled) return;
    var a = e.accelerationIncludingGravity || {};
    var mag = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
    var now = Date.now();
    if (mag < 18 || now - Input.caneLastTap < 1200) return;   // 手杖轻敲：猛地一颠
    Input.caneLastTap = now;
    UI.harvestAll();
  }
  function enableInput() {
    Input.enabled = true;
    window.addEventListener('deviceorientation', onOrient);
    window.addEventListener('devicemotion', onMotion);
    UI.toast('体感已开启：倾斜（戒指）切页 · 轻敲（手杖）收草');
    var b = document.getElementById('btn-motion');
    if (b) { b.classList.add('on'); b.title = '体感已开启'; }
  }
  var motionBtn = document.getElementById('btn-motion');
  if (Input.supported) {
    motionBtn.classList.remove('hidden');
    motionBtn.onclick = function () {
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
  }

  /* ---------- 调试出口（DevTools / 自动化验证用） ---------- */
  TF.game = engine;
  TF.debug = {
    engine: engine,
    advance: function (ms) { var e = engine.advance(ms); UI.refresh(); return e; },
    fastForwardToReturn: function () {
      var s = engine.state;
      if (s.frog.state !== 'away') return null;
      return TF.debug.advance(Math.max(0, s.frog.backAt - Date.now()) + 1000);
    },
    tab: function (n) { UI.showTab(n); },
    state: function () { return engine.view(); }
  };

  /* ---------- 首次进入给一点点启动物资（免得干等着） ---------- */
  if (engine.isFresh) {
    engine.state.clover = 20;
    engine.state.log = [];
    engine.save();
    UI.toast('先收三叶草，再去商店买便当吧');
  }
  if (!picked.persistent) UI.toast('这个环境不让存档，本次进度关掉就没了');
})();
