/* 把 web 产物同步进 www/（及 android/app/src/main/assets/public/）：
   单页游戏没有打包步骤，做「完整性检查 + 拷贝」，确保 Capacitor 拿到可跑的副本。 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const www = path.join(root, 'www');
const androidPublic = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'public');
const androidAssets = path.join(root, 'android', 'app', 'src', 'main', 'assets');
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

  if (fs.existsSync(path.join(root, 'android'))) {
    const aDest = path.join(androidPublic, rel);
    fs.mkdirSync(path.dirname(aDest), { recursive: true });
    fs.copyFileSync(path.join(root, rel), aDest);
  }
}

if (fs.existsSync(path.join(root, 'android')) && fs.existsSync(path.join(root, 'capacitor.config.json'))) {
  fs.mkdirSync(androidAssets, { recursive: true });
  fs.copyFileSync(
    path.join(root, 'capacitor.config.json'),
    path.join(androidAssets, 'capacitor.config.json')
  );
}

// 冒烟：确认 www/index.html 引用的脚本都到位
const html = fs.readFileSync(path.join(www, 'index.html'), 'utf8');
for (const rel of ASSETS.filter((a) => a.endsWith('.js'))) {
  if (!html.includes(rel)) { console.error(`❌ www/index.html 未引用 ${rel}`); process.exit(1); }
  if (!fs.existsSync(path.join(www, rel))) { console.error(`❌ www/ 缺 ${rel}`); process.exit(1); }
}
console.log(`✅ www/ 已同步 ${ASSETS.length} 个文件`);
