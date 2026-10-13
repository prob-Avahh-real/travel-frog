/* ============================================================
 * 旅行青蛙 · 界面端到端测试（Sensor）
 * 用 jsdom 真跑一遍 index.html：加载全部脚本 → 点按钮 → 断言 DOM。
 * 这是「真的能玩」的证据，不是「代码看起来对」。
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
const SAVE_KEY = require(path.join(ROOT, 'js/data.js')).CONFIG.saveKey;
const ORIGIN = 'http://localhost';
const MIME = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html' };

/* 把 http://localhost/... 映射到本机文件；css 返回空（jsdom 不做排版，解析只会刷警告） */
function localFiles() {
  return requestInterceptor((request) => {
    const u = new URL(request.url);
    if (u.origin !== ORIGIN) return undefined;             // 交给默认分发器
    const rel = decodeURIComponent(u.pathname).replace(/^\//, '');
    const type = MIME[path.extname(rel)] || 'application/octet-stream';
    if (rel.endsWith('.css')) return new Response('', { headers: { 'Content-Type': 'text/css' } });
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) return new Response('not found', { status: 404 });
    return new Response(fs.readFileSync(file), { headers: { 'Content-Type': type } });
  });
}

/** 起一个真实的页面实例；seed 可先把存档塞进 localStorage，模拟「重开 App」 */
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
  await new Promise((r) => setTimeout(r, 80));   // 让首帧渲染跑完

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
    /** 白名单之外的问题都算失败（jsdom 未实现的浏览器 API 不算） */
    assertClean() {
      const bad = problems.filter((p) => !/Not implemented/.test(p));
      assert.deepEqual(bad, [], '页面不该有脚本错误');
    },
    save: () => JSON.parse(w.localStorage.getItem(SAVE_KEY) || 'null'),
    close: () => { try { dom.window.close(); } catch (e) {} },
  };
}

test('ui: 页面能起来，脚本无异常，首屏元素齐全', async () => {
  const t = await boot();
  try {
    assert.equal(t.qa('.tab').length, 6, '应该有 6 个标签');
    assert.equal(t.q('#garden').children.length, 12, '应该有 12 格三叶草田');
    assert.ok(t.q('#frog-host svg'), '青蛙立绘应该渲染出来');
    assert.ok(t.q('#hud-title').textContent.length > 0, '称号应该显示');
    assert.equal(t.q('#num-clover').textContent, '20', '开局送 20 三叶草（免得干等着）');
    assert.ok(t.visible('#screen-home:not(.hidden)'), '默认停在「家」');
    assert.equal(t.qa('#garden .plot.ripe').length, 12, '开局三叶草田应是长好的');
    assert.ok(t.q('svg.scene-svg') === null, '家里不该有明信片风景');
    t.assertClean();
  } finally { t.close(); }
});

test('ui: 收割 → 商店买便当 → 行囊出发 → 归来收到明信片 → 卖特产', async () => {
  const t = await boot();
  try {
    /* 1. 收割 */
    t.click(t.q('#btn-harvest-all'));
    const afterHarvest = Number(t.q('#num-clover').textContent);
    assert.ok(afterHarvest > 20, `收割后三叶草应增加，实际 ${afterHarvest}`);
    assert.equal(t.qa('#garden .plot.ripe').length, 0, '收完后应该都不成熟了');
    /* 回归护栏：一次一键收割只能留一条汇总提示，不能每格弹一条糊满屏幕 */
    const toasts = t.qa('#toasts .toast').map((n) => n.textContent);
    assert.ok(toasts.length <= 3, `同屏提示不应超过 3 条，实际 ${toasts.length} 条`);
    assert.ok(toasts.some((x) => /收了三叶草 ×12/.test(x)), `应有汇总提示，实际 ${JSON.stringify(toasts)}`);
    assert.ok(!toasts.some((x) => /^三叶草 \+1$/.test(x)), '不该再出现逐株的「三叶草 +1」提示');
    /* 未成熟的格子应该显示小苗而不是灰掉的三叶草 */
    assert.ok(t.q('#garden .plot .sprout'), '未成熟的格子应有小苗');

    /* 2. 商店 */
    t.click(t.q('.tab[data-tab="shop"]'));
    assert.ok(t.visible('#screen-shop:not(.hidden)'), '商店应显示');
    assert.equal(t.qa('#shop-list .row').length, 8, '便当应有 8 种');
    assert.ok(/近郊|中程|远行|秘境/.test(t.q('#shop-list').textContent), '便当应标出距离档');
    t.click(t.qa('#shop-list .row')[0].querySelector('.buy'));
    assert.ok(t.q('#shop-list').textContent.includes('已有 1 个'), '买完应显示持有数');
    // 道具页签也要能切
    t.click(t.q('#shop-seg .seg-btn[data-kind="item"]'));
    assert.ok(t.qa('#shop-list .row').length >= 7, '道具应有 7 种以上');
    assert.ok(t.q('#shop-list').textContent.includes('不可购买'), '四叶草应标为不可购买');

    /* 3. 行囊 */
    t.click(t.q('.tab[data-tab="bag"]'));
    assert.equal(t.qa('#bag-food .row').length, 1, '行囊里应有一个便当可选');
    assert.equal(t.q('#btn-depart').disabled, true, '没选便当不能出发');
    t.click(t.q('#bag-food .row'));
    assert.ok(t.q('#bag-food .row').classList.contains('picked'), '便当应被选中');
    assert.equal(t.q('#btn-depart').disabled, false, '选了便当就能出发');
    assert.ok(/可能去到：/.test(t.q('#bag-preview').textContent), '应预告可能的目的地');

    /* 4. 出发 */
    t.click(t.q('#btn-depart'));
    assert.equal(t.w.TF.game.state.frog.state, 'departing', '青蛙应在收拾行李');
    assert.ok(t.visible('#screen-home:not(.hidden)'), '出发后应切回家');
    assert.ok(t.visible('#away-panel:not(.hidden)'), '应显示出门面板');

    /* 5. 时间推进：真的走掉，再真的回来 */
    t.w.TF.debug.advance(13000);
    assert.equal(t.w.TF.game.state.frog.state, 'away', '13 秒后应该已经上路');
    assert.ok(t.q('#away-text').textContent.includes('出门了'), '面板应显示行程');
    const evs = t.w.TF.debug.fastForwardToReturn();
    assert.ok(evs && evs.some((e) => e.type === 'return'), '应产生归来事件');

    /* 6. 明信片弹窗 */
    assert.ok(t.visible('#modal:not(.hidden)'), '归来应弹出明信片');
    assert.ok(t.q('#modal-box').textContent.includes('明信片到了'), '弹窗标题应正确');
    assert.ok(t.q('#modal-box .postcard-view svg'), '弹窗里应有照片');
    t.click(t.q('#modal-box .m-primary'));
    assert.ok(t.q('#modal').classList.contains('hidden'), '点「收下」应关掉弹窗');

    /* 7. 图鉴 */
    assert.equal(t.q('#album-badge').textContent, '1', '图鉴角标应为 1');
    t.click(t.q('.tab[data-tab="album"]'));
    assert.ok(t.q('#album-grid').textContent.includes('已收集 1 / 42'), '应显示收集进度');
    assert.equal(t.qa('#album-grid .card:not(.locked)').length, 1, '应恰好解锁 1 张');
    assert.equal(t.qa('#album-grid .card.locked').length, 41, '其余 41 张应上锁');
    t.click(t.q('#album-grid .card:not(.locked)'));
    assert.ok(t.visible('#modal:not(.hidden)'), '点明信片应放大查看');
    assert.ok(t.q('#modal-box .postcard-view svg'), '放大视图里也应有照片');
    t.click(t.q('#modal-box .m-primary'));

    /* 8. 特产：卖掉换三叶草 */
    const before = Number(t.q('#num-clover').textContent);
    t.click(t.q('.tab[data-tab="stuff"]'));
    const sellBtn = t.q('#stuff-list [data-sell]');
    assert.ok(sellBtn, '应带回至少一件特产');
    t.click(sellBtn);
    assert.ok(Number(t.q('#num-clover').textContent) > before, '卖特产应换来三叶草');

    /* 9. 日记 */
    t.click(t.q('.tab[data-tab="log"]'));
    assert.ok(t.qa('#log-list .log-item').length >= 4, '日记里应记着收割/购买/出发/归来');

    /* 10. 存档落盘 */
    const saved = t.save();
    assert.equal(saved.album.length, 1, '存档里应有明信片');
    assert.equal(saved.stats.trips, 1, '存档里应记录 1 次出行');
    assert.equal(saved.frog.state, 'home', '存档里青蛙应在家');
    assert.ok(!saved.packed.food, '行囊应已被消耗');
    t.assertClean();
  } finally { t.close(); }
});

test('ui: 离线追赶——重开页面后，界面把离开期间的旅行结算出来', async () => {
  /* 第一段：出门、存盘（青蛙还在外面） */
  const a = await boot();
  let snapshot = null;
  try {
    a.click(a.q('.tab[data-tab="shop"]'));
    a.click(a.qa('#shop-list .row')[0].querySelector('.buy'));
    a.click(a.q('.tab[data-tab="bag"]'));
    a.click(a.q('#bag-food .row'));
    a.click(a.q('#btn-depart'));
    a.w.TF.debug.advance(13000);
    assert.equal(a.w.TF.game.state.frog.state, 'away');
    a.w.TF.game.save();
    snapshot = a.w.localStorage.getItem(SAVE_KEY);
    assert.equal(JSON.parse(snapshot).frog.state, 'away', '存盘时青蛙应该还在外面');
  } finally { a.close(); }

  /* 第二段：拿着这份存档重开（等价于第二天再打开 App） */
  const b = await boot(snapshot);
  try {
    assert.ok(b.q('#away-panel') && !b.q('#away-panel').classList.contains('hidden'),
      '重开后应仍在「出门中」状态');
    assert.equal(Number(b.q('#num-clover').textContent), JSON.parse(snapshot).clover,
      '三叶草数量应接着存档走');
    // 补上离开期间的时间
    b.w.TF.debug.fastForwardToReturn();
    assert.ok(b.visible('#modal:not(.hidden)'), '补时间后应弹出行程结果');
    assert.equal(b.w.TF.game.state.album.length, 1, '离线期间的照片应该入册');
    assert.ok(b.q('#away-panel').classList.contains('hidden'), '回来后面板应收起');
    b.assertClean();
  } finally { b.close(); }
});

test('ui: 老存档 / 坏存档都不会白屏（真实启动路径：读档即渲染）', async () => {
  // 老结构：字段缺失、格子数不对
  const legacy = JSON.stringify({ v: 1, clover: 7, plots: [{ readyAt: 0 }] });
  const a = await boot(legacy);
  try {
    assert.equal(a.w.TF.game.state.plots.length, 12, '老存档应被补齐格数');
    assert.equal(a.w.TF.game.state.clover, 7, '老存档的三叶草应保留');
    assert.equal(a.q('#num-clover').textContent, '7', '界面应直接显示老存档的数值');
    assert.equal(a.q('#num-clover').textContent, '7', '不该再叠加开局的 20 三叶草');
    assert.ok(a.q('#frog-host svg'), '青蛙仍然画得出来');
    a.assertClean();
  } finally { a.close(); }

  // 彻底坏掉的内容
  const b = await boot('{{{ 不是 json');
  try {
    assert.equal(b.w.TF.game.state.album.length, 0, '坏存档应回落到新档');
    assert.equal(b.w.TF.game.isFresh, true, '坏存档应被当作新档');
    assert.equal(b.q('#num-clover').textContent, '20', '新档应有开局的三叶草');
    b.w.TF.debug.tab('home');
    assert.ok(b.q('#frog-host svg'), '界面仍然可用');
    b.assertClean();
  } finally { b.close(); }
});
