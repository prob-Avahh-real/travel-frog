#!/usr/bin/env bash
# 旅行青蛙 · 构建 APK
set -euo pipefail
cd "$(dirname "$0")"
echo "🐸 旅行青蛙 · App Builder"

[ ! -d node_modules ] && npm install
npm test
node scripts/build-web.js

# --web-only：只做「测试 + 同步 www/」并成功退出（不产出 APK，也不假装产出）
if [ "${1:-}" = "--web-only" ]; then
  echo "✅ Web 产物已就绪（www/），未构建 APK（--web-only）"
  exit 0
fi

export JAVA_HOME="${JAVA_HOME:-$(ls -d /opt/homebrew/Cellar/openjdk@17/*/libexec/openjdk.jdk/Contents/Home 2>/dev/null | head -1)}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
# 缺工具链就失败退出，而不是打印一句提示后返回 0 —— 否则 CI 会「绿着」却没有产物
if [ ! -d "$ANDROID_HOME" ]; then
  echo "❌ 找不到 Android SDK（${ANDROID_HOME}），无法产出 APK。"
  echo "   要出 APK：装 SDK 后重跑（brew install --cask android-commandlinetools），"
  echo "   或用 skill: mobile-app-cloud-builds 走云端 CI。"
  echo "   只想验 Web 产物：bash build.sh --web-only"
  exit 3
fi
if [ ! -d "$JAVA_HOME" ]; then
  echo "❌ 需要 JDK 17：brew install openjdk@17（或设 JAVA_HOME）"; exit 1
fi

[ ! -d android ] && npx cap add android
npx cap sync
cd android
printf 'org.gradle.jvmargs=-Xmx2048m\nandroid.useAndroidX=true\n' > gradle.properties
./gradlew assembleDebug
APK=app/build/outputs/apk/debug/app-debug.apk
if [ ! -f "$APK" ]; then echo "❌ gradle 跑完了但没有产物：${APK}"; exit 1; fi
echo "📦 APK: android/$APK"
