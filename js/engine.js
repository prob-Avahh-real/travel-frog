/* ============================================================
 * 旅行青蛙 · 引擎 (js/engine.js)
 * ------------------------------------------------------------
 * 单一职责：游戏状态机 + 时间推进 + 经济结算。
 * 全部副作用外置：now() 时钟、rng() 随机、storage 持久化 均可注入，
 * 因此可以在 Node 里直接跑确定性测试（见 test/）。
 * 不含任何 DOM / 渲染代码。
 * ============================================================ */
(function (root, factory) {
  var mod = factory(
    (typeof module === 'object' && module.exports)
      ? require('./data.js')
      : (root.TF && root.TF.DATA)
  );
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else { root.TF = root.TF || {}; root.TF.Engine = mod; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (DATA) {
  'use strict';

  /* ---------- 工具 ---------- */
  function mulberry32(seed) {                    // 可复现伪随机（测试/调试用）
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function memStorage() {
    var m = {};
    return {
      getItem: function (k) { return k in m ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; }
    };
  }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }
  function randInt(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }

  /* ---------- 构造 ---------- */
  function createEngine(opts) {
    opts = opts || {};
    var config = Object.assign({}, DATA.CONFIG, opts.config || {});
    config.garden = Object.assign({}, DATA.CONFIG.garden, (opts.config || {}).garden || {});
    config.visitor = Object.assign({}, DATA.CONFIG.visitor, (opts.config || {}).visitor || {});

    var nowFn = opts.now || function () { return Date.now(); };
    var rng = opts.rng || Math.random;
    var storage = opts.storage || memStorage();
    var scale = config.timeScale > 0 ? config.timeScale : 1;

    var state = null;
    var emit = [];
    var listeners = [];
    var fresh = false;              // 本次启动是否「无存档，从零开始」

    /* ---------- 新档 ---------- */
    function freshState(t) {
      var plots = [];
      for (var i = 0; i < config.garden.plots; i++) {
        plots.push({ readyAt: config.garden.startRipe ? t - 1 : t + config.garden.growMs / scale });
      }
      return {
        v: config.version,
        createdAt: t, updatedAt: t,
        clover: 0,
        fourLeaf: 0,
        plots: plots,
        pantry: {},          // 已购买：食物库存 {foodId: n}
        items: {},           // 已购买：道具库存 {itemId: n}
        packed: { food: null, items: [] },   // 行囊
        frog: { state: 'home', activity: 'idle', activityUntil: t + 12000, departAt: null, backAt: null, trip: null },
        album: [],           // 明信片
        souvenirs: {},       // 特产 {souvenirId: n}
        visitor: { state: 'none', until: null, nextAt: t + config.visitor.firstDelayMs / scale, fed: 0 },
        stats: { trips: 0, postcards: 0, harvested: 0, sold: 0, fed: 0 },
        log: []
      };
    }

    /* ---------- 事件 ---------- */
    function fire(ev) { ev.at = nowFn(); emit.push(ev); listeners.forEach(function (fn) { fn(ev); }); }
    function log(text) {
      state.log.unshift({ at: nowFn(), text: text });
      if (state.log.length > 40) state.log.length = 40;
    }

    /* ---------- 行囊效果汇总 ----------
     * 注意：地点解锁不在道具侧声明，统一由 LOCATIONS[].requires 决定，
     * 避免「道具说解锁 X / 地点说需要 Y」两套真相源对不上。 */
    function sumEffects(ids) {
      var eff = { dist: 0, duration: 0, rare: 0, times: [], guarantee: null, itemIds: (ids || []).slice() };
      eff.itemIds.forEach(function (id) {
        var it = DATA.ITEM_BY_ID[id];
        if (!it || !it.effects) return;
        var e = it.effects;
        eff.dist += e.dist || 0;
        eff.duration += e.duration || 0;
        eff.rare += e.rare || 0;
        if (e.times) eff.times = eff.times.concat(e.times);
        if (e.guarantee) eff.guarantee = e.guarantee;
      });
      return eff;
    }
    function packedEffects() { return sumEffects(state.packed.items); }

    /* 目的地候选：距离档相差不超过 1，且行囊满足该地点的 requires */
    function candidates(band, itemIds) {
      return DATA.LOCATIONS.filter(function (loc) {
        if (Math.abs(DATA.DIST.indexOf(loc.dist) - band) > 1) return false;
        return (loc.requires || []).every(function (r) { return itemIds.indexOf(r) >= 0; });
      });
    }

    /** 纯查询：这套行囊会去哪一档、能到哪些地方、大概走多久（不消耗随机数、不改状态） */
    function previewTrip(foodId, itemIds) {
      var food = DATA.FOOD_BY_ID[foodId];
      if (!food) return null;
      var eff = sumEffects(itemIds);
      var band = Math.min(DATA.DIST.length - 1, DATA.DIST.indexOf(food.dist) + eff.dist);
      var cands = candidates(band, eff.itemIds);
      var lo = Math.round(food.minMs * (1 + eff.duration) / scale);
      var hi = Math.round(food.maxMs * (1 + eff.duration) / scale);
      return {
        band: band, bandName: DATA.DIST[band],
        reachable: cands.map(function (l) { return { id: l.id, name: l.name, dist: l.dist }; }),
        durationMin: lo, durationMax: hi,
        rareBonus: eff.rare, guarantee: eff.guarantee
      };
    }

    /* ---------- 目的地抽选：只改数据表即可扩展 ---------- */
    function chooseLocation(band, packedIds) {
      var cands = candidates(band, packedIds);
      if (!cands.length) return DATA.LOC_BY_ID.forest;
      var weights = cands.map(function (loc) {
        var w = 10;
        if (DATA.DIST.indexOf(loc.dist) === band) w += 15;
        (loc.requires || []).forEach(function () { w += 6; });
        return w;
      });
      var total = weights.reduce(function (a, b) { return a + b; }, 0);
      var r = rng() * total;
      for (var i = 0; i < cands.length; i++) { r -= weights[i]; if (r <= 0) return cands[i]; }
      return cands[cands.length - 1];
    }

    /* ---------- 特产索引：id 形如 "locId:名称" ---------- */
    var SOUVENIR_INDEX = (function () {
      var m = {};
      DATA.LOCATIONS.forEach(function (l) {
        l.souvenirs.forEach(function (s) {
          m[l.id + ':' + s[0]] = { id: l.id + ':' + s[0], name: s[0], value: s[1], rarity: s[2], locId: l.id, locName: l.name };
        });
      });
      return m;
    })();
    function souvenirInfo(sid) { return SOUVENIR_INDEX[sid] || null; }

    /* ---------- 明信片抽选 ---------- */
    function choosePostcard(loc, rareBonus, guarantee, timesPref) {
      var pool = loc.scenes.map(function (s) {
        return { time: s[0], pose: s[1], caption: s[2], rarity: s[3] };
      });
      // 提灯等道具：偏好时段（把命中时段的场景权重翻倍，而非强行只出夜景）
      if (timesPref && timesPref.length) {
        pool.slice().forEach(function (s) {
          if (timesPref.indexOf(s.time) >= 0) pool.push(s);
        });
      }
      var base = {
        common: Math.max(0.05, DATA.CONFIG.rarityBase.common - rareBonus),
        rare: DATA.CONFIG.rarityBase.rare + rareBonus,
        epic: DATA.CONFIG.rarityBase.epic + rareBonus * 0.5
      };
      var order = ['common', 'rare', 'epic'];
      if (guarantee === 'rare') { base.common = 0; }
      var r = rng() * (base.common + base.rare + base.epic);
      var tier = 'common';
      for (var i = 0; i < order.length; i++) {
        if (r < base[order[i]]) { tier = order[i]; break; }
        r -= base[order[i]];
      }
      var tierPool = pool.filter(function (s) { return s.rarity === tier; });
      if (!tierPool.length) {
        // 该地点没有这个稀有度 → 退到「不高于该档」里最接近的一档。
        // （不能退到最低档：否则要 epic 的请求会掉成 common，把稀有度权重整个废掉）
        var want = DATA.RARITY_ORDER[tier];
        var avail = pool.filter(function (s) { return DATA.RARITY_ORDER[s.rarity] <= want; });
        if (avail.length) {
          var best = avail.reduce(function (m, s) { return Math.max(m, DATA.RARITY_ORDER[s.rarity]); }, 0);
          tierPool = avail.filter(function (s) { return DATA.RARITY_ORDER[s.rarity] === best; });
        } else {
          tierPool = pool;
        }
      }
      var s = pick(rng, tierPool);
      return {
        locId: loc.id,
        sceneId: loc.id + ':' + s.time + ':' + s.pose,
        time: s.time, pose: s.pose, caption: s.caption, rarity: s.rarity
      };
    }

    function chooseSouvenirs(loc, tier, rng2) {
      var pool = loc.souvenirs.map(function (s) { return { id: loc.id + ':' + s[0], name: s[0], value: s[1], rarity: s[2] }; });
      var n = tier === 'epic' ? 2 : (rng2() < 0.45 ? 2 : 1);
      var out = [], bag = pool.slice();
      for (var i = 0; i < n && bag.length; i++) {
        out.push(bag.splice(Math.floor(rng2() * bag.length), 1)[0]);
      }
      return out;
    }

    /* ---------- 出发 ---------- */
    function prepareTrip(t) {
      var food = DATA.FOOD_BY_ID[state.packed.food];
      if (!food) return null;
      var eff = packedEffects();
      var band = Math.min(DATA.DIST.length - 1, DATA.DIST.indexOf(food.dist) + eff.dist);
      var loc = chooseLocation(band, eff.itemIds);
      var dur = food.minMs + rng() * (food.maxMs - food.minMs);
      dur = Math.round(dur * (1 + eff.duration) / scale);
      var pc = choosePostcard(loc, eff.rare, eff.guarantee, eff.times);
      var souv = chooseSouvenirs(loc, pc.rarity, rng);
      var clover = 2 + DATA.DIST.indexOf(loc.dist) * 2 + (DATA.RARITY_ORDER[pc.rarity] * 3);
      return {
        foodId: food.id, foodName: food.name, itemIds: state.packed.items.slice(),
        locId: loc.id, locName: loc.name, dist: loc.dist,
        departAt: t, backAt: t + dur, postcard: pc, souvenirs: souv, clover: clover
      };
    }

    /* ---------- 归来结算 ---------- */
    function resolveReturn(t) {
      var trip = state.frog.trip;
      if (!trip) return;
      var pc = trip.postcard;
      var card = Object.assign({}, pc, { id: pc.sceneId + '#' + state.album.length, at: t, tripIndex: state.stats.trips });
      state.album.push(card);
      state.stats.postcards = state.album.length;
      trip.souvenirs.forEach(function (s) {
        state.souvenirs[s.id] = (state.souvenirs[s.id] || 0) + 1;
      });
      state.clover += trip.clover;
      state.frog.state = 'home';
      state.frog.activity = 'eat';
      state.frog.activityUntil = t + 15000;
      state.frog.departAt = null; state.frog.backAt = null;
      state.frog.trip = null;
      log('青蛙从「' + trip.locName + '」回来了。');
      var before = currentTitleIndex();
      if (before !== titleIndexFor(state.album.length)) {
        log('称号变成「' + DATA.TITLES[titleIndexFor(state.album.length)].name + '」了。');
      }
      fire({ type: 'return', trip: trip, card: card, souvenirs: trip.souvenirs, clover: trip.clover });
      return trip;
    }

    function titleIndexFor(n) {
      var idx = 0;
      DATA.TITLES.forEach(function (t, i) { if (n >= t.min) idx = i; });
      return idx;
    }
    function currentTitleIndex() { return titleIndexFor(state.album.length); }
    function title() { return DATA.TITLES[currentTitleIndex()].name; }

    /** 推进时间；返回本次产生的事件（副作用已记录在 state/log） */
    function tick(t) {
      t = (t === undefined) ? nowFn() : t;
      emit = [];

      // 1) 三叶草田
      state.plots.forEach(function (p, i) {
        if (p.readyAt !== null && p.readyAt <= t && !p.wasRipe) {
          p.wasRipe = true;
        }
      });

      // 2) 在家的活动轮换
      if (state.frog.state === 'home') {
        if (!state.frog.activityUntil || t >= state.frog.activityUntil) {
          var a = pick(rng, DATA.ACTIVITIES);
          state.frog.activity = a.id;
          state.frog.activityUntil = t + randInt(rng, a.minMs / scale, a.maxMs / scale);
        }
      }

      // 3) 出发倒计时 → 上路
      if (state.frog.state === 'departing' && t >= state.frog.departAt) {
        var trip = prepareTrip(state.frog.departAt);
        if (trip) {
          state.packed = { food: null, items: [] };     // 行囊消耗
          state.frog.state = 'away';
          state.frog.trip = trip;
          state.frog.backAt = trip.backAt;
          state.stats.trips++;
          log('青蛙带着「' + trip.foodName + '」出发了。');
          fire({ type: 'depart', trip: trip });
        } else {
          state.frog.state = 'home';
        }
      }

      // 4) 归来
      if (state.frog.state === 'away' && state.frog.backAt !== null && t >= state.frog.backAt) {
        resolveReturn(t);
      }

      // 5) 蜗牛访客
      var v = state.visitor;
      var everyMs = config.visitor.everyMs / scale, stayMs = config.visitor.stayMs / scale;
      if (v.state === 'none' && v.nextAt !== null && t >= v.nextAt) {
        if (rng() < config.visitor.arriveChance) {
          v.state = 'waiting'; v.until = t + stayMs;
          log('蜗牛来门口等你了。');
          fire({ type: 'visitor-arrive', until: v.until });
        } else {
          v.nextAt = t + everyMs;
        }
      } else if (v.state === 'waiting' && t >= v.until) {
        v.state = 'none'; v.nextAt = t + everyMs;
        log('蜗牛等不到东西，走了。');
        fire({ type: 'visitor-left' });
      }

      state.updatedAt = t;
      return emit.slice();
    }

    /* ---------- 玩家动作 ---------- */
    function isRipe(i) { return state.plots[i] && state.plots[i].readyAt !== null && state.plots[i].readyAt <= nowFn(); }

    function harvest(i) {
      var t = nowFn();
      var p = state.plots[i];
      if (!p) return null;
      if (p.readyAt === null || p.readyAt > t) return null;
      var got = { clover: 1, fourLeaf: 0 };
      var lucky = rng() < config.garden.fourLeafChance;
      if (lucky) got.fourLeaf = 1;
      state.clover += got.clover;
      state.fourLeaf += got.fourLeaf;
      state.stats.harvested += got.clover + got.fourLeaf;
      p.readyAt = t + config.garden.growMs / scale;
      p.wasRipe = false;
      log('收割：三叶草 +1' + (lucky ? '，还捡到一棵四叶草！' : ''));
      fire({ type: 'harvest', index: i, clover: got.clover, fourLeaf: got.fourLeaf });
      return got;
    }

    function harvestAll() {
      var n = { clover: 0, fourLeaf: 0, count: 0 };
      state.plots.forEach(function (p, i) {
        if (p.readyAt !== null && p.readyAt <= nowFn()) {
          var g = harvest(i);
          if (g) { n.clover += g.clover; n.fourLeaf += g.fourLeaf; n.count++; }
        }
      });
      return n;
    }

    function buy(kind, id, qty) {
      qty = qty || 1;
      var table = kind === 'food' ? DATA.FOOD_BY_ID : DATA.ITEM_BY_ID;
      var it = table[id];
      if (!it || it.loot) return false;               // 四叶草不可购买
      var cost = it.price * qty;
      if (state.clover < cost) return false;
      state.clover -= cost;
      var bin = kind === 'food' ? 'pantry' : 'items';
      state[bin][id] = (state[bin][id] || 0) + qty;
      log('买了「' + it.name + '」×' + qty + '。');
      fire({ type: 'buy', kind: kind, id: id, qty: qty, cost: cost });
      return true;
    }

    /** 打包行囊：一个便当 + 最多 3 件道具（可含四叶草） */
    function pack(foodId, itemIds) {
      itemIds = (itemIds || []).slice(0, 3);
      if (foodId && !(state.pantry[foodId] > 0)) return false;
      var need = {};
      itemIds.forEach(function (id) { need[id] = (need[id] || 0) + 1; });
      for (var id in need) {
        var have = id === 'fourleaf' ? state.fourLeaf : (state.items[id] || 0);
        if (have < need[id]) return false;
      }
      // 归还旧行囊里的东西
      unpack(true);
      if (foodId) { state.pantry[foodId]--; }
      itemIds.forEach(function (id) {
        if (id === 'fourleaf') state.fourLeaf--; else state.items[id]--;
      });
      state.packed = { food: foodId || null, items: itemIds };
      if (foodId) log('行囊里放进了「' + DATA.FOOD_BY_ID[foodId].name + '」。');
      return true;
    }

    function unpack(silent) {
      var p = state.packed;
      if (p.food) { state.pantry[p.food] = (state.pantry[p.food] || 0) + 1; }
      p.items.forEach(function (id) {
        if (id === 'fourleaf') state.fourLeaf++; else state.items[id] = (state.items[id] || 0) + 1;
      });
      state.packed = { food: null, items: [] };
      if (!silent) fire({ type: 'unpack' });
    }

    /** 行囊备好 → 青蛙磨蹭一会儿后出发 */
    function depart() {
      if (state.frog.state !== 'home' || !state.packed.food) return false;
      state.frog.state = 'departing';
      state.frog.departAt = nowFn() + config.departDelayMs / scale;
      log('青蛙开始收拾行李……');
      fire({ type: 'departing', at: state.frog.departAt });
      return true;
    }

    /** 直接立刻出发（跳过磨蹭，供调试/测试） */
    function departNow() {
      if (state.frog.state !== 'home' || !state.packed.food) return false;
      state.frog.state = 'departing';
      state.frog.departAt = nowFn();
      tick(nowFn());
      return true;
    }

    function sellSouvenir(sid, qty) {
      qty = qty || 1;
      var have = state.souvenirs[sid] || 0;
      if (have < qty) return false;
      var info = souvenirInfo(sid);
      if (!info) return false;
      var gain = Math.round(info.value * qty * config.souvenirSellRate);
      state.souvenirs[sid] -= qty;
      if (!state.souvenirs[sid]) delete state.souvenirs[sid];
      state.clover += gain;
      state.stats.sold += qty;
      log('卖掉 ' + qty + ' 件特产，三叶草 +' + gain + '。');
      fire({ type: 'sell', id: sid, qty: qty, gain: gain });
      return gain;
    }

    /** 喂蜗牛：消耗一件特产，回礼三叶草 + 概率回赠道具 */
    function feedVisitor(sid) {
      var v = state.visitor;
      if (v.state !== 'waiting') return null;
      if (!(state.souvenirs[sid] > 0)) return null;
      var info = souvenirInfo(sid);
      if (!info) return null;
      var value = info.value;
      state.souvenirs[sid]--;
      if (!state.souvenirs[sid]) delete state.souvenirs[sid];
      var clover = Math.max(3, Math.round(value * 1.6));
      state.clover += clover;
      var gift = null;
      if (rng() < 0.35) {
        var pool = DATA.ITEMS.filter(function (i) { return !i.loot; });
        gift = pick(rng, pool).id;
        state.items[gift] = (state.items[gift] || 0) + 1;
      }
      v.state = 'none'; v.fed++; v.nextAt = nowFn() + config.visitor.everyMs / scale;
      state.stats.fed++;
      log('蜗牛吃到了，回礼三叶草 +' + clover + (gift ? '，还留下一件道具。' : '。'));
      fire({ type: 'visitor-fed', id: sid, clover: clover, gift: gift });
      return { clover: clover, gift: gift };
    }

    /* ---------- 存档 ---------- */
    function save() {
      try { storage.setItem(config.saveKey, JSON.stringify(state)); return true; }
      catch (e) { return false; }
    }
    function load() {
      var raw = null;
      try { raw = storage.getItem(config.saveKey); } catch (e) { raw = null; }
      if (!raw) { state = freshState(nowFn()); fresh = true; return false; }
      try {
        var s = JSON.parse(raw);
        state = migrate(s);
        fresh = false;
        return true;
      } catch (e) { state = freshState(nowFn()); fresh = true; return false; }
    }
    /** 存档迁移：格子数变化时补齐，避免加配置后老档崩 */
    function migrate(s) {
      var t = nowFn();
      if (!s.plots) s.plots = [];
      while (s.plots.length < config.garden.plots) s.plots.push({ readyAt: t - 1 });
      if (s.plots.length > config.garden.plots) s.plots.length = config.garden.plots;
      s.packed = s.packed || { food: null, items: [] };
      s.pantry = s.pantry || {}; s.items = s.items || {}; s.souvenirs = s.souvenirs || {};
      s.album = s.album || []; s.stats = s.stats || { trips: 0, postcards: 0, harvested: 0, sold: 0, fed: 0 };
      s.visitor = s.visitor || { state: 'none', until: null, nextAt: t, fed: 0 };
      s.frog = s.frog || { state: 'home', activity: 'idle', activityUntil: t, departAt: null, backAt: null, trip: null };
      s.log = s.log || [];
      if (s.frog.state === 'departing' && s.frog.departAt === null) s.frog.state = 'home';
      return s;
    }
    function reset() { state = freshState(nowFn()); fresh = true; save(); }

    /* ---------- 只读视图 ---------- */
    function view() {
      var t = nowFn();
      return {
        t: t, clover: state.clover, fourLeaf: state.fourLeaf,
        plots: state.plots.map(function (p, i) {
          var ripe = p.readyAt !== null && p.readyAt <= t;
          return { i: i, ripe: ripe, progress: ripe ? 1 : 1 - Math.max(0, (p.readyAt - t)) / (config.garden.growMs / scale) };
        }),
        ripeCount: state.plots.filter(function (p) { return p.readyAt !== null && p.readyAt <= t; }).length,
        pantry: state.pantry, items: state.items, fourleafStock: state.fourLeaf,
        packed: state.packed, frog: state.frog,
        album: state.album, souvenirs: state.souvenirs, visitor: state.visitor,
        stats: state.stats, log: state.log, title: title(), titleIndex: currentTitleIndex()
      };
    }

    /* ---------- 调试/测试用的时间跳跃 ---------- */
    function advance(ms) {
      var t = nowFn() + ms;
      var all = [];
      var step = Math.max(1000, Math.round(ms / 60));
      for (var x = nowFn(); x < t; x += step) { all = all.concat(tick(x)); }
      all = all.concat(tick(t));
      return all;
    }

    /* ---------- 启动 ---------- */
    load();
    tick(nowFn());                     // 追赶离线进度
    var catchUp = emit.slice();

    return {
      get data() { return DATA; },
      get config() { return config; },
      get state() { return state; },
      get isFresh() { return fresh; },
      get catchUpEvents() { return catchUp; },
      on: function (fn) { listeners.push(fn); },
      tick: tick, advance: advance,
      harvest: harvest, harvestAll: harvestAll, isRipe: isRipe,
      buy: buy, pack: pack, unpack: unpack, depart: depart, departNow: departNow,
      previewTrip: previewTrip,
      sellSouvenir: sellSouvenir, feedVisitor: feedVisitor,
      title: title, titleIndex: currentTitleIndex, titleIndexFor: titleIndexFor,
      save: save, load: load, reset: reset, view: view,
      _mulberry32: mulberry32, _memStorage: memStorage
    };
  }

  return { createEngine: createEngine, mulberry32: mulberry32, memStorage: memStorage };
});
