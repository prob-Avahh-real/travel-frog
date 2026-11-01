/* ============================================================
 * 御风启程 · 引擎 (js/engine.js)
 * ------------------------------------------------------------
 * 单一职责：状态机 + 经济 + 时间。无 DOM、无 localStorage、无 Date.now()。
 * 副作用全部注入（now / storage / rng），Node 下可确定性测试。
 *
 * 旅程相位：summoning（摇铃后坐骑飞来）→ boarding（落地待登机）
 *          → flying（自动巡航，观看向）→ gliding（滑翔段，可操控）
 *          → flying（滑翔结束回巡航）→ landed（结算待收下）→ null（回家）
 * 相位切换全部由 tick(now) 按时间戳驱动；交互只改计数，不推相位。
 * ============================================================ */
(function (root, factory) {
  var mod = factory(typeof module === 'object' && module.exports ? require('./data.js') : (root.TF && root.TF.DATA));
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else { root.TF = root.TF || {}; root.TF.Engine = mod; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (DATA) {
  'use strict';

  var CFG = DATA.CONFIG;
  var METERS_PER_MS = 0.02;          // 120 秒 ≈ 2400 米

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
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

  function createEngine(opts) {
    opts = opts || {};
    var nowFn = opts.now || function () { return Date.now(); };
    var storage = opts.storage || memStorage();
    var offset = 0;
    function now() { return nowFn() + offset; }

    var emit = [], listeners = [];
    function fire(type, extra) {
      var ev = { type: type, at: now() };
      if (extra) Object.keys(extra).forEach(function (k) { ev[k] = extra[k]; });
      emit.push(ev);
      listeners.forEach(function (fn) { fn(ev); });
    }

    /* ---------- 存档 ---------- */
    function freshState(t) {
      var patch = [];
      for (var i = 0; i < CFG.patchCount; i++) patch.push({ readyAt: t });
      return {
        v: 2,
        clovers: 8,
        tripCount: 0,
        mementos: [],
        ride: null,
        lastLandAt: 0,
        patch: patch,
        onboarded: false
      };
    }

    function migrate(raw, t) {
      if (!raw || typeof raw !== 'object' || raw.v !== 2) return freshState(t);  // 旧档整体换新，不 brick
      var s = freshState(t);
      s.clovers = (typeof raw.clovers === 'number' && raw.clovers >= 0) ? raw.clovers : s.clovers;
      s.tripCount = raw.tripCount || 0;
      s.mementos = Array.isArray(raw.mementos) ? raw.mementos.slice() : [];
      s.onboarded = !!raw.onboarded;
      s.lastLandAt = typeof raw.lastLandAt === 'number' ? raw.lastLandAt : 0;
      if (raw.patch && Array.isArray(raw.patch)) {
        for (var i = 0; i < CFG.patchCount; i++) {
          var p = raw.patch[i];
          if (p && typeof p.readyAt === 'number') s.patch[i] = { readyAt: p.readyAt };
        }
      }
      /* 中途行程：字段齐全才保留（回来继续飞）；损坏或已过期 → 直接 landed 等收下 */
      if (raw.ride && typeof raw.ride === 'object') {
        var r = raw.ride;
        if (r.mountId && r.destId && typeof r.backAt === 'number') {
          s.ride = {
            id: r.id || 'r0', mountId: r.mountId, destId: r.destId,
            phase: (r.phase === 'summoning' || r.phase === 'boarding' || r.phase === 'flying' || r.phase === 'gliding') ? r.phase : 'landed',
            summonAt: r.summonAt || t, boardableAt: r.boardableAt || t,
            departAt: r.departAt || null, glideAt: r.glideAt || null, backAt: r.backAt,
            glidesPlanned: 1, glidesDone: r.glidesDone || 0,
            rings: r.rings || 0, cloudHits: r.cloudHits || 0, autoPick: r.autoPick || 0,
            loot: r.loot || null
          };
          if (s.ride.phase === 'landed') s.ride.loot = previewLootOf(s.ride, t);
        }
      }
      return s;
    }

    function save() {
      try { storage.setItem(CFG.saveKey, JSON.stringify(state)); } catch (e) { /* 存档失败不致命 */ }
    }

    /* ---------- 状态（读取失败 = 新档；坏档不 brick） ---------- */
    var freshFlag = false;
    function load(t) {
      var raw = null;
      try { raw = JSON.parse(storage.getItem(CFG.saveKey) || 'null'); } catch (e) { raw = null; }
      if (raw === null) { freshFlag = true; return freshState(t); }
      return migrate(raw, t);
    }
    var state = load(now());
    var isFresh = freshFlag;

    /* ---------- 纯查询 ---------- */
    function mountOf(r) { return DATA.MOUNT_BY_ID[r.mountId]; }
    function destOf(r) { return DATA.DEST_BY_ID[r.destId]; }
    function metersAt(r, t) {
      if (!r.departAt) return 0;
      var m = mountOf(r);
      return Math.max(0, t - r.departAt) * METERS_PER_MS * (m ? m.speed : 1);
    }
    function previewLootOf(r, t) {
      var m = mountOf(r), d = destOf(r);
      var meters = metersAt(r, t);
      return {
        meters: Math.round(meters),
        distClovers: Math.floor(meters / CFG.distPerClover),
        ringClovers: (r.rings || 0) * DATA.GLIDE.ringWorth,
        autoPick: r.autoPick || 0,
        memento: d ? d.memento : '',
        mountName: m ? m.name : '',
        destName: d ? d.name : ''
      };
    }

    function rideView(r) {
      if (!r) return null;
      return {
        id: r.id, mountId: r.mountId, destId: r.destId, phase: r.phase,
        departAt: r.departAt, glideAt: r.glideAt, backAt: r.backAt,
        rings: r.rings, autoPick: r.autoPick, cloudHits: r.cloudHits,
        progress: r.backAt && r.departAt ? Math.min(1, (now() - r.departAt) / (r.backAt - r.departAt)) : 0,
        loot: r.loot
      };
    }

    function view() {
      var t = now();
      var patch = state.patch.map(function (p) { return { readyAt: p.readyAt, ripe: t >= p.readyAt }; });
      return {
        t: t,
        clovers: state.clovers, tripCount: state.tripCount, mementos: state.mementos.slice(),
        ride: rideView(state.ride), patch: patch,
        cooldownLeft: Math.max(0, state.lastLandAt + CFG.summonCooldownMs - t),
        onboarded: state.onboarded
      };
    }

    /* ---------- 相位推进（唯一驱动源：时间戳） ---------- */
    function tick(t) {
      t = (t === undefined) ? now() : t;
      var r = state.ride;
      if (r) {
        if (r.phase === 'summoning' && t >= r.boardableAt) {
          r.phase = 'boarding';
        } else if (r.phase === 'flying' && r.glideAt && t >= r.glideAt && r.glidesDone < r.glidesPlanned) {
          r.phase = 'gliding'; fire('glide-start', { ride: rideView(r) });
        } else if (r.phase === 'gliding' && t >= r.glideAt + CFG.glideLenMs) {
          r.phase = 'flying'; r.glidesDone++; fire('glide-end', { ride: rideView(r) });
        }
        if ((r.phase === 'flying' || r.phase === 'gliding' || r.phase === 'boarding') && t >= r.backAt) {
          r.phase = 'landed';
          r.loot = previewLootOf(r, t);
          fire('landed', { ride: rideView(r) });
        }
      }
      return view();
    }

    /* ---------- 操作 ---------- */
    function harvestPatch(i, t) {
      t = (t === undefined) ? now() : t;
      var p = state.patch[i];
      if (!p) return { ok: false, reason: 'no-such-patch' };
      if (t < p.readyAt) return { ok: false, reason: 'not-ripe' };
      p.readyAt = t + CFG.patchRipenMs;
      state.clovers += CFG.patchWorth;
      fire('harvest', { patch: i });
      return { ok: true, clovers: state.clovers };
    }

    function harvestAll(t) {
      t = (t === undefined) ? now() : t;
      var got = 0;
      for (var i = 0; i < state.patch.length; i++) {
        if (t >= state.patch[i].readyAt) { state.patch[i].readyAt = t + CFG.patchRipenMs; got += CFG.patchWorth; }
      }
      if (got) { state.clovers += got; fire('harvest', { patch: -1, n: got }); }
      return { ok: true, got: got };
    }

    /* 坐骑按时刻表（data.js SCHEDULE）：白天/夜行分桶，桶内按小时轮换 */
    function pickMount(t) {
      var h = new Date(t).getHours();
      var hh = h < 6 ? h + 24 : h;     // 凌晨归入前一夜的桶
      for (var i = 0; i < DATA.SCHEDULE.length; i++) {
        var b = DATA.SCHEDULE[i];
        if (hh >= b.fromHour && hh < b.toHour) {
          return b.mounts[Math.floor((hh - b.fromHour) / b.stepHours) % b.mounts.length];
        }
      }
      return DATA.MOUNTS[0].id;
    }

    function summon(t) {
      t = (t === undefined) ? now() : t;
      if (state.ride) return { ok: false, reason: 'busy' };
      if (t < state.lastLandAt + CFG.summonCooldownMs) return { ok: false, reason: 'cooldown' };
      var d = DATA.DESTINATIONS[state.tripCount % DATA.DESTINATIONS.length];
      state.ride = {
        id: 'r' + state.tripCount, mountId: pickMount(t), destId: d.id,
        phase: 'summoning', summonAt: t, boardableAt: t + CFG.summonMs,
        departAt: null, glideAt: null, backAt: t + CFG.summonMs + CFG.flightMs,
        glidesPlanned: 1, glidesDone: 0, rings: 0, cloudHits: 0, autoPick: 0, loot: null
      };
      fire('summoned', { ride: rideView(state.ride) });
      return { ok: true };
    }

    function board(t) {
      t = (t === undefined) ? now() : t;
      var r = state.ride;
      if (!r) return { ok: false, reason: 'no-ride' };
      if (t < r.boardableAt) return { ok: false, reason: 'not-landed-yet' };
      if (r.phase !== 'boarding') return { ok: false, reason: 'not-boardable' };
      r.departAt = t;
      r.glideAt = t + CFG.glideAtMs;
      r.backAt = t + CFG.flightMs;
      r.phase = 'flying';
      fire('departed', { ride: rideView(r) });
      return { ok: true };
    }

    function collectAutoPick(t) {
      t = (t === undefined) ? now() : t;
      var r = state.ride;
      if (!r || r.phase !== 'flying') return { ok: false, reason: 'not-flying' };
      r.autoPick++;
      state.clovers += CFG.autoPickWorth;
      fire('pick', { ride: rideView(r) });
      return { ok: true };
    }

    function glideRing(t) {
      var r = state.ride;
      if (!r || r.phase !== 'gliding') return { ok: false, reason: 'not-gliding' };
      r.rings++;
      return { ok: true, rings: r.rings };
    }

    function cloudHit() {
      var r = state.ride;
      if (!r || r.phase !== 'gliding') return { ok: false, reason: 'not-gliding' };
      r.cloudHits++;
      return { ok: true };
    }

    function settle(t) {
      t = (t === undefined) ? now() : t;
      var r = state.ride;
      if (!r || r.phase !== 'landed' || !r.loot) return { ok: false, reason: 'not-landed' };
      var l = r.loot;
      state.clovers += l.distClovers + l.ringClovers;
      if (l.memento && state.mementos.indexOf(l.memento) < 0) state.mementos.push(l.memento);
      state.tripCount++;
      state.lastLandAt = t;
      state.ride = null;
      fire('settled', { loot: l });
      return { ok: true, loot: l };
    }

    function markOnboarded() { state.onboarded = true; save(); }

    /* ---------- 调试/测试：推进 offset 后按步长 tick（滑翔相位事件也能触发） ---------- */
    function advance(ms) {
      var from = now();
      offset += ms;
      var t = now();
      var step = Math.max(1000, Math.round(ms / 60));
      for (var x = from; x < t; x += step) tick(x);
      tick(t);
      return view();
    }

    /* ---------- 启动：追赶离线进度 ---------- */
    tick(now());

    return {
      state: state,
      isFresh: isFresh,
      view: view,
      tick: tick,
      summon: summon,
      board: board,
      harvestPatch: harvestPatch,
      harvestAll: harvestAll,
      collectAutoPick: collectAutoPick,
      glideRing: glideRing,
      cloudHit: cloudHit,
      settle: settle,
      previewLoot: previewLootOf,
      markOnboarded: markOnboarded,
      advance: advance,
      now: now,
      save: save,
      on: function (fn) { listeners.push(fn); },
      memStorage: memStorage
    };
  }

  return { createEngine: createEngine, memStorage: memStorage };
});
