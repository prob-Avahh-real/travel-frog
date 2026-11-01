/* ============================================================
 * 御风启程 · 引擎测试（Sensor / 验证环）
 * 用假时钟，全部确定性可复现。
 *   node --test test/*.test.js
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = require(path.join(ROOT, 'js/data.js'));
const { createEngine, memStorage } = require(path.join(ROOT, 'js/engine.js'));
const World = require(path.join(ROOT, 'js/world.js'));
const Scene = require(path.join(ROOT, 'js/scene.js'));

/* 可控时钟引擎：t = 2026-10-12 12:00（中午 → 飞鼠时段） */
const NOON = new Date('2026-10-12T12:00:00').getTime();
const MIDNIGHT = new Date('2026-10-13T00:00:00').getTime();

function makeEngine(t0 = NOON) {
  const box = { t: t0 };
  const eng = createEngine({ now: () => box.t, storage: memStorage() });
  box.eng = eng;
  box.advance = (ms) => { box.t += ms; return eng.tick(box.t); };
  return box;
}

/* 走完一条完整旅程：召唤 → 登机 → 飞 → 滑 → 落 → 收 */
function fullTrip(box) {
  const eng = box.eng;
  assert.ok(eng.summon(box.t).ok, '摇铃应成功');
  box.advance(DATA.CONFIG.summonMs + 1);
  assert.equal(eng.view().ride.phase, 'boarding');
  assert.ok(eng.board(box.t).ok, '登机应成功');
  assert.equal(eng.view().ride.phase, 'flying');
  box.advance(DATA.CONFIG.glideAtMs + 1);
  assert.equal(eng.view().ride.phase, 'gliding', '到点应进入滑翔段');
  box.advance(DATA.CONFIG.glideLenMs + 1);
  assert.equal(eng.view().ride.phase, 'flying', '滑翔段结束应回到巡航');
  const r = eng.view().ride;
  box.advance(r.backAt - box.t + 1);
  assert.equal(eng.view().ride.phase, 'landed', '到点应落地待结算');
  return eng.settle(box.t);
}

/* ---------------- 1. 数据表完整性 ---------------- */
test('data: 坐骑与目的地表完整、字段合法', () => {
  const ids = new Set();
  for (const m of DATA.MOUNTS) {
    assert.ok(!ids.has(m.id), `重复坐骑 id ${m.id}`);
    ids.add(m.id);
    assert.ok(['day', 'night'].includes(m.dayNight), `${m.id} 时段非法`);
    assert.ok(m.speed > 0 && m.glideLift > 0, `${m.id} 参数须为正`);
    assert.ok(World.MOUNT_ART[m.art], `${m.id} 引用了不存在的美术 key ${m.art}`);
  }
  for (const d of DATA.DESTINATIONS) {
    assert.ok(!ids.has(d.id), `重复目的地 id ${d.id}`);
    ids.add(d.id);
    assert.ok(d.name && d.memento, `${d.id} 缺名字/纪念品`);
  }
  assert.ok(DATA.MOUNTS.some((m) => m.dayNight === 'day'), '要有白天坐骑');
  assert.ok(DATA.MOUNTS.some((m) => m.dayNight === 'night'), '要有夜行坐骑');
});

/* ---------------- 2. 完整旅程闭环 ---------------- */
test('ride: 召唤→登机→飞→滑→落地→结算 一整条旅程', () => {
  const box = makeEngine();
  const eng = box.eng;
  const events = [];
  eng.on((e) => events.push(e.type));

  const before = eng.view().clovers;
  const res = fullTrip(box);
  assert.ok(res.ok, '结算应成功');
  const l = res.loot;
  assert.ok(l.meters > 0, '应有里程');
  assert.ok(l.distClovers >= 0);
  assert.ok(l.memento, '应带回纪念品');
  assert.ok(l.destName && l.mountName);

  const v = eng.view();
  assert.equal(v.ride, null, '结算后行程应清空');
  assert.equal(v.tripCount, 1);
  assert.ok(v.mementos.includes(l.memento), '纪念品应入册');
  assert.ok(v.clovers > before, '三叶草应增加');
  assert.ok(v.cooldownLeft > 0, '刚落地应有冷却');
  assert.ok(events.includes('summoned') && events.includes('departed') &&
    events.includes('glide-start') && events.includes('glide-end') &&
    events.includes('landed') && events.includes('settled'), `事件链不全: ${events.join(',')}`);
});

test('ride: 摇铃冷却与忙碌拒绝', () => {
  const box = makeEngine();
  const eng = box.eng;
  fullTrip(box);
  assert.equal(eng.summon(box.t).reason, 'cooldown', '冷却中应拒绝');
  box.advance(DATA.CONFIG.summonCooldownMs + 1);
  assert.ok(eng.summon(box.t).ok, '冷却结束应能再召唤');
  assert.equal(eng.summon(box.t).reason, 'busy', '行程中不能再召唤');
});

test('ride: 坐骑按时刻表轮换——白天桶 3 小时一换，夜间桶 6 小时一换', () => {
  const at = (h) => {
    const box = makeEngine(new Date(2026, 9, 12, h, 0, 0).getTime());
    assert.ok(box.eng.summon(box.t).ok);
    return box.eng.view().ride.mountId;
  };
  assert.equal(at(7), 'glider', '7 点应是飞鼠');
  assert.equal(at(10), 'ptero', '10 点应是翼龙');
  assert.equal(at(12), 'east', '正午应是东方龙');
  assert.equal(at(16), 'paper', '16 点应是纸飞机');
  assert.equal(at(20), 'owl', '20 点应是猫头鹰');
  assert.equal(at(0), 'west', '午夜应是西方龙');
  assert.equal(at(4), 'west', '凌晨 4 点还是西方龙');
  assert.equal(at(5), 'west', '凌晨 5 点（6 点前）还是西方龙');
  assert.equal(at(6), 'glider', '6 点回到飞鼠');
});

test('data: 时刻表覆盖全天 24 小时且只引用真实坐骑', () => {
  const ids = new Set(DATA.MOUNTS.map((m) => m.id));
  const seen = new Set();
  for (let h = 0; h < 24; h++) {
    const hh = h < 6 ? h + 24 : h;
    let hit = null;
    for (const b of DATA.SCHEDULE) {
      if (hh >= b.fromHour && hh < b.toHour) {
        hit = b.mounts[Math.floor((hh - b.fromHour) / b.stepHours) % b.mounts.length];
      }
    }
    assert.ok(hit, `小时 ${h} 没有命中任何时段桶`);
    assert.ok(ids.has(hit), `时刻表引用了不存在的坐骑 ${hit}`);
    seen.add(hit);
  }
  assert.ok(seen.size >= 5, `24 小时里出现的坐骑太少（${seen.size} 种）`);
});

test('ride: 滑翔交互只记数不推相位；自动段摘草立即到账', () => {
  const box = makeEngine();
  const eng = box.eng;
  eng.summon(box.t);
  box.advance(DATA.CONFIG.summonMs + 1);
  eng.board(box.t);
  /* 自动段：摘浮游三叶草 */
  const before = eng.view().clovers;
  assert.ok(eng.collectAutoPick(box.t).ok);
  assert.equal(eng.view().clovers, before + DATA.CONFIG.autoPickWorth);
  /* 滑翔段：撞圈计数 + 撞云计数 */
  box.advance(DATA.CONFIG.glideAtMs + 1);
  assert.equal(eng.glideRing(box.t).rings, 1);
  eng.glideRing(box.t); eng.glideRing(box.t);
  eng.cloudHit();
  assert.equal(eng.view().ride.rings, 3);
  assert.equal(eng.view().ride.cloudHits, 1);
  /* 非滑翔段时这些动作应被拒 */
  box.advance(DATA.CONFIG.glideLenMs + 1);
  assert.equal(eng.glideRing(box.t).reason, 'not-gliding');
  assert.equal(eng.cloudHit().reason, 'not-gliding');
});

test('ride: 光圈计入结算，previewLoot 是纯查询', () => {
  const box = makeEngine();
  const eng = box.eng;
  eng.summon(box.t);
  box.advance(DATA.CONFIG.summonMs + 1);
  eng.board(box.t);
  box.advance(DATA.CONFIG.glideAtMs + 1);
  eng.glideRing(box.t); eng.glideRing(box.t);
  box.advance(DATA.CONFIG.glideLenMs + 1);
  const r = eng.view().ride;
  box.advance(r.backAt - box.t + 1);
  const res = eng.settle(box.t);
  assert.equal(res.loot.ringClovers, 2 * DATA.GLIDE.ringWorth, '光圈应按价折三叶草');
  /* 纯查询：preview 不改状态 */
  const snap = JSON.stringify(eng.state);
  for (let i = 0; i < 10; i++) eng.previewLoot({ mountId: 'glider', destId: 'lake', departAt: box.t - 1000, rings: 1 }, box.t);
  assert.equal(JSON.stringify(eng.state), snap, 'previewLoot 不该改动状态');
});

/* ---------------- 3. 三叶草畦 ---------------- */
test('patch: 未熟不可收，成熟后收割并进冷却；harvestAll 只收熟的', () => {
  const box = makeEngine();
  const eng = box.eng;
  const v = eng.view();
  assert.equal(v.patch.length, DATA.CONFIG.patchCount);
  assert.equal(v.patch.filter((p) => p.ripe).length, DATA.CONFIG.patchCount, '开局应已长满');
  const before = eng.view().clovers;
  assert.ok(eng.harvestPatch(0, box.t).ok);
  assert.ok(eng.view().clovers > before);
  assert.equal(eng.harvestPatch(0, box.t).reason, 'not-ripe', '刚收完不能再收');
  assert.equal(eng.harvestAll(box.t).got, DATA.CONFIG.patchCount - 1, 'harvestAll 只收剩下的熟的');
  box.advance(DATA.CONFIG.patchRipenMs + 1);
  assert.equal(eng.view().patch.filter((p) => p.ripe).length, DATA.CONFIG.patchCount, '一个周期后应再长满');
});

/* ---------------- 4. 存档迁移 / 离线 ---------------- */
test('save: 旧版存档整体换新不崩；坏档回落到新档', () => {
  const store = memStorage();
  store.setItem(DATA.CONFIG.saveKey, JSON.stringify({ v: 1, clover: 99, plots: [] }));
  const eng = createEngine({ now: () => NOON, storage: store });
  assert.equal(eng.view().clovers, 8, '旧档不该带着旧经济字段，应换新');
  assert.equal(eng.isFresh, false, '有存档就不算新档');

  const store2 = memStorage();
  store2.setItem(DATA.CONFIG.saveKey, '{{{ 不是 json');
  const eng2 = createEngine({ now: () => NOON, storage: store2 });
  assert.equal(eng2.isFresh, true, '坏档应按新档处理');
  assert.equal(eng2.view().tripCount, 0);
});

test('save: 飞行中关掉重开——继续飞；过了落地时间重开——直接待结算', () => {
  /* 场景 1：还在飞（相位保留） */
  const store = memStorage();
  const box = { t: NOON };
  const eng = createEngine({ now: () => box.t, storage: store });
  eng.summon(box.t);
  box.t += DATA.CONFIG.summonMs + 1;
  eng.tick(box.t);
  eng.board(box.t);
  eng.save();
  const eng2 = createEngine({ now: () => box.t, storage: store });
  assert.equal(eng2.view().ride.phase, 'flying', '重开后应接着飞');

  /* 场景 2：过了落地时间（离线结算） */
  box.t = eng2.view().ride.backAt + 3600 * 1000;
  const eng3 = createEngine({ now: () => box.t, storage: store });
  assert.equal(eng3.view().ride.phase, 'landed', '离线越过落地时间应待结算');
  assert.ok(eng3.view().ride.loot.meters > 0, '离线期间里程应照算');
});

test('save: 行程中损坏字段不会 brick（无 mountId/destId 的 ride 被丢弃）', () => {
  const store = memStorage();
  store.setItem(DATA.CONFIG.saveKey, JSON.stringify({ v: 2, clovers: 5, ride: { phase: 'flying' } }));
  const eng = createEngine({ now: () => NOON, storage: store });
  assert.equal(eng.view().ride, null, '缺字段的行程应被丢弃');
  assert.equal(eng.view().clovers, 5, '其余数据保留');
});

/* ---------------- 5. 美术纯函数 ---------------- */
test('art: 每个坐骑、两个场景、结算卡都能产出 SVG', () => {
  for (const m of DATA.MOUNTS) {
    const svg = World.mountSVG(m.id, m.dayNight === 'night');
    assert.ok(/^<svg/.test(svg), `${m.id} 不是 SVG`);
    assert.ok(svg.includes('mount-' + m.art), `${m.id} 缺坐骑类名`);
    assert.ok(svg.includes('rider'), `${m.id} 背上应有乘客小鸡`);
  }
  const day = World.launchScene('day', [true, true, true, true]);
  const night = World.launchScene('night', [false, false, false, false]);
  assert.ok(day.includes('rider'), '出发台应有小鸡');
  assert.ok(night.includes('rider'), '夜间出发台也应有小鸡');
  assert.ok(day.length > 500);
  assert.ok(day !== night, '日夜出发台应不同');
  for (const d of DATA.DESTINATIONS) {
    const card = World.settleCardSVG(d.id, 'glider');
    assert.ok(card.length > 300, `${d.id} 结算卡太简单`);
  }
  const L = World.skyLayers('glider');
  for (const k of ['bg', 'far', 'mid', 'near']) assert.ok(L[k].length > 100, `天空层 ${k} 为空`);
  assert.ok(World.thermalSVG().length > 50 && World.stormCloudSVG().length > 50 &&
    World.ringSVG().length > 50 && World.wispSVG().length > 50, '滑翔道具应有造型');
});

test('art: 青蛙渲染器不受影响（乘客唯一渲染器仍在）', () => {
  for (const pose of Object.keys(Scene.POSES)) {
    assert.ok(Scene.frogFigure(pose).includes('frog-body'), `姿态 ${pose} 渲染失败`);
  }
  assert.ok(Scene.frogFigure('walk', { night: true }).includes('8cba55'), '夜景皮肤应还在');
});

/* ---------------- 6. 工程冒烟 ---------------- */
test('project smoke: 关键文件存在且 index.html 引用全部脚本', () => {
  const need = ['index.html', 'package.json', 'js/data.js', 'js/engine.js', 'js/scene.js', 'js/art.js', 'js/world.js', 'js/ui.js', 'js/main.js', 'css/style.css', 'css/flight.css'];
  for (const rel of need) assert.ok(fs.existsSync(path.join(ROOT, rel)), `缺少 ${rel}`);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const rel of ['js/data.js', 'js/engine.js', 'js/scene.js', 'js/art.js', 'js/world.js', 'js/ui.js', 'js/main.js']) {
    assert.ok(html.includes(rel), `index.html 未引用 ${rel}`);
  }
  assert.ok(html.includes('css/flight.css'), 'index.html 未引用 flight.css');
  assert.ok(!html.includes('行李'), '旧行李面板应从页面里拆掉');
  assert.ok(!html.includes('商店'), '旧商店应从页面里拆掉');
});

/* ---------------- 7. 新手引导标记 ---------------- */
test('onboard: 新档未看过引导；标记后生效', () => {
  const box = makeEngine();
  assert.equal(box.eng.view().onboarded, false);
  box.eng.markOnboarded();
  assert.equal(box.eng.view().onboarded, true);
});
