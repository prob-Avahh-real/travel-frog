/* ============================================================
 * 旅行青蛙 · 数据表 (js/data.js)
 * ------------------------------------------------------------
 * 单一职责：只放「表」与默认配置，不含任何逻辑与副作用。
 * 扩展方式（不动主循环）：
 *   新增地点  → 往 LOCATIONS 加一条（dist + scene + scenes + souvenirs）
 *   新增食物  → FOODS 加一条（dist 决定旅行距离档，minMs/maxMs 决定时长）
 *   新增道具  → ITEMS 加一条（effects: dist/duration/rare/enables）
 *   新增明信片 → 该地点的 scenes 数组加一条 [time, pose, caption, rarity]
 * UMD：浏览器挂到 window.TF.DATA；Node 里可 require（供测试）。
 * ============================================================ */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else { root.TF = root.TF || {}; root.TF.DATA = mod; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------- 默认配置（可被外部覆盖，例如 ?fast=1 加速调试） ---------- */
  var CONFIG = {
    version: 1,
    timeScale: 1,          // >1 表示加速（真实流逝 = 墙钟 × timeScale）
    tickMs: 250,           // UI 主循环步长
    garden: {
      plots: 12,           // 三叶草田格子数
      growMs: 45000,       // 每株三叶草长成所需时间
      fourLeafChance: 1 / 30, // 收割时额外掉四叶草的概率
      startRipe: true      // 首次进入是否已长满
    },
    visitor: {
      firstDelayMs: 60000, // 第一次蜗牛来访延迟
      everyMs: 180000,     // 之后每隔多久可能来一次
      stayMs: 300000,      // 停留时长
      arriveChance: 0.75   // 到点时真的来的概率
    },
    departDelayMs: 12000,  // 包好行囊后青蛙磨蹭多久才走
    rarityBase: { common: 0.70, rare: 0.26, epic: 0.04 },
    souvenirSellRate: 1,   // 卖特产的汇率（value * rate = 三叶草）
    saveKey: 'travel-frog-save-v1'
  };

  /* ---------- 距离档：食物/地点共用，档位差决定能不能去 ---------- */
  var DIST = ['near', 'mid', 'far', 'exotic'];

  /* ---------- 便当：价格 / 时长区间 / 距离档 ---------- */
  var FOODS = [
    { id: 'raisin_bread',  name: '葡萄干面包',   price: 10,  minMs: 20000,  maxMs: 45000,  dist: 'near',   desc: '最常见的干粮，青蛙嚼得很慢。' },
    { id: 'pumpkin_bagel', name: '南瓜百吉饼',   price: 20,  minMs: 45000,  maxMs: 95000,  dist: 'near',   desc: '烤得金黄，据说青蛙爱吃甜。' },
    { id: 'grape_scone',   name: '野葡萄司康',   price: 35,  minMs: 90000,  maxMs: 160000, dist: 'mid',    desc: '带一点野果的酸味。' },
    { id: 'walnut_mochi',  name: '核桃麻糬',     price: 55,  minMs: 150000, maxMs: 260000, dist: 'mid',    desc: '黏牙，但很顶饱。' },
    { id: 'cheese_tart',   name: '芝士挞',       price: 80,  minMs: 240000, maxMs: 380000, dist: 'far',    desc: '奢侈的一餐，走得也远。' },
    { id: 'spinach_quiche',name: '菠菜乳蛋饼',   price: 110, minMs: 360000, maxMs: 560000, dist: 'far',    desc: '营养均衡，适合长路。' },
    { id: 'eel_rice',      name: '鳗鱼饭',       price: 160, minMs: 540000, maxMs: 800000, dist: 'exotic', desc: '香气能飘出两座山。' },
    { id: 'mugwort_mochi', name: '艾草麻糬',     price: 220, minMs: 780000, maxMs: 1140000,dist: 'exotic', desc: '传闻吃了会去很远的地方。' }
  ];

  /* ---------- 道具：出发时消耗；effects 累加 ----------
   * 「某地需要某道具」写在 LOCATIONS[].requires，这里不重复声明解锁关系。 */
  var ITEMS = [
    { id: 'headband', name: '头巾',   price: 25, desc: '看起来很靠得住。', effects: { rare: 0.06 } },
    { id: 'bell',     name: '幸运铃', price: 30, desc: '叮铃铃，据说会带来好运。', effects: { rare: 0.08 } },
    { id: 'lantern',  name: '提灯',   price: 50, desc: '夜里也敢走。', effects: { rare: 0.05, times: ['night', 'dusk'] } },
    { id: 'bowl',     name: '木碗',   price: 40, desc: '能讨到当地的吃食。', effects: { duration: 0.25 } },
    { id: 'flask',    name: '水壶',   price: 45, desc: '装得下一整片沙漠的水。', effects: { rare: 0.03 } },
    { id: 'tent',     name: '帐篷',   price: 70, desc: '露宿野外也不怕。', effects: { dist: 1 } },
    { id: 'pass',     name: '通行证', price: 90, desc: '能过很远很远的关卡。', effects: { dist: 1, rare: 0.05 } },
    { id: 'fourleaf', name: '四叶草', price: 0,  desc: '田里偶尔长出的幸运符（不可购买）。', effects: { rare: 0.25, guarantee: 'rare' }, loot: true }
  ];

  /* ---------- 特产：可卖 / 可喂蜗牛 ---------- */
  /* ---------- 地点：scene 决定画面，scenes 决定明信片，souvenirs 决定特产 ---------- */
  /* scenes 条目格式：[time, pose, caption, rarity]，time = dawn|day|dusk|night */
  var LOCATIONS = [
    {
      id: 'forest', name: '森林', dist: 'near', scene: 'forest',
      scenes: [
        ['day',  'walk', '今天森林里很安静。', 'common'],
        ['dawn', 'look', '早上的雾还没散。', 'common'],
        ['dusk', 'sit',  '在这儿坐了会儿，听鸟叫。', 'rare']
      ],
      souvenirs: [['橡实', 6, 'common'], ['松果', 6, 'common'], ['蘑菇干', 14, 'rare']]
    },
    {
      id: 'river', name: '溪流', dist: 'near', scene: 'river',
      scenes: [
        ['day',  'walk', '水很凉，走过去脚一激灵。', 'common'],
        ['day',  'swim', '试着游了一段。', 'common'],
        ['dusk', 'look', '傍晚的水面是金色的。', 'rare']
      ],
      souvenirs: [['溪鱼', 8, 'common'], ['鹅卵石', 5, 'common'], ['水芹菜', 12, 'rare']]
    },
    {
      id: 'field', name: '田野', dist: 'near', scene: 'field',
      scenes: [
        ['day',  'walk', '风吹过来，草都在动。', 'common'],
        ['day',  'eat',  '在田埂上吃了午饭。', 'common'],
        ['night','look', '看到了很清楚的星星。', 'rare']
      ],
      souvenirs: [['刚拔的萝卜', 9, 'common'], ['麦穗束', 7, 'common'], ['野花', 15, 'rare']]
    },
    {
      id: 'beach', name: '海边', dist: 'mid', scene: 'beach',
      scenes: [
        ['day',  'walk', '今天海很平静。', 'common'],
        ['dusk', 'sit',  '看着太阳掉进水里。', 'common'],
        ['day',  'swim', '被浪翻了个跟头。', 'rare']
      ],
      souvenirs: [['贝壳', 12, 'common'], ['海玻璃', 18, 'common'], ['海盐罐', 30, 'rare']]
    },
    {
      id: 'lake', name: '湖畔', dist: 'mid', scene: 'lake',
      scenes: [
        ['dawn', 'look', '湖面上有雾。', 'common'],
        ['day',  'sit',  '有人在这里钓鱼。', 'common'],
        ['night','look', '月亮掉在湖里了。', 'rare']
      ],
      souvenirs: [['莲蓬', 14, 'common'], ['水草标本', 16, 'common'], ['湖石', 28, 'rare']]
    },
    {
      id: 'onsen', name: '温泉', dist: 'mid', scene: 'onsen', requires: ['bowl'],
      scenes: [
        ['day',  'bath', '泡了很久，皮肤都皱了。', 'common'],
        ['night','bath', '雪落在头顶，水是热的。', 'rare'],
        ['dusk', 'eat',  '温泉馒头很好吃。', 'common']
      ],
      souvenirs: [['温泉馒头', 22, 'common'], ['汤之花', 26, 'common'], ['木浴桶', 48, 'rare']]
    },
    {
      id: 'town', name: '小镇', dist: 'mid', scene: 'town',
      scenes: [
        ['day',  'walk', '街上很热闹。', 'common'],
        ['day',  'eat',  '在路边摊吃了团子。', 'common'],
        ['dusk', 'look', '路灯一盏一盏亮起来。', 'rare']
      ],
      souvenirs: [['团子', 16, 'common'], ['粗布手帕', 20, 'common'], ['陶风铃', 38, 'rare']]
    },
    {
      id: 'snow', name: '雪山', dist: 'far', scene: 'snow', requires: ['tent'],
      scenes: [
        ['day',  'climb', '风很大，雪很白。', 'common'],
        ['night','sleep', '在帐篷里睡了一夜。', 'rare'],
        ['dawn', 'look',  '看到云海了。', 'epic']
      ],
      souvenirs: [['雪水罐', 34, 'common'], ['冰晶', 44, 'common'], ['雪山地图', 80, 'rare']]
    },
    {
      id: 'desert', name: '沙漠', dist: 'far', scene: 'desert', requires: ['flask'],
      scenes: [
        ['day',  'walk', '沙子烫脚。', 'common'],
        ['dusk', 'sit',  '太阳把影子拉得很长。', 'common'],
        ['night','look', '沙漠的夜空像被洗过。', 'epic']
      ],
      souvenirs: [['沙玫瑰', 32, 'common'], ['干枣', 36, 'common'], ['骆驼铃', 72, 'rare']]
    },
    {
      id: 'temple', name: '古寺', dist: 'far', scene: 'temple',
      scenes: [
        ['dawn', 'sit',  '跟着听了一早上早课。', 'common'],
        ['day',  'walk', '石阶有三百级。', 'common'],
        ['dusk', 'look', '红叶掉在台阶上。', 'rare']
      ],
      souvenirs: [['御守', 40, 'common'], ['线香', 34, 'common'], ['旧经书', 90, 'rare']]
    },
    {
      id: 'castle', name: '古城堡', dist: 'far', scene: 'castle', requires: ['pass'],
      scenes: [
        ['day',  'look', '从城顶能看到整座城。', 'common'],
        ['dusk', 'walk', '护城河里有鸭子。', 'common'],
        ['night','look', '城亮灯了，很好看。', 'epic']
      ],
      souvenirs: [['城徽徽章', 52, 'common'], ['金箔糖', 46, 'common'], ['古地图', 110, 'rare']]
    },
    {
      id: 'port', name: '港町', dist: 'far', scene: 'port', requires: ['lantern'],
      scenes: [
        ['night','look', '灯塔的光一圈圈扫过来。', 'common'],
        ['dusk', 'walk', '码头上有猫在等鱼。', 'common'],
        ['night','eat',  '在船边吃了夜宵。', 'rare']
      ],
      souvenirs: [['海员结', 44, 'common'], ['鱼干', 38, 'common'], ['旧罗盘', 120, 'epic']]
    },
    {
      id: 'falls', name: '秘境瀑布', dist: 'exotic', scene: 'falls',
      scenes: [
        ['day',  'swim', '水声大得听不见自己。', 'common'],
        ['day',  'look', '潭水是蓝绿色的。', 'rare'],
        ['dawn', 'look', '彩虹从水雾里升起来。', 'epic']
      ],
      souvenirs: [['瀑布苔', 58, 'common'], ['潭底石', 66, 'common'], ['彩虹石', 180, 'epic']]
    },
    {
      id: 'tropics', name: '南国', dist: 'exotic', scene: 'tropics', requires: ['pass'],
      scenes: [
        ['day',  'swim', '海水很暖和。', 'common'],
        ['day',  'sleep', '在椰子树下睡了个午觉。', 'common'],
        ['night','look', '看见萤火虫了。', 'epic']
      ],
      souvenirs: [['椰子', 60, 'common'], ['海螺', 70, 'common'], ['菠萝干', 96, 'rare']]
    }
  ];

  /* ---------- 青蛙在家时的活动（自动轮换，纯演出） ---------- */
  var ACTIVITIES = [
    { id: 'idle',  name: '发呆',   minMs: 6000, maxMs: 14000 },
    { id: 'read',  name: '看书',   minMs: 12000, maxMs: 26000 },
    { id: 'write', name: '写信',   minMs: 10000, maxMs: 22000 },
    { id: 'whittle', name: '削木头', minMs: 14000, maxMs: 30000 },
    { id: 'eat',   name: '吃饭',   minMs: 8000, maxMs: 18000 },
    { id: 'nap',   name: '打瞌睡', minMs: 16000, maxMs: 34000 }
  ];

  /* ---------- 称号：按明信片收集数解锁 ---------- */
  var TITLES = [
    { min: 0,   name: '独自旅行的青蛙' },
    { min: 3,   name: '旅行初心者' },
    { min: 8,   name: '见闻者' },
    { min: 15,  name: '旅人' },
    { min: 24,  name: '漫游者' },
    { min: 34,  name: '大旅行家' },
    { min: 42,  name: '传说的旅蛙' }
  ];

  /* ---------- 明信片稀有度 → 展示样式 ---------- */
  var RARITY = {
    common: { name: '普通', cls: 'r-common' },
    rare:   { name: '稀有', cls: 'r-rare' },
    epic:   { name: '珍藏', cls: 'r-epic' }
  };

  /* 索引（供引擎 O(1) 查询） */
  var byId = function (arr) {
    var m = {}; arr.forEach(function (x) { m[x.id] = x; }); return m;
  };

  return {
    CONFIG: CONFIG,
    DIST: DIST,
    FOODS: FOODS,
    ITEMS: ITEMS,
    LOCATIONS: LOCATIONS,
    ACTIVITIES: ACTIVITIES,
    TITLES: TITLES,
    RARITY: RARITY,
    FOOD_BY_ID: byId(FOODS),
    ITEM_BY_ID: byId(ITEMS),
    LOC_BY_ID: byId(LOCATIONS),
    RARITY_ORDER: { common: 0, rare: 1, epic: 2 }
  };
});
