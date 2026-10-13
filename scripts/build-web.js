/* 把 web 产物同步进 www/：单页游戏没有打包步骤，
   只做「完整性检查 + 拷贝」，确保 Capacitor 拿到的是一份可跑的副本。 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const www = path.join(root, 'www');
const ASSETS = [
  'index.html',
  'css/style.css',
  'js/data.js',
  'js/engine.js',
  'js/art.js',
  'js/ui.js',
  'js/main.js'
];

for (const rel of ASSETS) {
  const src = path.join(root, rel);
  if (!fs.existsSync(src)) {
    console.error(`❌ 缺少 ${rel}`);
    process.exit(1);
  }
}

for (const rel of ASSETS) {
  const dest = path.join(www, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(root, rel), dest);
}

// 冒烟：确认 www/index.html 引用的脚本都到位
const html = fs.readFileSync(path.join(www, 'index.html'), 'utf8');
for (const rel of ASSETS.filter((a) => a.endsWith('.js'))) {
  if (!html.includes(rel)) { console.error(`❌ www/index.html 未引用 ${rel}`); process.exit(1); }
  if (!fs.existsSync(path.join(www, rel))) { console.error(`❌ www/ 缺 ${rel}`); process.exit(1); }
}
console.log(`✅ www/ 已同步 ${ASSETS.length} 个文件`);
