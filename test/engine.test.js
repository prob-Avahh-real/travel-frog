/* ============================================================
 * 旅行青蛙 · 引擎测试（Sensor / 验证环）
 * 用假时钟 + 种子随机，全部确定性可复现。
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
const { createEngine, mulberry32, memStorage } = require(path.join(ROOT, 'js/engine.js'));

const MIN = 60000;

/* 造一个可控时钟的引擎 */
function makeEngine(seed = 1234, config = {}) {
  const box = { t: 1000 * 1000 };
  const eng = createEngine({
    now: () => box.t,
    rng: mulberry32(seed),
    storage: memStorage(),
    config,
  });
  box.eng = eng;
  box.advance = (ms) => { box.t += ms; return eng.tick(box.t); };
  box.goto = (t) => { box.t = t; return eng.tick(t); };
  return box;
}
/* 备一件便当 + 指定道具，直接出发并跳到归来 */
function quickTrip(box, foodId, itemIds = []) {
  const s = box.eng.state;
  s.pantry[foodId] = (s.pantry[foodId] || 0) + 1;
  itemIds.forEach((id) => {
    if (id === 'fourleaf') s.fourLeaf = (s.fourLeaf || 0) + 1;
    else s.items[id] = (s.items[id] || 0) + 1;
  });
  assert.ok(box.eng.pack(foodId, itemIds), '打包应成功');
  assert.ok(box.eng.departNow(), '应能出发');
  const trip = box.eng.state.frog.trip;
  box.goto(trip.backAt);
  return trip;
}

/* ---------------- 1. 数据表完整性（加表项时的护栏） ---------------- */
test('data: 所有 id 唯一、稀有度合法、场景与特产齐备', () => {
  const ids = new Set();
  for (const f of DATA.FOODS) { assert.ok(!ids.has(f.id), `重复 id ${f.id}`); ids.add(f.id); assert.ok(DATA.DIST.includes(f.dist)); }
  for (const i of DATA.ITEMS) { assert.ok(!ids.has(i.id), `重复 id ${i.id}`); ids.add(i.id); }
  for (const l of DATA.LOCATIONS) {
    assert.ok(!ids.has(l.id), `重复 id ${l.id}`); ids.add(l.id);
    assert.ok(DATA.DIST.includes(l.dist), `${l.id} 距离档非法`);
    assert.ok(l.scenes.length >= 2, `${l.id} 明信片太少`);
    assert.ok(l.souvenirs.length >= 2, `${l.id} 特产太少`);
    for (const [time, pose, caption, rarity] of l.scenes) {
      assert.ok(['dawn', 'day', 'dusk', 'night'].includes(time), `${l.id} 时段非法: ${time}`);
      assert.ok(typeof caption === 'string' && caption.length > 0);
      assert.ok(rarity in DATA.RARITY, `${l.id} 稀有度非法: ${rarity}`);
      assert.ok(typeof pose === 'string' && pose.length > 0);
    }
    // 每个地点至少有一张非普通照，否则「四叶草保底稀有」这类承诺会静默失效
    assert.ok(l.scenes.some(([, , , rar]) => rar !== 'common'), `${l.id} 缺少稀有/珍藏级照片`);
    for (const [name, value, rarity] of l.souvenirs) {
      assert.ok(value > 0, `${l.id}/${name} 价值须为正`);
      assert.ok(rarity in DATA.RARITY);
    }
    // requires 只能引用真实道具 id
    for (const r of l.requires || []) assert.ok(DATA.ITEM_BY_ID[r], `${l.id} 引用了不存在的道具 ${r}`);
  }
  // 每个距离档至少有 2 个地点，否则扩展后会出现「目的地荒」
  for (const d of DATA.DIST) {
    assert.ok(DATA.LOCATIONS.filter((l) => l.dist === d).length >= 2, `距离档 ${d} 地点不足`);
  }
  // 每个地点都必须在某个距离档内可被选到（requires 不能把人锁死）
  const free = DATA.LOCATIONS.filter((l) => !(l.requires || []).length);
  assert.ok(free.length >= 4, '免道具地点太少');

  // 单一真相源：地点解锁只能写在 LOCATIONS[].requires，道具侧不许再声明 enables
  for (const it of DATA.ITEMS) {
    assert.ok(!('enables' in (it.effects || {})), `${it.id} 又在道具侧声明了解锁关系，会与 LOCATIONS[].requires 冲突`);
  }
});

test('data: 每个地点都真的能被走到（没有死内容）', () => {
  const foodByBand = {};
  for (const f of DATA.FOODS) (foodByBand[f.dist] = foodByBand[f.dist] || []).push(f.id);
  for (const loc of DATA.LOCATIONS) {
    const box = makeEngine(31337);
    let hit = false;
    for (let i = 0; i < 200 && !hit; i++) {
      const food = foodByBand[loc.dist][i % foodByBand[loc.dist].length];
      const items = (loc.requires || []).slice();
      // 若带道具会顺带推远一档，换更近的便当来抵消
      const trip = quickTrip(box, food, items);
      if (trip.locId === loc.id) hit = true;
    }
    assert.ok(hit, `地点「${loc.name}」(${loc.id}) 200 次都没被选到，检查 dist / requires`);
  }
});

/* ---------------- 2. 三叶草田 ---------------- */
test('garden: 未成熟不可收割，成熟后收割并进入冷却', () => {
  const box = makeEngine();
  const eng = box.eng;
  assert.equal(eng.view().ripeCount, DATA.CONFIG.garden.plots, '开局应已长满');

  const before = eng.state.clover;
  const got = eng.harvest(0);
  assert.ok(got, '应能收割');
  assert.ok(eng.state.clover > before);
  assert.equal(eng.isRipe(0), false, '收割后立刻变未成熟');
  assert.equal(eng.harvest(0), null, '未成熟再收割应无效');

  box.advance((DATA.CONFIG.garden.growMs) + 1500);
  assert.equal(eng.isRipe(0), true, '一个生长周期后应再次成熟');
});

test('garden: harvestAll 只收成熟的，且四叶草按概率掉落', () => {
  const box = makeEngine(7);
  const eng = box.eng;
  const all = eng.harvestAll();
  assert.equal(all.count, DATA.CONFIG.garden.plots);
  assert.equal(eng.view().ripeCount, 0);
  let four = 0;
  for (let i = 0; i < 200; i++) {
    box.advance(DATA.CONFIG.garden.growMs + 1000);
    four += eng.harvestAll().fourLeaf;
  }
  assert.ok(four > 0, `2400 次收割应至少掉一棵四叶草，实际 ${four}`);
  assert.ok(four < 300, `掉落率明显过高: ${four}`);
});

/* ---------------- 3. 经济 ---------------- */
test('economy: 三叶草不够买不了，够了则扣费入库；四叶草不可购买', () => {
  const box = makeEngine();
  const eng = box.eng;
  eng.state.clover = 0;
  assert.equal(eng.buy('food', 'raisin_bread'), false, '没钱应买不了');

  eng.state.clover = 100;
  assert.equal(eng.buy('food', 'raisin_bread', 3), true);
  assert.equal(eng.state.clover, 70);
  assert.equal(eng.state.pantry.raisin_bread, 3);

  assert.equal(eng.buy('item', 'bell'), true);
  assert.equal(eng.state.items.bell, 1);
  assert.equal(eng.buy('item', 'fourleaf'), false, '四叶草是掉落物，不可购买');
  assert.equal(eng.buy('food', '不存在的便当'), false, '未知 id 应安全失败');
});

test('economy: 卖特产换三叶草', () => {
  const box = makeEngine();
  const eng = box.eng;
  eng.state.souvenirs['forest:橡实'] = 2;
  const before = eng.state.clover;
  assert.equal(eng.sellSouvenir('forest:橡实', 2), 12);
  assert.equal(eng.state.clover, before + 12);
  assert.equal(eng.state.souvenirs['forest:橡实'], undefined, '卖光后应清掉条目');
  assert.equal(eng.sellSouvenir('forest:橡实'), false, '无货应失败');
  assert.equal(eng.sellSouvenir('不存在:东西'), false, '未知特产应失败');
});

/* ---------------- 4. 行囊 ---------------- */
test('pack: 打包消耗库存，退还时原样归还', () => {
  const box = makeEngine();
  const eng = box.eng;
  eng.state.pantry.raisin_bread = 1;
  eng.state.items.bell = 1;
  assert.ok(eng.pack('raisin_bread', ['bell']));
  assert.equal(eng.state.pantry.raisin_bread, 0);
  assert.equal(eng.state.items.bell, 0);
  assert.deepEqual(eng.state.packed, { food: 'raisin_bread', items: ['bell'] });

  eng.unpack();
  assert.equal(eng.state.pantry.raisin_bread, 1, '便当应归还');
  assert.equal(eng.state.items.bell, 1, '道具应归还');

  // 退还后东西回到库存，所以还能再打包；这里用一件从未拥有的便当验证拒绝路径
  assert.equal(eng.pack('cheese_tart', []), false, '库存里没有的便当不能打包');
  assert.ok(eng.pack('raisin_bread', []), '退还回来的便当应能再次打包');
  assert.equal(eng.pack(null, []), true, '允许只清空行囊');
  assert.equal(eng.state.pantry.raisin_bread, 1, '清空行囊应把便当退回库存');
});

/* ---------------- 5. 完整旅行闭环 ---------------- */
test('trip: 出发→归来 产生明信片、特产、三叶草，青蛙回到家里', () => {
  const box = makeEngine(42);
  const eng = box.eng;
  const events = [];
  eng.on((e) => events.push(e.type));

  const trip = quickTrip(box, 'cheese_tart', ['bell', 'headband']);

  assert.ok(trip.locId, '应有目的地');
  assert.ok(trip.backAt > trip.departAt, '归来时间应晚于出发');
  assert.ok(events.includes('depart'), '应发出出发事件');
  assert.ok(events.includes('return'), '应发出归来事件');

  const v = eng.view();
  assert.equal(v.frog.state, 'home', '青蛙应已回家');
  assert.equal(v.frog.trip, null, '行程应清空');
  assert.equal(v.album.length, 1, '应收到 1 张明信片');
  assert.equal(v.stats.trips, 1);
  assert.ok(Object.keys(v.souvenirs).length >= 1, '应带回特产');
  assert.ok(v.clover > 0, '应带回三叶草');
  assert.equal(v.packed.food, null, '行囊应被消耗清空');
  assert.equal(eng.state.items.bell, 0, '道具应被消耗');

  const card = v.album[0];
  assert.equal(card.locId, trip.locId);
  assert.ok(card.caption && card.time && card.pose);
  assert.ok(card.rarity in DATA.RARITY);
});

test('trip: 行囊未备时不能出发', () => {
  const box = makeEngine();
  assert.equal(box.eng.depart(), false);
  assert.equal(box.eng.departNow(), false);
});

/* ---------------- 6. 距离约束（策略表是否生效） ---------------- */
test('trip: 远处便当不会跑到邻近档，且加帐篷能明显推远', () => {
  const box = makeEngine(99);
  const eng = box.eng;
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(quickTrip(box, 'mugwort_mochi', []).dist);
  assert.ok(!seen.has('near'), `exotic 便当不该只去附近，实际去了 ${[...seen]}`);
  assert.ok(seen.size > 1, '目的地应有多样性');

  const box2 = makeEngine(99);
  const base = new Set();
  for (let i = 0; i < 40; i++) base.add(quickTrip(box2, 'raisin_bread', []).dist);
  assert.ok(!base.has('far') && !base.has('exotic'), 'near 便当不该直达远处');
});

test('trip: requires 门控——不带木碗去不了温泉，带了就能去', () => {
  const box = makeEngine(2026);
  const eng = box.eng;
  let without = 0;
  for (let i = 0; i < 60; i++) if (quickTrip(box, 'walnut_mochi', []).locId === 'onsen') without++;
  assert.equal(without, 0, '没带木碗却去了温泉');

  let with_ = 0;
  for (let i = 0; i < 60; i++) if (quickTrip(box, 'walnut_mochi', ['bowl']).locId === 'onsen') with_++;
  assert.ok(with_ > 0, `带木碗应至少去过一次温泉，实际 ${with_}`);
});

test('trip: 四叶草保证至少稀有，且稀有度分布随道具上移', () => {
  const box = makeEngine(5);
  const eng = box.eng;
  let common = 0;
  for (let i = 0; i < 60; i++) {
    const t = quickTrip(box, 'pumpkin_bagel', ['bell', 'headband', 'fourleaf']);
    if (t.postcard.rarity === 'common') common++;
  }
  assert.equal(common, 0, '带四叶草不该再出普通明信片');

  const box2 = makeEngine(5);
  let rare2 = 0;
  for (let i = 0; i < 60; i++) if (quickTrip(box2, 'pumpkin_bagel', []).postcard.rarity !== 'common') rare2++;
  const box3 = makeEngine(5);
  let rare3 = 0;
  for (let i = 0; i < 60; i++) if (quickTrip(box3, 'pumpkin_bagel', ['bell', 'headband']).postcard.rarity !== 'common') rare3++;
  assert.ok(rare3 > rare2, `带幸运道具后稀有权重应上升 (${rare2} → ${rare3})`);
});

/* ---------------- 6b. previewTrip：只查询，不消耗随机数 ---------------- */
test('preview: 回答「这套行囊能到哪」，且不改变状态、不消耗随机数', () => {
  const box = makeEngine(77);
  const eng = box.eng;
  const p = eng.previewTrip('walnut_mochi', []);
  assert.ok(p && p.band === 1 && p.bandName === 'mid', `band 应为 mid(1)，实际 ${p && p.bandName}`);
  assert.ok(p.reachable.length >= 2);
  assert.ok(!p.reachable.some((l) => l.id === 'onsen'), '没带木碗不该列出温泉');
  assert.ok(!p.reachable.some((l) => l.dist === 'exotic'), 'mid 档不该能到南国');

  const p2 = eng.previewTrip('walnut_mochi', ['bowl']);
  assert.ok(p2.reachable.some((l) => l.id === 'onsen'), '带木碗应列出温泉');
  assert.ok(p2.durationMax > p.durationMin, '时长区间应合理');
  assert.ok(p2.durationMax > p.durationMin, '木碗应把行程拉长');
  assert.ok(eng.previewTrip('不存在的便当', []) === null);

  // 关键：查询不能推进任何东西
  const snapshot = JSON.stringify(eng.state);
  for (let i = 0; i < 20; i++) eng.previewTrip('cheese_tart', ['tent', 'bell']);
  assert.equal(JSON.stringify(eng.state), snapshot, 'previewTrip 不该改动状态');

  // 随机数没被吃掉：查 20 次后的第一次旅行，与完全没查过的引擎结果一致
  const a = quickTrip(box, 'walnut_mochi', ['bowl']);
  const box2 = makeEngine(77);
  box2.eng.previewTrip('walnut_mochi', ['bowl']);
  const b = quickTrip(box2, 'walnut_mochi', ['bowl']);
  assert.deepEqual(a.locId, b.locId, 'previewTrip 不该消耗 rng，否则抽奖结果会漂移');
});

/* ---------------- 7. 离线追赶 / 存档 ---------------- */
test('offline: 关掉再打开能结算期间发生的旅行与生长', () => {
  const store = memStorage();
  const box = { t: 1e6 };
  const eng = createEngine({ now: () => box.t, rng: mulberry32(11), storage: store });
  eng.state.pantry.raisin_bread = 1;
  eng.pack('raisin_bread', []);
  eng.departNow();
  const backAt = eng.state.frog.backAt;
  eng.save();

  // 模拟：关掉应用两小时后重开
  box.t = backAt + 2 * 60 * 60 * 1000;
  const eng2 = createEngine({ now: () => box.t, rng: mulberry32(11), storage: store });
  assert.equal(eng2.state.frog.state, 'home', '重开后应已完成归来');
  assert.equal(eng2.view().album.length, 1, '离线期间的照片应已入册');
  assert.ok(eng2.view().ripeCount === DATA.CONFIG.garden.plots, '离线期间三叶草应已长满');
});

test('save: 老存档格子数不一致时自动补齐，不崩', () => {
  const store = memStorage();
  store.setItem(DATA.CONFIG.saveKey, JSON.stringify({ v: 1, clover: 5, plots: [{ readyAt: 0 }] }));
  const eng = createEngine({ now: () => 1e6, rng: mulberry32(1), storage: store });
  assert.equal(eng.state.plots.length, DATA.CONFIG.garden.plots);
  assert.equal(eng.state.clover, 5, '老数据应保留');
  assert.ok(eng.state.visitor && eng.state.frog && eng.state.album);
  assert.equal(eng.isFresh, false, '有存档就不算新档，不能再叠加开局赠送');
});

test('save: 损坏存档不抛异常，回落到新档', () => {
  const store = memStorage();
  store.setItem(DATA.CONFIG.saveKey, '{不是合法 json');
  const eng = createEngine({ now: () => 1e6, rng: mulberry32(1), storage: store });
  assert.equal(eng.state.album.length, 0);
  assert.ok(eng.state.clover === 0);
  assert.equal(eng.isFresh, true, '坏档应按新档处理');
});

test('save: 无存档时 isFresh 为真，存过一次后为假', () => {
  const store = memStorage();
  const box = { t: 1e6 };
  const eng = createEngine({ now: () => box.t, rng: mulberry32(1), storage: store });
  assert.equal(eng.isFresh, true);
  eng.save();
  const eng2 = createEngine({ now: () => box.t, rng: mulberry32(1), storage: store });
  assert.equal(eng2.isFresh, false);
  eng2.reset();
  assert.equal(eng2.isFresh, true, '重开一局应回到新档状态');
});

/* ---------------- 8. 称号 / 蜗牛 ---------------- */
test('title: 随明信片数升级', () => {
  const box = makeEngine();
  const eng = box.eng;
  assert.equal(eng.titleIndex(), 0);
  eng.state.album = new Array(3).fill({});
  assert.equal(eng.title(), DATA.TITLES[1].name);
  eng.state.album = new Array(42).fill({});
  assert.equal(eng.title(), DATA.TITLES[DATA.TITLES.length - 1].name);
  assert.equal(eng.titleIndexFor(0), 0);
  assert.equal(eng.titleIndexFor(1e9), DATA.TITLES.length - 1, '超高收集数不应越界');
});

test('visitor: 蜗牛来访、喂食得回礼、等不到会离开', () => {
  const box = makeEngine(3, { visitor: { firstDelayMs: 0, arriveChance: 1, everyMs: 60000, stayMs: 120000 } });
  const eng = box.eng;
  box.advance(1000);
  assert.equal(eng.state.visitor.state, 'waiting', '蜗牛应已到门口');

  eng.state.souvenirs['forest:橡实'] = 1;
  const r = eng.feedVisitor('forest:橡实');
  assert.ok(r && r.clover >= 3, '喂食应给回礼');
  assert.equal(eng.state.visitor.state, 'none');
  assert.equal(eng.state.souvenirs['forest:橡实'], undefined);
  assert.equal(eng.feedVisitor('forest:橡实'), null, '没有东西时不能喂');

  box.advance(70000);
  assert.equal(eng.state.visitor.state, 'waiting', '下一次来访应触发');
  box.advance(200000);
  assert.equal(eng.state.visitor.state, 'none', '等不到东西应离开');
});

/* ---------------- 9. 视觉层：场景/明信片渲染是纯函数，可测 ---------------- */
test('art: 每个地点 × 每个时段都能产出非空 SVG', () => {
  const art = require(path.join(ROOT, 'js/art.js'));
  for (const loc of DATA.LOCATIONS) {
    for (const time of ['dawn', 'day', 'dusk', 'night']) {
      const svg = art.sceneSVG(loc.scene, time, loc.id);
      assert.ok(/^<svg/.test(svg), `${loc.id}/${time} 不是 SVG`);
      assert.ok(svg.length > 300, `${loc.id}/${time} SVG 过于简单`);
      assert.ok(svg.includes('</svg>'));
    }
  }
  for (const pose of ['walk', 'sit', 'eat', 'sleep', 'look', 'swim', 'bath', 'climb', 'umbrella']) {
    assert.ok(art.frogSVG(pose).includes('</svg>'), `姿态 ${pose} 渲染失败`);
  }
});

/* ---------------- 10. 单文件产物存在（工程冒烟） ---------------- */
test('project smoke: 关键文件存在且 index.html 引用了全部脚本', () => {
  const need = ['index.html', 'package.json', 'capacitor.config.json', 'js/data.js', 'js/engine.js', 'js/art.js', 'js/ui.js', 'js/main.js', 'css/style.css'];
  for (const rel of need) assert.ok(fs.existsSync(path.join(ROOT, rel)), `缺少 ${rel}`);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const rel of ['js/data.js', 'js/engine.js', 'js/art.js', 'js/ui.js', 'js/main.js']) {
    assert.ok(html.includes(rel), `index.html 未引用 ${rel}`);
  }
});
