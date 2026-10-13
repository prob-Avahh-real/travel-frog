#!/usr/bin/env node
/* ============================================================
 * 真浏览器冒烟（Sensor）—— 纯 js 测试的补盲
 * ------------------------------------------------------------
 * 为什么必须有它：
 *   1) jsdom 对「给未声明的变量赋值」比真浏览器宽容 —— 这类错误能让真页面
 *      整体崩掉（白屏），jsdom 却可能放过去；
 *   2) 只跑 jsdom 也无法证明「在真渲染引擎里长得对」。
 * 做法：起一个本地静态服务 + 无头 Chrome，通过 CDP 直连：
 *   · 收集真实控制台异常（Runtime.exceptionThrown）
 *   · 断言首屏必须由 JS 画出来的东西真的在 DOM 里
 *   · 需要时可导出任意页签的截图（人眼复核用）
 * 用法：
 *   node scripts/smoke-browser.js                      # 手机视口，跑断言
 *   node scripts/smoke-browser.js --tab=album --shot /tmp/a.png
 *   node scripts/smoke-browser.js --viewport=watch     # 手表窄屏
 * ============================================================ */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

const CHROME_CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const VIEWPORTS = {
  mobile: [430, 880, true],     // 手机
  watch: [280, 340, true],      // 手表 / 极窄屏
  desktop: [760, 900, false],   // 桌面
  wide: [1200, 800, false],     // 一眼看全（含对开页）
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  for (const c of CHROME_CANDIDATES) if (fs.existsSync(c)) return c;
  return null;
}

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

async function launchChrome(chrome) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-smoke-'));
  const port = 9500 + Math.floor(Math.random() * 400);
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--hide-scrollbars',
    '--disable-features=Translate,MediaRouter', '--mute-audio',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    'about:blank',
  ], { stdio: 'ignore' });

  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return { child, profile, wsUrl: page.webSocketDebuggerUrl };
    } catch (e) { /* 端口还没起来 */ }
    await sleep(250);
  }
  child.kill('SIGKILL');
  throw new Error('Chrome 调试端口没起来');
}

/** 极简 CDP 客户端：Node 22 自带 WebSocket，无需任何依赖 */
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let seq = 0;
    const pending = new Map();
    const exceptions = [];
    const consoleErrors = [];
    ws.addEventListener('message', (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
        msg.error ? rej(new Error(msg.method + ': ' + JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails || {};
        exceptions.push((d.exception && (d.exception.description || d.exception.value)) || d.text || 'unknown');
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push((msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
      }
    });
    ws.addEventListener('error', (e) => reject(new Error('CDP WebSocket 失败: ' + (e.message || 'unknown'))));
    ws.addEventListener('open', () => resolve({
      exceptions, consoleErrors,
      send: (method, params) => new Promise((res, rej) => {
        const id = ++seq;
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params: params || {} }));
      }),
      close: () => { try { ws.close(); } catch (e) {} },
    }));
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (name, dflt) => {
    const hit = argv.find((a) => a === '--' + name || a.startsWith('--' + name + '='));
    if (!hit) return dflt;
    const eq = hit.indexOf('=');
    return eq >= 0 ? hit.slice(eq + 1) : (argv[argv.indexOf(hit) + 1] || dflt);
  };
  const [vw, vh, mobile] = VIEWPORTS[opt('viewport', 'mobile')] || VIEWPORTS.mobile;
  const tab = opt('tab', '');
  const shot = opt('shot', '');
  const pagePath = opt('page', 'index.html');

  const chrome = findChrome();
  if (!chrome) {
    console.log('⚠️  没找到 Chrome/Chromium，跳过真浏览器冒烟（可用 CHROME 环境变量指定）');
    return;
  }

  const { srv, port } = await startServer();
  let browser = null, client = null, failed = 0;
  const fail = (msg) => { console.log('  ❌ ' + msg); failed++; };
  const pass = (msg) => console.log('  ✅ ' + msg);

  try {
    browser = await launchChrome(chrome);
    client = await connect(browser.wsUrl);
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: vw, height: vh, deviceScaleFactor: 2, mobile: !!mobile,
    });

    const url = `http://127.0.0.1:${port}/${pagePath}?reset=1` + (tab ? '&tab=' + encodeURIComponent(tab) : '');
    await client.send('Page.navigate', { url });

    // 等页面 load 完 + 首帧渲染
    const t0 = Date.now();
    let ready = false;
    while (Date.now() - t0 < 15000) {
      await sleep(250);
      const r = await client.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      if (r.result && r.result.value === 'complete') { ready = true; break; }
    }
    if (!ready) fail('页面 15 秒都没 load 完');
    await sleep(900);

    /* ---------- 断言：首屏该由 JS 画出来的东西真的在 ---------- */
    if (pagePath === 'index.html') {
      const probe = await client.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `JSON.stringify({
          frog: !!document.querySelector('#frog-host svg'),
          plots: document.querySelectorAll('#garden .plot').length,
          ripe: document.querySelectorAll('#garden .plot.ripe').length,
          clover: document.getElementById('num-clover').textContent,
          title: document.getElementById('hud-title').textContent,
          tabs: document.querySelectorAll('.tab').length,
          visibleScreen: (document.querySelector('.screen:not(.hidden)')||{}).dataset ? document.querySelector('.screen:not(.hidden)').dataset.screen : null,
          docW: document.documentElement.scrollWidth,
          winW: window.innerWidth,
          tf: !!window.TF && !!window.TF.game,
          pageErrors: (window.__pageErrors||[]).slice(0,3)
        })`,
      });
      const info = JSON.parse(probe.result.value);
      const check = (label, ok) => (ok ? pass(label) : fail(label));

      check('页面脚本已启动（window.TF.game 存在）', info.tf);
      check('青蛙立绘已渲染', info.frog);
      check('三叶草田 12 格已渲染（实际 ' + info.plots + '）', info.plots === 12);
      check('三叶草田是长好的状态（成熟 ' + info.ripe + ' 格）', info.ripe === 12);
      check('开局赠予 20 三叶草已生效（实际 ' + info.clover + '）', info.clover === '20');
      check('称号已填充（' + info.title + '）', !!info.title && info.title.length > 1);
      check('底部 6 个页签齐全', info.tabs === 6);
      check('没有横向溢出（文档宽 ' + info.docW + ' ≤ 视口 ' + info.winW + '）', info.docW <= info.winW + 1);

      if (tab) check('深链页签生效（当前屏 ' + info.visibleScreen + '）', info.visibleScreen === tab);

      /* 走一遍关键交互：收割 → 买 → 出发 → 快进到归来 */
      const flow = await client.send('Runtime.evaluate', {
        returnByValue: true,
        awaitPromise: false,
        expression: `(() => {
          const doc = document;
          const click = (sel) => { const e = doc.querySelector(sel); if (e) e.click(); return !!e; };
          click('#btn-harvest-all');
          const afterHarvest = doc.getElementById('num-clover').textContent;
          click('.tab[data-tab="shop"]');
          click('#shop-list .row .buy');
          click('.tab[data-tab="bag"]');
          click('#bag-food .row');
          const previewShown = /可能去到：/.test(doc.getElementById('bag-preview').textContent);
          click('#btn-depart');
          window.TF.debug.advance(13000);
          const away = window.TF.game.state.frog.state;
          window.TF.debug.fastForwardToReturn();
          const modal = !doc.getElementById('modal').classList.contains('hidden');
          const album = window.TF.game.state.album.length;
          const cardSvg = !!doc.querySelector('#modal-box .postcard-view svg');
          click('#modal-box .m-primary');
          // 图鉴是按屏懒渲染的：得先切到图鉴页再看卡位
          click('.tab[data-tab="album"]');
          const cards = doc.querySelectorAll('#album-grid .card').length;
          const locked = doc.querySelectorAll('#album-grid .card.locked').length;
          const progress = /已收集 1 \\/ 42/.test(doc.getElementById('album-grid').textContent);
          click('.tab[data-tab="home"]');
          return JSON.stringify({ afterHarvest, previewShown, away, modal, album, cardSvg,
            badge: null, cards, locked, progress,
            badgeText: '' });
        })()`,
      });
      const f = JSON.parse(flow.result.value);
      check('收割后三叶草增加（' + f.afterHarvest + '）', Number(f.afterHarvest) > 20);
      check('行囊能预告可能的目的地', f.previewShown);
      check('青蛙真的出门了', f.away === 'away');
      check('归来弹出了明信片，且照片渲染出来了', f.modal && f.cardSvg);
      check('明信片入册 1 张（实际 ' + f.album + '）', f.album === 1);
      check('图鉴列出 42 张卡位（实际 ' + f.cards + '）', f.cards === 42);
      check('其中 41 张上锁、1 张已解锁（实际锁 ' + f.locked + '）', f.locked === 41);
      check('图鉴进度文案正确', f.progress);
    }

    /* ---------- 真实控制台异常 ---------- */
    const errs = client.exceptions.concat(client.consoleErrors);
    if (errs.length) fail('页面有未捕获异常：' + errs.slice(0, 3).join(' | '));
    else pass('页面无未捕获异常（真浏览器控制台）');

    /* ---------- 截图 ---------- */
    if (shot) {
      fs.rmSync(shot, { force: true });              // 先删掉旧图，免得拿旧图冒充新图
      // 长页面（例如美术对开页）按整页高度重设视口，一次拍全
      const hRes = await client.send('Runtime.evaluate', {
        returnByValue: true,
        expression: 'Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)',
      });
      const contentH = Math.max(vh, Math.min(Number(hRes.result.value) || vh, 9000));
      const dsr = contentH > vh * 1.2 ? 1 : 2;
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: vw, height: contentH, deviceScaleFactor: dsr, mobile: !!mobile,
      });
      await sleep(350);
      const cap = await client.send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(path.dirname(path.resolve(shot)), { recursive: true });
      fs.writeFileSync(shot, Buffer.from(cap.data, 'base64'));
      const size = fs.statSync(shot).size;
      if (size < 5000) fail('截图太小，可能没渲染：' + size + ' 字节');
      else pass('截图已导出 ' + shot + '（' + vw + 'x' + contentH + ' @' + dsr + 'x, ' + size + ' 字节）');
    }
  } finally {
    if (client) client.close();
    if (browser) {
      browser.child.kill('SIGKILL');
      await sleep(300);
      fs.rmSync(browser.profile, { recursive: true, force: true, maxRetries: 3 });
    }
    srv.close();
  }

  if (failed) { console.error(`\n❌ 真浏览器冒烟失败（${failed} 项）`); process.exit(1); }
  console.log('\n✅ 真浏览器冒烟通过');
}

main().catch((e) => { console.error('❌ 冒烟脚本自身出错：', e.message); process.exit(2); });
