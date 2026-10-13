# 旅行青蛙 (Travel Frog)

复刻《旅かえる / 旅行青蛙》的放置养成游戏：收三叶草 → 买便当 → 给青蛙备行囊 → 它出门 → 带回明信片和特产 → 攒图鉴升称号。

零依赖、零构建：打开 `index.html` 就能玩；同一份产物用 Capacitor 包成 App。

---

## 快速开始

```bash
open index.html          # 直接玩
npm test                 # 25 条自动化测试（引擎 + jsdom 端到端）
npm run smoke            # 真浏览器冒烟（DOM 断言 + 控制台异常 + 截图）
npm run shot             # 导出一张手机截图到 /tmp/travel-frog-home.png
npm run build            # 同步产物到 www/（Capacitor 用）
bash build.sh            # 出 Android APK（需 Android SDK + JDK 17）
bash build.sh --web-only # 只跑测试 + 同步 www/，明确不产 APK（CI 里跑这条）
```

调试参数：`index.html?reset=1` 清档 · `?fast=20` 加速 20 倍 · `?tab=album` 直接进某个页面。
桌面调试快捷键：`1`~`6` 切页 · `H` 一键收割 · `F` 快进 5 分钟。

---

## 玩法要点

- **三叶草田**：12 格，每格 45 秒长成（`js/data.js` 的 `CONFIG.garden` 可改）。点格子或「一键收割」收三叶草；约 1/30 概率额外掉 **四叶草**（带出门必得稀有以上明信片）。
- **商店**：8 种便当（价格决定距离档 near/mid/far/exotic）+ 7 种道具（推远行程 / 提高稀有度 / 打开只认道具的地方）。
- **行囊**：1 个便当 + 最多 3 件道具，出发时消耗，并预告「可能去到」哪些地方。
- **旅行**：真实时间流逝，关掉应用也在走；回来带 1 张明信片（地点 × 时段 × 姿态 × 文案）与 1~2 件特产。
- **图鉴**：14 个地点 × 3 张 = 42 张，没拍到的显示上锁。
- **特产**：卖掉换三叶草，或喂门口来的蜗牛换回礼（有概率回赠道具）。
- **称号**：按明信片数从「独自旅行的青蛙」升到「传说的旅蛙」。

---

## 目标平台

| 平台 | 方式 | 状态 |
|------|------|------|
| 📱 移动端 | Capacitor → Gradle / Xcode（`capacitor.config.json` + `build.sh`） | 配置就绪；本机缺 Android SDK，未出 APK（`bash build.sh` 会明确报错并退出 3，不会假装成功） |
| ⌚ 手表 | 窄屏自适应 ≤300px，房间自动收纳 | 已实现（`css/style.css` 窄屏段） |
| 👓 智能眼镜 | 窄 FOV + 体感入口 | 体感已实现（戒指倾斜切页 / 手杖轻敲收草） |
| 💻 网页 | 直接开 `index.html` | 仅兜底测试用 |

---

## 架构

```
index.html          单页骨架（6 个屏）
css/style.css       全部样式（颜色走 CSS 变量；含手表窄屏段）
js/data.js          所有数据表 + 默认配置
js/engine.js        状态机 / 时间推进 / 经济结算（纯逻辑，注入 now/rng/storage）
js/art.js           程序化 SVG：青蛙 / 风景 / 图标（纯函数）
js/ui.js            渲染 + 交互 + 弹窗
js/main.js          装配：真实时钟、存盘、主循环、键鼠/体感输入
dev/art-sheet.html  美术对开页（开发用，不进包）
test/               引擎测试 + jsdom 端到端测试
scripts/            产物同步 + 真浏览器冒烟
```

**分层原则**：引擎不知道 DOM 的存在，UI 不知道游戏规则。所有副作用（时钟、随机、存档）从外部注入，因此引擎可以在 Node 里用假时钟 + 种子随机做确定性测试。

---

## 如何扩展（不动主循环）

| 想加什么 | 改哪里 |
|---|---|
| 新地点 | `LOCATIONS` 加一条：`dist` + `scene` + `scenes` + `souvenirs` |
| 新风景画面 | `js/art.js` 的 `FEATURES` 加一个 key 的函数 |
| 新便当 | `FOODS` 加一条（`dist` 决定走多远，`minMs/maxMs` 决定走多久） |
| 新道具 | `ITEMS` 加一条（`effects`: dist / duration / rare / times / guarantee） |
| 某地需要某道具 | 在**该地点**的 `requires` 写道具 id |
| 新明信片 | 该地点的 `scenes` 加一条 `[时段, 姿态, 文案, 稀有度]` |
| 新称号 | `TITLES` 加一条 `{min, name}` |

有一条测试会遍历所有地点、用「同档便当 + 该地 requires」跑 200 次，确认**每个地点都真的能被走到** —— 加内容时不会悄悄变成死代码。

---

## 验证（Done 的判定）

```bash
npm test        # 25 条：数据表完整性 · 引擎行为 · 经济 · 离线追赶 · 存档迁移 · jsdom 端到端
npm run smoke   # 真浏览器：首屏渲染断言 + 控制台无未捕获异常 + 关键交互走通 + 截图
npm run smoke -- --viewport=watch   # 手表窄屏
```

**Done = 两条都全绿。** 改 UI 后必须跑 `npm run smoke`（原因见下）。

---

## 踩过的坑（别再踩）

1. **jsdom 抓不到「给未声明变量赋值」这类致命错误。** 真浏览器在 strict 模式下会抛 ReferenceError 让页面整体白屏，jsdom 却放过去了——当时 25 条测试全绿，页面其实是空的。
   → 必须有 `npm run smoke` 兜底；这个盲区是被真浏览器冒烟抓出来的。
2. **无头 Chrome 的输出不要走管道。** Chrome 的 zygote 子进程会一直握着管道，`spawnSync` 永不返回。重定向到文件 + 硬超时（`scripts/smoke-browser.js` 已这么做）。
3. **`--dump-dom` 在有常驻 rAF 循环的页面上会挂住** → 改用 CDP `Runtime.evaluate` 取 DOM 并断言。
4. **截图前先删旧图。** 否则「截图已导出」会在旧文件上通过——传感器自己骗自己。
5. **地点解锁只能有一处真相源**，写在 `LOCATIONS[].requires`。曾经道具侧也声明 `enables`，两边对不上，导致「带了木碗也去不了温泉」。
6. **稀有度降级要退到最接近的更低档**，不能退到最低档：否则要 epic 的请求会掉成 common，「四叶草保底稀有」静默失效。
7. **不要每格弹一条提示**：一键收割曾一次弹 12+ 条 toast 糊满手机屏幕。现在合并成一条汇总，同屏最多 3 条（窄屏 2 条）。
8. **夜间配色不能压太黑**：初版夜景把远山画成一团黑块，完全看不出是哪个地点。
