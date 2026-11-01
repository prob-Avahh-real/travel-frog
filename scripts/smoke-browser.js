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
 *   node scripts/smoke-browser.js --views=/tmp/v       # 连拍 7 个视图（人眼复核用）
 *     视图步骤约定：数字 = 等多少毫秒；'#选择器' = 等它出现且可点再点；'!选择器' = 等它消失；'?表达式' = 求值并打印
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
          hasScene: !!document.querySelector('#scene svg.scene-svg'),
          rider: !!document.querySelector('#scene .rider'),
          patches: document.querySelectorAll('#scene-hits .hit[data-patch]').length,
          ripeHits: document.querySelectorAll('#scene-hits .hit.ripe').length,
          bell: !!document.querySelector('#scene-hits .hit-bell'),
          clover: document.getElementById('num-clover').textContent,
          dock: document.querySelectorAll('.dock-btn').length,
          tabs: document.querySelectorAll('.tab').length,
          skyHidden: document.getElementById('sky-layers').classList.contains('hidden'),
          mountHidden: document.getElementById('mount-box').classList.contains('hidden'),
          guideShown: !document.getElementById('guide').classList.contains('hidden'),
          guideTip: document.getElementById('guide-tip').textContent,
          docW: document.documentElement.scrollWidth,
          winW: window.innerWidth,
          tf: !!window.TF && !!window.TF.game
        })`,
      });
      const info = JSON.parse(probe.result.value);
      const check = (label, ok) => (ok ? pass(label) : fail(label));

      check('页面脚本已启动（window.TF.game 存在）', info.tf);
      check('树冠出发台已渲染（#scene svg.scene-svg）', info.hasScene);
      check('小鸡已站在出发台上（#scene .rider）', info.rider);
      check('三叶草畦有 4 株热区（实际 ' + info.patches + '）', info.patches === 4);
      check('三叶草是长好的状态（成熟 ' + info.ripeHits + ' 株）', info.ripeHits === 4);
      check('摇铃热区存在', info.bell);
      check('开局赠予 8 三叶草（实际 ' + info.clover + '）', info.clover === '8');
      check('旧的标签栏/插画按钮已拆除（.dock ' + info.dock + ' / .tab ' + info.tabs + '）', info.dock === 0 && info.tabs === 0);
      check('开局在出发台（天空层/坐骑隐藏）', info.skyHidden && info.mountHidden);
      check('新存档显示新手引导（第一步是摇铃）', info.guideShown && /铃/.test(info.guideTip));
      check('没有横向溢出（文档宽 ' + info.docW + ' ≤ 视口 ' + info.winW + '）', info.docW <= info.winW + 1);

      /* 走一遍关键交互：收草 → 摇铃 → 登机 → 飞行 → 滑翔 → 结算 */
      const flow = await client.send('Runtime.evaluate', {
        returnByValue: true,
        awaitPromise: false,
        expression: `(() => {
          const doc = document;
          const click = (sel) => { const e = doc.querySelector(sel); if (e) e.click(); return !!e; };
          click('#guide-skip');
          click('#scene-hits .hit.ripe');
          const afterHarvest = doc.querySelectorAll('#scene-hits .hit.ripe').length;
          click('#scene-hits .hit-bell');
          const phaseSummon = window.TF.game.view().ride && window.TF.game.view().ride.phase;
          const mountComing = !doc.getElementById('mount-box').classList.contains('hidden');
          window.TF.debug.advance(3500);
          const phaseBoard = window.TF.game.view().ride.phase;
          click('#mount-box');
          const phaseFly = window.TF.game.view().ride.phase;
          const skyShown = !doc.getElementById('sky-layers').classList.contains('hidden');
          const hudShown = !doc.getElementById('flight-hud').classList.contains('hidden');
          const layBg = doc.getElementById('lay-bg').style.backgroundImage;
          const layCache = JSON.stringify(window.TF.UI.ui && 'ui-ok');
          const mountUp = !!doc.querySelector('#mount-box .mount-svg');
          window.TF.debug.advance(45000 + 500);
          const phaseGlide = window.TF.game.view().ride.phase;
          const rings = doc.querySelectorAll('#flight-fx .fx-ring').length;
          const clouds = doc.querySelectorAll('#flight-fx .fx-cloud').length;
          const thermals = doc.querySelectorAll('#flight-fx .fx-thermal').length;
          const hintShown = !doc.getElementById('glide-hint').classList.contains('hidden');
          window.TF.debug.advance(28000 + 500);
          const phaseBack = window.TF.game.view().ride.phase;
          window.TF.debug.fastForwardToLanding();
          const phaseLand = window.TF.game.view().ride.phase;
          const modal = !doc.getElementById('modal').classList.contains('hidden');
          const cardSvg = !!doc.querySelector('#modal-box .settle-card svg');
          const cardText = doc.getElementById('modal-box').textContent;
          click('#modal-box .m-primary');
          const tripCount = window.TF.game.view().tripCount;
          const rideGone = window.TF.game.view().ride === null;
          const onboarded = window.TF.game.view().onboarded;
          return JSON.stringify({ afterHarvest, phaseSummon, mountComing, phaseBoard, phaseFly,
            skyShown, hudShown, layBg, mountUp, phaseGlide, rings, clouds, thermals, hintShown,
            phaseBack, phaseLand, modal, cardSvg, cardText, tripCount, rideGone, onboarded });
        })()`,
      });
      const f = JSON.parse(flow.result.value);
      check('收草后剩 3 株（实际 ' + f.afterHarvest + '）', f.afterHarvest === 3);
      check('摇铃后进入召唤相位（实际 ' + f.phaseSummon + '）', f.phaseSummon === 'summoning');
      check('坐骑飞来了（mount-box 可见）', f.mountComing);
      check('3 秒后落地待登机（实际 ' + f.phaseBoard + '）', f.phaseBoard === 'boarding');
      check('点坐骑登机，进入飞行（实际 ' + f.phaseFly + '）', f.phaseFly === 'flying');
      check('切到天空分层画面', f.skyShown);
      check('飞行 HUD 出现', f.hudShown);
      check('天空层是 SVG 平铺（data:image/svg+xml）', /data:image\/svg\+xml/.test(f.layBg));
      check('坐骑载着乘客在天上（mount-svg）', f.mountUp);
      check('45 秒后进入滑翔段（实际 ' + f.phaseGlide + '）', f.phaseGlide === 'gliding');
      check('滑翔道具齐全（圈 ' + f.rings + ' / 云 ' + f.clouds + ' / 气流 ' + f.thermals + '）', f.rings >= 3 && f.clouds >= 3 && f.thermals >= 2);
      check('滑翔操控提示出现', f.hintShown);
      check('滑翔结束回到巡航（实际 ' + f.phaseBack + '）', f.phaseBack === 'flying');
      check('落地进入待结算（实际 ' + f.phaseLand + '）', f.phaseLand === 'landed');
      check('弹出了结算明信片卡，画面渲染出来', f.modal && f.cardSvg);
      check('结算卡显示里程与纪念品', /飞行/.test(f.cardText) && /纪念品/.test(f.cardText));
      check('收下后回到出发台（行程清空、旅程 1 次）', f.rideGone && f.tripCount === 1);
      check('第一次出发后引导标记完成', f.onboarded);
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
    /* ---------- 多视图截图（--views=<目录>）：一次起浏览器，连拍多张给人眼复核 ----------
     * 每个视图：[文件名, 起始 query, 步骤序列]；步骤里数字 = 等多少毫秒，字符串 = 求值一次。
     * 之所以放在冒烟脚本里而不是另写一个：起浏览器 + CDP 客户端的样板只该有一份。 */
    const viewsDir = opt('views', '');
    if (viewsDir) {
      // 赚一张明信片要走的固定几步 —— 多个视图共用，避免各写一份（各写一份就会像刚才那样漏掉前置）
      // 步骤约定：数字 = 等多少毫秒；'#选择器' = 等它出现再点（比固定 sleep 可靠）；其它字符串 = 求值
      /* 一条旅程的固定步骤（多视图共用）：
       *   摇铃 → 等落地 → 登机 → 飞行……到某一步再各自推进/截图 */
      const RIDE_UP = [
        'TF.debug.advance(30*60*1000)', '#scene-hits .hit-bell',
        'TF.debug.advance(3500)', '#mount-box', 900,
      ];
      const VIEWS = [
        ['1-home.png', '?reset=1', ['TF.debug.advance(30*60*1000)', '#scene-hits .hit.ripe', 900]],
        ['2-summoning.png', '?reset=1', ['TF.debug.advance(30*60*1000)', '#scene-hits .hit-bell', 900]],
        ['3-boarding.png', '?reset=1', RIDE_UP.slice(0, 4)],
        ['4-flight.png', '?reset=1', RIDE_UP.concat([1200])],
        ['5-glide.png', '?reset=1', RIDE_UP.concat(['TF.debug.advance(45500)', 1200])],
        ['6-settle.png', '?reset=1', RIDE_UP.concat(['TF.debug.fastForwardToLanding()', 1200])],
        ['7-menu.png', '?reset=1', ['TF.debug.advance(30*60*1000)', '#scene-hits .hit.ripe', '#btn-menu', 900]],
      ];
      fs.mkdirSync(viewsDir, { recursive: true });
      for (const [file, query, steps] of VIEWS) {
        await client.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html${query}` });
        await sleep(900);
        // 连拍视图是给人眼复核美术的：先关掉新手引导，免得每张图都带着引导纸片
        await client.send('Runtime.evaluate', {
          expression: '(window.TF && TF.debug && TF.debug.ui && TF.debug.ui.guideOff) ? TF.debug.ui.guideOff() : 0',
        });
        for (const st of steps) {
          if (typeof st === 'number') { await sleep(st); continue; }
          if (st[0] === '!') {                        // '!选择器' = 等它消失
            for (let i = 0; i < 24; i++) {
              const r = await client.send('Runtime.evaluate', {
                returnByValue: true, expression: `!document.querySelector(${JSON.stringify(st.slice(1))})`,
              });
              if (r.result && r.result.value) break;
              await sleep(250);
            }
            continue;
          }
          if (st[0] === '#') {                        // '#选择器' = 等它出现且没被禁用再点
            let ok = false;
            for (let i = 0; i < 24; i++) {
              const r = await client.send('Runtime.evaluate', {
                returnByValue: true,
                // 只等「存在」不够：被禁用的按钮也存在，点了没反应（这里翻过车）
                expression: `(function(){var e=document.querySelector(${JSON.stringify(st)});return !!e && !e.disabled;})()`,
              });
              if (r.result && r.result.value) { ok = true; break; }
              await sleep(250);
            }
            if (!ok) fail('视图 ' + file + ' 等不到可点的 ' + st);
            else await client.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(st)}).click()` });
            continue;
          }
          if (st[0] === '?') {                        // '?表达式' = 求值并打印（调试用）
            const r = await client.send('Runtime.evaluate', {
              returnByValue: true, expression: st.slice(1),
            });
            console.log('  · ' + file + ' → ' + JSON.stringify(r.result && r.result.value));
            continue;
          }
          await client.send('Runtime.evaluate', { expression: st });
        }
        await sleep(400);
        const out = path.join(viewsDir, file);
        fs.rmSync(out, { force: true });          // 先删旧图，免得拿旧图冒充新图
        const cap = await client.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(out, Buffer.from(cap.data, 'base64'));
        const kb = Math.round(fs.statSync(out).size / 1024);
        if (kb < 20) fail('视图 ' + file + ' 几乎是空图（' + kb + ' KB）');
        else pass('视图已导出 ' + file + '（' + kb + ' KB）');
      }
      console.log('  📷 共 ' + VIEWS.length + ' 张 → ' + viewsDir);
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
