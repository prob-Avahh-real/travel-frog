/* ============================================================
 * 御风启程 · 界面端到端测试（Sensor）
 * 用 jsdom 真跑一遍 index.html：加载全部脚本 → 点按钮 → 断言 DOM。
 *   node --test test/*.test.js
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import jsdomPkg from 'jsdom';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole, requestInterceptor } = jsdomPkg;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = require(path.join(ROOT, 'js/data.js'));
const SAVE_KEY = DATA.CONFIG.saveKey;
const ORIGIN = 'http://localhost';
const MIME = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html' };

function localFiles() {
  return requestInterceptor((request) => {
    const u = new URL(request.url);
    if (u.origin !== ORIGIN) return undefined;
    const rel = decodeURIComponent(u.pathname).replace(/^\//, '');
    const type = MIME[path.extname(rel)] || 'application/octet-stream';
    if (rel.endsWith('.css')) return new Response('', { headers: { 'Content-Type': 'text/css' } });
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) return new Response('not found', { status: 404 });
    return new Response(fs.readFileSync(file), { headers: { 'Content-Type': type } });
  });
}

async function boot(seed) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const problems = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => problems.push('jsdomError: ' + (e && e.message)));
  vc.on('error', (...a) => problems.push('console.error: ' + a.map(String).join(' ')));
  vc.on('warn', () => {});

  const dom = new JSDOM(html, {
    url: ORIGIN + '/index.html',
    runScripts: 'dangerously',
    resources: { interceptors: [localFiles()] },
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      if (seed) window.localStorage.setItem(SAVE_KEY, seed);
    },
  });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('页面加载超时')), 15000);
    dom.window.addEventListener('load', () => { clearTimeout(t); res(); });
  });
  await new Promise((r) => setTimeout(r, 80));

  const w = dom.window;
  return {
    dom, w, problems,
    q: (s) => w.document.querySelector(s),
    qa: (s) => [...w.document.querySelectorAll(s)],
    click: (elm) => {
      assert.ok(elm, '要点击的元素不存在');
      elm.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
    },
    visible: (s) => !!w.document.querySelector(s),
    assertClean() {
      const bad = problems.filter((p) => !/Not implemented/.test(p));
      assert.deepEqual(bad, [], '页面不该有脚本错误');
    },
    save: () => JSON.parse(w.localStorage.getItem(SAVE_KEY) || 'null'),
    close: () => { try { dom.window.close(); } catch (e) {} },
  };
}

/* ---------------- 1. 首屏：出发台 ---------------- */
test('ui: 页面能起来、无脚本错误，首屏是树冠出发台', async () => {
  const t = await boot();
  try {
    assert.ok(t.q('#scene svg.scene-svg'), '出发台场景应渲染');
    assert.ok(t.q('#scene .rider'), '小鸡应站在出发台上');
    assert.equal(t.qa('#scene-hits .hit[data-patch]').length, DATA.CONFIG.patchCount, '三叶草畦应有热区');
    assert.equal(t.qa('#scene-hits .hit.ripe').length, DATA.CONFIG.patchCount, '开局三叶草应已长好');
    assert.ok(t.q('#scene-hits .hit-bell'), '应有摇铃热区');
    assert.equal(t.q('#num-clover').textContent, '8', '开局送 8 三叶草');
    /* 旧界面必须已拆除 */
    assert.equal(t.q('#tabs'), null);
    assert.equal(t.qa('.dock-btn').length, 0);
    assert.equal(t.q('#go-shop'), null);
    assert.equal(t.q('#btn-pack'), null);
    /* 开局显示新手引导（摇铃） */
    assert.ok(!t.q('#guide').classList.contains('hidden'), '新存档应显示引导');
    assert.ok(/铃/.test(t.q('#guide-tip').textContent), '第一步应是摇铃');
    t.assertClean();
  } finally { t.close(); }
});

/* ---------------- 2. 完整旅程：摇铃→登机→飞→滑→结算 ---------------- */
test('ui: 摇铃召唤 → 坐骑落地 → 登机起飞 → 滑翔段 → 落地结算', async () => {
  const t = await boot();
  try {
    /* 1. 收草 */
    t.click(t.q('#scene-hits .hit.ripe'));
    assert.equal(t.qa('#scene-hits .hit.ripe').length, DATA.CONFIG.patchCount - 1, '收掉一株');

    /* 2. 摇铃 → 召唤 */
    t.click(t.q('#scene-hits .hit-bell'));
    assert.equal(t.w.TF.game.view().ride.phase, 'summoning');
    assert.ok(t.visible('#mount-box:not(.hidden)'), '坐骑应飞来');
    assert.ok(t.q('#mount-box .mount-svg'), '坐骑应有造型');

    /* 3. 落地 → 登机（点坐骑） */
    t.w.TF.debug.advance(DATA.CONFIG.summonMs + 500);
    assert.equal(t.w.TF.game.view().ride.phase, 'boarding');
    t.click(t.q('#mount-box'));
    assert.equal(t.w.TF.game.view().ride.phase, 'flying', '登机后应起飞');

    /* 4. 飞行：天空分层 + 坐骑 + HUD */
    assert.ok(t.visible('#sky-layers:not(.hidden)'), '应切到天空层');
    assert.ok(t.visible('#flight-hud:not(.hidden)'), '飞行 HUD 应可见');
    assert.ok(t.q('#mount-box .mount-svg'), '坐骑应在天上');
    const liveMount = t.w.TF.game.view().ride.mountId;
    assert.ok(['glider', 'ptero', 'east', 'paper', 'owl', 'west'].includes(liveMount), '坐骑 id 应合法');
    assert.equal(t.q('#sky-layers').dataset.mount, liveMount, '天空层应按坐骑挂载');

    /* 5. 到点进入滑翔段：道具生成 + 提示 */
    t.w.TF.debug.advance(DATA.CONFIG.glideAtMs + 500);
    assert.equal(t.w.TF.game.view().ride.phase, 'gliding');
    assert.ok(t.qa('#flight-fx .fx-ring').length >= 3, '应有光圈');
    assert.ok(t.qa('#flight-fx .fx-cloud').length >= 3, '应有乌云');
    assert.ok(t.qa('#flight-fx .fx-thermal').length >= 2, '应有气流');
    assert.ok(!t.q('#glide-hint').classList.contains('hidden'), '应有操控提示');

    /* 6. 滑翔结束回巡航，最终落地弹结算卡 */
    t.w.TF.debug.advance(DATA.CONFIG.glideLenMs + 500);
    assert.equal(t.w.TF.game.view().ride.phase, 'flying');
    t.w.TF.debug.fastForwardToLanding();
    assert.equal(t.w.TF.game.view().ride.phase, 'landed');
    assert.ok(t.visible('#modal:not(.hidden)'), '落地应弹结算卡');
    assert.ok(t.q('#modal-box .settle-card svg'), '结算卡里应有目的地画面');
    assert.ok(/飞行/.test(t.q('#modal-box').textContent), '应显示里程');
    assert.ok(/纪念品/.test(t.q('#modal-box').textContent), '应显示纪念品');

    /* 7. 收下 → 回家 */
    t.click(t.q('#modal-box .m-primary'));
    assert.equal(t.w.TF.game.view().ride, null);
    assert.equal(t.w.TF.game.view().tripCount, 1);
    assert.ok(t.q('#scene svg.scene-svg'), '应回到出发台');
    assert.equal(t.w.TF.game.view().onboarded, true, '第一次出发应标记引导完成');
    t.assertClean();
  } finally { t.close(); }
});

/* ---------------- 3. 离线追赶 ---------------- */
test('ui: 飞行中关掉重开——接着飞；越过落地时间——待结算', async () => {
  const a = await boot();
  let snapshot = null;
  try {
    a.click(a.q('#scene-hits .hit-bell'));
    a.w.TF.debug.advance(DATA.CONFIG.summonMs + 500);
    a.click(a.q('#mount-box'));
    assert.equal(a.w.TF.game.view().ride.phase, 'flying');
    a.w.TF.game.save();
    snapshot = a.w.localStorage.getItem(SAVE_KEY);
  } finally { a.close(); }

  const b = await boot(snapshot);
  try {
    assert.equal(b.w.TF.game.view().ride.phase, 'flying', '重开后应接着飞');
    b.w.TF.debug.fastForwardToLanding();
    assert.ok(b.visible('#modal:not(.hidden)'), '补时间后应弹结算卡');
    b.click(b.q('#modal-box .m-primary'));
    assert.equal(b.w.TF.game.view().tripCount, 1);
    b.assertClean();
  } finally { b.close(); }
});

/* ---------------- 4. 老档 / 坏档 ---------------- */
test('ui: 老存档 / 坏存档都不会白屏', async () => {
  const a = await boot(JSON.stringify({ v: 1, clover: 99 }));
  try {
    assert.equal(a.q('#num-clover').textContent, '8', '旧版存档应换新（不给旧经济值）');
    assert.ok(a.q('#scene .rider'), '画面仍然可用');
    a.assertClean();
  } finally { a.close(); }

  const b = await boot('{{{ 不是 json');
  try {
    assert.equal(b.w.TF.game.isFresh, true, '坏档应回落到新档');
    assert.equal(b.q('#num-clover').textContent, '8');
    b.assertClean();
  } finally { b.close(); }
});

/* ---------------- 5. 新手引导 ---------------- */
test('ui: 引导状态推导——召唤时指坐骑，跳过后不再出现且写档', async () => {
  const t = await boot();
  try {
    assert.ok(/铃/.test(t.q('#guide-tip').textContent), '无行程时应指摇铃');
    t.click(t.q('#scene-hits .hit-bell'));
    assert.ok(/坐骑/.test(t.q('#guide-tip').textContent), '召唤后应指坐骑');
    t.click(t.q('#guide-skip'));
    assert.ok(t.q('#guide').classList.contains('hidden'), '跳过后隐藏');
    assert.equal(t.w.TF.game.view().onboarded, true, '跳过应写档');
    assert.equal(t.save().onboarded, true, '存档里应记录');
    t.assertClean();
  } finally { t.close(); }
});

/* ---------------- 6. 菜单 ---------------- */
test('ui: 菜单显示旅程统计与纪念品', async () => {
  const t = await boot();
  try {
    t.click(t.q('#btn-menu'));
    assert.ok(!t.q('#sheet-menu').classList.contains('hidden'), '应打开菜单');
    assert.ok(/旅程/.test(t.q('#menu-status').textContent), '应显示旅程数');
    assert.ok(/纪念品/.test(t.q('#menu-status').textContent), '应显示纪念品');
    t.click(t.q('#sheet-menu .back-btn'));
    assert.ok(t.q('#sheet-menu').classList.contains('hidden'), '返回应关掉菜单');
    t.assertClean();
  } finally { t.close(); }
});
