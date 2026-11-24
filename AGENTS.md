# 旅行青蛙 (Travel Frog)

复刻《旅かえる》的放置养成：收三叶草、备行囊、出门、明信片图鉴。

## 用途与 Target 判定

| 平台 | 需要? | 方式 |
|------|-------|------|
| 移动端 | 需要 | Capacitor Android（`android/` 壳已就绪，`build.sh` 同步并构建 APK） |
| 智能硬件 | 可选 | 未做；不纳入强制 Done |

## 命令

```bash
npm test
npm run build
bash build.sh --web-only
# APK（需 Android SDK + JDK 17）: bash build.sh
```

## Harness / Loop（助手）

- Guide = 本文件；Sensor = `npm test` + `npm run build`
- 同类失误第二次 → 规则或测试（棘轮）

## 验证环 / Done

```bash
npm test
npm run build
```

**Done**：测试绿 + `www/` 与 `android/app/src/main/assets/public/` 同步一致。
