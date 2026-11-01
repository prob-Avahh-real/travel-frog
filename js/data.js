/* ============================================================
 * 御风启程 · 内容表 (js/data.js)
 * ------------------------------------------------------------
 * 只有内容与配置。新增坐骑 / 目的地 / 滑翔参数都在这里，改一行配置。
 * 注意：全部中文本地化，不得出现日文假名（test/i18n.test.js 机器守卫）。
 * ============================================================ */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else { root.TF = root.TF || {}; root.TF.DATA = mod; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------- 默认配置（可被外部覆盖，例如 ?fast=1 加速调试） ---------- */
  var CONFIG = {
    saveKey: 'windride.save.v1',
    summonMs: 3000,          // 摇铃后坐骑飞抵耗时
    flightMs: 120000,        // 自动飞行总时长（真实毫秒）
    glideAtMs: 45000,        // 起飞后多久进入滑翔段
    glideLenMs: 28000,       // 滑翔段时长
    summonCooldownMs: 15000, // 落地结算后到下一次摇铃的冷却
    patchCount: 4,           // 出发台的三叶草丛株数
    patchRipenMs: 90000,     // 三叶草成熟耗时
    patchWorth: 1,
    distPerClover: 6,        // 每 6 米 = 1 三叶草（结算里程奖励）
    autoPickWorth: 1,        // 自动段浮游三叶草
    skySpeed: 90             // 自动段卷轴基准速度（px/秒，UI 用）
  };

  /* ---------- 坐骑表：新增坐骑 = 加一行 + world.js 里一个绘制函数 ---------- */
  var MOUNTS = [
    { id: 'glider', name: '飞鼠', art: 'squirrel', dayNight: 'day', speed: 1.0, glideLift: 1.0, bobbing: 3 },
    { id: 'owl', name: '猫头鹰', art: 'owl', dayNight: 'night', speed: 0.92, glideLift: 1.15, bobbing: 2.2 },
    { id: 'ptero', name: '翼龙', art: 'ptero', dayNight: 'day', speed: 1.18, glideLift: 0.95, bobbing: 4 },
    { id: 'east', name: '东方龙', art: 'east', dayNight: 'day', speed: 0.95, glideLift: 1.25, bobbing: 5 },
    { id: 'west', name: '西方龙', art: 'west', dayNight: 'night', speed: 1.05, glideLift: 0.9, bobbing: 3.4 },
    { id: 'paper', name: '纸飞机', art: 'paper', dayNight: 'day', speed: 1.4, glideLift: 0.7, bobbing: 1.2 }
  ];

  /* ---------- 时刻表：白天/夜行分桶，桶内按小时轮换（零随机、可测） ----------
   * 白天 6–18 点：飞鼠 / 翼龙 / 东方龙 / 纸飞机，每 3 小时轮一个
   * 夜间 18–次日 6 点：猫头鹰 / 西方龙，每 6 小时轮一个（toHour 30 = 次日 6 点） */
  var SCHEDULE = [
    { fromHour: 6, toHour: 18, stepHours: 3, mounts: ['glider', 'ptero', 'east', 'paper'] },
    { fromHour: 18, toHour: 30, stepHours: 6, mounts: ['owl', 'west'] }
  ];

  /* ---------- 目的地：结算明信片卡 + 远景剪影 ---------- */
  var DESTINATIONS = [
    { id: 'lake', name: '月光湖', memento: '月亮石', silhouette: 'lake' },
    { id: 'peak', name: '云顶峰', memento: '风羽', silhouette: 'peak' },
    { id: 'town', name: '远方小镇', memento: '琥珀铃', silhouette: 'town' }
  ];

  /* ---------- 滑翔段参数（引擎与 UI 读同一份） ---------- */
  var GLIDE = {
    rings: 4,             // 光圈数
    ringWorth: 1,         // 每圈三叶草
    thermalBoost: 1.9,    // 气流加速倍率
    cloudSlow: 0.45,      // 撞乌云减速倍率
    pitch: 260            // 满俯仰时的垂直速度（px/秒）
  };

  var byId = function (arr) {
    var m = {}; arr.forEach(function (x) { m[x.id] = x; }); return m;
  };

  return {
    CONFIG: CONFIG,
    MOUNTS: MOUNTS,
    SCHEDULE: SCHEDULE,
    DESTINATIONS: DESTINATIONS,
    GLIDE: GLIDE,
    MOUNT_BY_ID: byId(MOUNTS),
    DEST_BY_ID: byId(DESTINATIONS)
  };
});
