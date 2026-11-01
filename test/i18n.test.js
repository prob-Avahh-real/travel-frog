/* ============================================================
 * 中文本地化守卫（Sensor）—— 交付物里不得出现任何日文假名
 * ------------------------------------------------------------
 * 为什么要有这条：
 *   这是「中文版」而不是「拿日文界面凑的中文外壳」。日文文案一旦被贴回来
 *   （界面标签、注释、样式里的日文字体名都算），只靠口头约定一定会漂移；
 *   这条测试让它在 CI 里立刻变红。
 *   范围＝整个工程（含 www/ 产物），不含 node_modules / 二进制。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git']);
const TEXT_EXT = new Set(['.js', '.html', '.css', '.md', '.json', '.sh', '.txt', '.yml', '.yaml', '.webmanifest']);
/* 平假名 U+3040–U+309F、片假名 U+30A0–U+30FF */
const KANA = /[\u3040-\u30ff]/;

function textFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) textFiles(path.join(dir, e.name), out);
    } else if (TEXT_EXT.has(path.extname(e.name).toLowerCase())) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

test('i18n: 交付物里不得残留任何日文假名（中文版红线）', () => {
  const files = textFiles(ROOT);
  assert.ok(files.length >= 15, `扫到的文件太少（${files.length}），守卫等于空转`);

  const bad = [];
  for (const f of files) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (KANA.test(line)) bad.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(bad, [], '发现日文假名（中文版不允许）：\n' + bad.join('\n'));
});

test('i18n: 界面文案是中文，且不带日文字体名', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const label of ['菜单', '返回', '跳过', '摇铃', '御风启程', '三叶草']) {
    assert.ok(html.includes(label), `index.html 缺少中文标签「${label}」`);
  }
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  const font = (css.match(/--font:([^;]+);/) || [, ''])[1];
  assert.ok(font.includes('PingFang SC') || font.includes('Yuanti'), '正文字体应优先中文字体');
  assert.ok(!KANA.test(font), '正文字体不该出现日文字体名（中文会走日文字形）');
});

test('i18n: www/ 产物与源码逐文件一致（本地化后必须重新 build）', () => {
  /* 不写死文件名：遍历 www/ 下每一个文件，都必须与源码逐字节相同。
     产物与源码漂移过（改完前端忘了 build），所以这里用「全部文件」而不是抽样。 */
  const missing = [];
  let n = 0;
  for (const f of textFiles(path.join(ROOT, 'www'))) {
    const rel = path.relative(path.join(ROOT, 'www'), f);
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) { missing.push(rel + '（源码里没有对应文件）'); continue; }
    if (fs.readFileSync(src, 'utf8') !== fs.readFileSync(f, 'utf8')) missing.push(rel);
    n++;
  }
  assert.ok(n >= 7, `www/ 里只比对了 ${n} 个文件，守卫过松`);
  assert.deepEqual(missing, [], 'www/ 与源码不一致，请跑 npm run build：\n' + missing.join('\n'));
});
