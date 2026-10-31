# 御风启程（Wind Ride）

> 原「旅行青蛙」复刻 → **动态飞翔滑行旅行**。
> 放置节奏 + 可操控滑翔：树冠出发台收三叶草 → 摇铃召唤坐骑 → 登机巡航 → 滑翔段操控 → 落地结算（里程换三叶草 + 目的地纪念品）。

- **纯前端零依赖**：打开 `index.html` 即玩；`data.js` 数据驱动，`world.js` 程序化美术（SVG，无图片资源）。
- **放置引擎**：全部由时间戳驱动（`state.ride` 相位 + `tick(now)`），关掉再开 = 一次快进，不靠定时器累计。
- **中文本地化红线**：界面文案全中文，**不得出现任何日文假名**（`test/i18n.test.js` 逐文件机器守卫，改了文案先跑测试）。

---

## 快速开始

| 命令 | 作用 |
|---|---|
| `open index.html` | 直接玩（无构建） |
| `npm test` | 全量测试 **24 条**（engine 15 / i18n 3 / ui 6） |
| `npm run smoke` | 真实 Chrome 冒烟：点击热区走完整旅程（接 `scripts/smoke-browser.js`） |
| `npm run smoke -- --views=dev/shots` | 连拍 7 视图（首页/召唤/登机/飞行/滑翔/结算/菜单）给美术复核 |
| `bash build.sh --web-only` | 全量同步到 `www/`（不改 UI 时无需跑） |

**调试参数**（URL query）：

| 参数 | 作用 |
|---|---|
| `?reset=1` | 清档重开 |
| `?fast=N` | 全局时间加速（1–200 倍，默认 1） |
| `TF.debug.advance(ms)` | 控制台快进（自动段起飞快进 30 分钟） |
| `TF.debug.fastForwardToLanding()` | 直接跳到落地结算 |

**桌面快捷键**：`0`/`Esc` 关面板 · `H` 一键收割 · `F` 快进 5 分钟 · `M` 菜单。
**体感输入**（菜单内开启）：智能戒指倾斜 = 滑翔俯仰；手杖轻敲 = 收草。

---

## 核心循环

```
树屋平台（收三叶草）→ 摇铃召唤坐骑 → 坐骑落地 → 点一下登机 → 起飞
→ 自动飞行（横版卷轴，浮游三叶草可点收）→ 滑翔段（可控：俯仰、乘气流、穿光圈、躲乌云）
→ 降落结算（目的地卡：三叶草 + 纪念品）→ 回家
```

**相位机**（`engine.js`，唯一驱动源 = 时间戳）：

| 相位 | 触发 | 时长 |
|---|---|---|
| `summoning` | 摇铃 | 3s（坐骑飞抵） |
| `boarding` | 坐骑落地待机 | 直到点击 |
| `flying` | 登机起飞 | 120s 巡航 |
| `gliding` | 起飞后 45s 处随机触发 | 28s |
| `landed` → `null` | 滑翔结束降落后 | 摇铃冷却 15s |

- **离线**：关掉再开 = 一次 `tick(now)` 快进；中途错过的滑翔段自动跳过（结算只给基础里程），交互只在「人在场」时发生。
- **三叶草经济**：出发台 4 丛（90s 成熟，每丛 1）· 自动段浮游草（每朵 1）· 滑翔光圈（4 圈 ×1）· 落地里程（每 6 米 = 1）。
- **存档**：`localStorage['windride.save.v1']`，飞行中关掉重开也接得上。

### 日 / 夜档（两套时间表，边界不同，勿混）

| 系统 | 规则 | 位置 |
|---|---|---|
| 场景昼夜配色 | `h >= 19 \|\| h < 5` → 夜档（19:00–05:00） | `ui.js timeOfDay` |
| 坐骑时刻表 | 6–18 点日行桶（每 3h 轮），18–次日 6 点夜行桶（每 6h 轮） | `data.js SCHEDULE` |

> 曾出过 bug：旧 `timeOfDay` 漏判凌晨 0–5 点（深夜出日色太阳），已修为上表规则。改任一规则时先看这里的边界约定。

---

## 内容表（`js/data.js`，改一行配置即生效）

**坐骑**（新增坐骑 = 加一行 + `world.js` 一个绘制函数）：

| 坐骑 | id | 档位 | 巡航 | 升力 | 颠簸 |
|---|---|---|---|---|---|
| 飞鼠 | `glider` | 日行 | 1.00 | 1.00 | 3.0 |
| 猫头鹰 | `owl` | 夜行 | 0.92 | 1.15 | 2.2 |
| 翼龙 | `ptero` | 日行 | 1.18 | 0.95 | 4.0 |
| 东方龙 | `east` | 日行 | 0.95 | 1.25 | 5.0 |
| 西方龙 | `west` | 夜行 | 1.05 | 0.90 | 3.4 |
| 纸飞机 | `paper` | 日行 | 1.40 | 0.70 | 1.2 |

**目的地**（结算卡 = 远景剪影 + 纪念品）：

| 目的地 | 纪念品 | 剪影 |
|---|---|---|
| 月光湖 | 月亮石 | `lake` |
| 云顶峰 | 风羽 | `peak` |
| 远方小镇 | 琥珀铃 | `town` |

**滑翔参数**（`GLIDE`）：4 光圈 · 气流加速 1.9× · 乌云减速 0.45× · 满俯仰垂直速度 260 px/s。

---

## 界面结构（`index.html`）

```
#app
├── #stage                        ← 主舞台（home 与 flight 两种模式共用）
│   ├── #scene-wrap
│   │   ├── #scene                ← 出发台世界图（SVG，热区 #scene-hits 盖在其上）
│   │   ├── #sky-layers           ← 飞行卷轴天空层（云/树冠/热气流）
│   │   ├── #mount-box            ← 坐骑（登机点 = 座位贴背锚定）
│   │   └── #flight-fx            ← 滑翔道具层（光圈/乌云/气流/浮游草）
│   ├── #scene-hits               ← 可点热区（hit-patch / hit-bell / hit-mount）
│   ├── #hud-top                  ← 三叶草计数 · 摇铃按钮 · 菜单按钮
│   ├── #flight-hud               ← 航迹仪 + 里程 + 滑翔俯仰提示
│   └── #phase-banner             ← 相位横幅（召唤中/登机/滑翔/结算）
├── #sheet-menu                   ← 菜单（旅程次数 / 纪念品 / 体感开关 / 重置）
├── #slips                        ← 结算明信片卡
└── #modal                        ← 对话框（重置确认等）
```

新手引导（`#guide`）首次开启时展示，`.guide-dim` 全屏暗幕（15%）在引导完成后隐藏。

---

## 架构

| 文件 | 职责 |
|---|---|
| `index.html` | 单页骨架 + 7 脚本 + 引导层 |
| `css/style.css` | 全部 chrome 与场景样式：设计变量、日夜档、手表窄屏（≤300px 收纳） |
| `css/flight.css` | 飞行 HUD + 天空卷轴层样式 |
| `js/data.js` | **内容表**：坐骑 / 时刻表 / 目的地 / 滑翔参数 / CONFIG（可被 query 覆盖） |
| `js/engine.js` | **纯引擎**：状态机 / 经济 / 存档（无 DOM；`now`、`storage`、`rng` 全部注入，可测） |
| `js/world.js` | **御风启程美术**：坐骑（kind 表分发）、出发台、天空卷轴、滑翔道具、结算卡、日夜调色板（全部纯函数 SVG） |
| `js/ui.js` | **渲染 + 交互**：home/flight 两模式、签名缓存（只在状态签名变化时重绘）、热区路由、菜单、引导 |
| `js/main.js` | **装配**：真实时钟 / 存盘钩子 / 250ms tick / 帧循环 / 键盘与体感输入 |
| `js/scene.js` | 遗留（原旅行青蛙家）：`frogFigure` 仍是乘客（小鸡）唯一渲染器，被复用 |
| `js/art.js` | 遗留（原明信片/图标）：未接线，测试仍在跑，保留 |
| `test/` | engine 15 + i18n 3 + ui 6 条测试 |
| `scripts/` | `smoke-browser.js`（真实 Chrome 冒烟 + 连拍）、`build.mjs`（→ www/） |
| `dev/design-ref/` | 设计资产：风格令牌、主题变更史、对照图（见末尾） |
| `www/` | 构建产物，与源文件同步入库（i18n 守卫逐文件比对） |

**分层原则**：`engine` 只管「什么该发生」，`ui` 只管「长什么样」，`world` 只产 SVG 字符串——三层互不 import 对方内部状态，只经 `view()` 快照和事件流通信。

---

## 如何扩展（改配置 / 加策略，不动主循环）

| 要加的东西 | 改哪里 |
|---|---|
| 新坐骑 | `data.js MOUNTS` 加一行 + `world.js MOUNT_ART` 加一个绘制函数 |
| 新目的地 | `data.js DESTINATIONS` 加一条（剪影 + 纪念品） |
| 新时刻表档 | `data.js SCHEDULE` 加一个桶 |
| 滑翔手感 | `data.js GLIDE` |
| 经济数值 | `data.js CONFIG` |
| 新输入设备 | `main.js Input`（喂给 `ui.setPitch` / 收草动作） |
| 场景新配色 | `world.js PAL` / `palFor`（日、夜两套） |
| 新面板 | `index.html` 加 sheet + `ui.js renderMenu`/`openSheet` |

---

## 目标平台

| Target | 状态 |
|---|---|
| **移动端（Android APK）** | Capacitor 配置就绪（`capacitor.config.json` / `android/`）。⚠️ 本机 Android SDK 在 `/opt/homebrew/share/android-commandlinetools`、构建需 **JDK 21**，而 `build.sh` 仍指向旧路径（JDK 17 / `~/Library/Android/sdk`）——APK 构建当前**未验证**，待更新 build.sh 后测 |
| **智能手表** | `style.css` 已有 `@media (width ≤ 280px 或 height ≤ 300px)` 窄屏收纳（HUD 缩小、面板全屏） |
| **智能眼镜 / 体感** | `main.js Input` 已接 `DeviceOrientationEvent`（戒指倾斜=俯仰）+ `DeviceMotionEvent`（手杖轻敲=收草），iOS 13+ 权限流已处理 |
| **网页（兜底）** | 单文件体系，`www/` 可静态部署 |

---

## 验证（Done 判定）

1. `npm test` 全绿（24/24）。
2. 改了任何 UI/文案/美术 → `bash build.sh --web-only` 同步 `www/` 并再次 `npm test`（i18n 守卫比对 `www/` 逐文件一致）。
3. 改世界图/飞行/滑翔美术 → `npm run smoke -- --views=dev/shots` 连拍，肉眼复核 7 张视图。
4. 验证截图前**先确认拍摄时刻对应日/夜预期**（见「日/夜档」表）——凌晨截图出日色天空 = bug，不是巧合。

---

## 踩过的坑（排查时先查这里）

1. **凌晨出日色天空**：`timeOfDay` 旧逻辑 `h>=5 && h<8 ? 'day' : (h>=19 ? 'night' : 'day')` 把 0–5 点判成白天。现为 `h >= 19 || h < 5 ? 'night' : 'day'`。改夜间边界时同时看 `data.js SCHEDULE`（18 点）——两套表边界不同是有意的。
2. **全场景莫名被压暗（如月亮变暗）**：先查 `.guide-dim` 新手引导暗幕——它是 `position:absolute; inset:0` 的**全屏覆盖层且 `pointer-events:none`**，`elementsFromPoint`/祖先 CSSOM 探针都看不见它。数值诊断：像素输出 ≈ `α×原色 + (1−α)×#2e3a33`（α = 1 − 遮罩不透明度）。现为 15%。
3. **jsdom 抓不到赋值错误**：`el.onclick = fn` 这类在 jsdom 不报错、真浏览器才炸 → 交互路径必须走 `npm run smoke`（真实 Chrome 点热区），不能只信单测。
4. **无头 Chrome 有头没头行为不同**：点击命中需元素实际占位（`getBoundingClientRect`）；纯 `background-image` 无尺寸的 div 点不中。冒烟脚本一律用 `DOM.getBoxModel` 取坐标再 `Input.dispatchMouseEvent`。
5. **`www/` 不同步会漏发布**：`www/` 与源文件都入库，改了 `js/`、`css/`、`index.html` 忘跑 build → i18n 守卫会在 `npm test` 里报警（这是有意的）。
6. **innerHTML 重建会杀活节点**：热区、飞行 fx 的 DOM 是运行时造的，重绘时先 `data-*` 签名比对再决定是否重挂——改渲染路径别把事件监听绑在新节点之外。
7. **坐标单一真相源**：所有布局数字（热区位置、滑翔俯仰速度、道具坐标）由 `data.js`/引擎产生，UI 只读——手调 CSS 位置会让「看起来对」与「点得到」脱钩。
8. **夜间配色别压太黑**：夜档只在同一色相上调冷调暗（HSL 亮度 −12 左右），全屏黑蒙版会毁掉对比度（见坑 2）。
9. **零随机策略**：坐骑按时刻表定、可测；新增内容先用确定性分配，验收通过后再谈 rng。

---

## 设计资产（`dev/design-ref/`）

| 文档 | 内容 |
|---|---|
| `PBZ-STYLE.md` | 风格研究：《影之刃零》画风拆解 + 设计令牌（青绿淡彩 bright3） |
| `REDESIGN-FLIGHT.md` | 主题变更史（旅行青蛙 → 御风启程）+ 核心循环 v1 + 里程碑 |
| `README.md` | 团队协作说明 |

风格迭代史：手绘 → 水墨影刃 → **青绿淡彩**（用户 2026-10-30 拍板）。主题装饰不铺满全场：chrome 保持安静、强调色 ≤1、场景满屏。

---

## 许可证

MIT
