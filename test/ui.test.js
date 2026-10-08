/* =========================================================================
 * 动量五重奏 —— UI 回归测试（Node 运行：node test/ui.test.js）
 * 用最小 DOM/Canvas 桩在 Node 中执行 game.js 全部代码路径，覆盖
 * test/physics.test.js 触及不到的 UI 行为（状态机/结算/存档/渲染门控）。
 * 用例来源：历次缺陷修复 + 对抗审查发现（详见 doc/reports/）。
 *   1) 无尽模式不继承上一关星星          （loadEndless 清空 G.stars）
 *   2) Esc 自动结算提示可见              （setHint 移到 showScreen 之后）
 *   3) 无尽中途退出最高分落盘 + 脏档容错 （settleEndless + loadSave 归一化）
 *   4) 弹丸 settle 期间持续绘制          （防「左下角瞬间消失」）
 *   5) 最后一发飞行中结算不双重计数      （endShot 回调浮层守卫）
 *   6) 慢镜头+结算浮层后重进不卡 0.39 倍速（resetShot 复位 timeScale）
 *   7) settle 中途回选关不绘制残弹       （draw 门控 screen==='play'）
 * ========================================================================= */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');

var failures = 0;
function check(name, cond, detail) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? '  [' + detail + ']' : ''));
  if (!cond) failures++;
}

// ---------------- 最小 DOM/Canvas 桩 ----------------
function buildEnv(opts) {
  opts = opts || {};
  function makeCtx2() {
    var grad = { addColorStop: function () {} };
    return new Proxy({}, {
      get: function (t, k) {
        if (k === 'createLinearGradient' || k === 'createRadialGradient') return function () { return grad; };
        if (k in t) return t[k];
        t[k] = function () {}; return t[k];
      },
      set: function (t, k, v) { t[k] = v; return true; }
    });
  }
  var createdButtons = [];
  function makeEl(tag) {
    var listeners = {};
    var el = {
      tagName: tag, children: [], _text: '', _html: '', className: '', title: '',
      disabled: false, width: 0, height: 0,
      style: { setProperty: function () {} },
      classList: { _s: Object.create(null),
        add: function (c) { this._s[c] = 1; }, remove: function (c) { delete this._s[c]; },
        contains: function (c) { return !!this._s[c]; },
        toggle: function (c, f) { var on = f === undefined ? !this._s[c] : !!f; if (on) this._s[c] = 1; else delete this._s[c]; return on; } },
      addEventListener: function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
      dispatch: function (type, ev) { (listeners[type] || []).forEach(function (fn) { fn(ev || {}); }); },
      appendChild: function (c) { this.children.push(c); return c; },
      getContext: function () { return this._ctx || (this._ctx = makeCtx2()); },
      get textContent() { return this._text; }, set textContent(v) { this._text = String(v); },
      get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); this.children = []; },
      onclick: null
    };
    if (tag === 'button' || tag === 'canvas') createdButtons.push(el);
    return el;
  }
  var byId = new Map(), rafQueue = [], winListeners = {}, timers = [];
  // 种子随机（可复现的无尽模式布局）
  var seed = (opts.seed || 1) >>> 0;
  var M = Object.create(Math);
  M.random = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  var store = {};
  if (opts.save !== undefined) store['momentum-quintet-v1'] = opts.save;
  var ctx = {
    console: console, Math: M, JSON: JSON, Object: Object, Array: Array,
    String: String, Number: Number, isFinite: isFinite,
    setTimeout: function (fn) { timers.push(fn); return timers.length; },
    clearTimeout: function (id) { if (id && timers[id - 1]) timers[id - 1] = null; }, // 真实取消语义（flush 跳过已取消项）
    document: {
      getElementById: function (id) { if (!byId.has(id)) byId.set(id, makeEl('div')); return byId.get(id); },
      createElement: function (t) { return makeEl(t); },
      querySelector: function () { return makeEl('div'); }
    },
    localStorage: {
      getItem: function (k) { return (k in store) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); }
    },
    requestAnimationFrame: function (fn) { rafQueue.push(fn); },
    addEventListener: function (type, fn) { (winListeners[type] = winListeners[type] || []).push(fn); },
    innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['physics', 'levels', 'audio', 'render', 'game'].forEach(function (n) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', n + '.js'), 'utf8'), ctx, { filename: 'js/' + n + '.js' });
  });

  // ---- 间谍 ----
  var starCalls = [], bellPos = [], projDraws = 0, projDrawsOnSelect = 0,
      stepProjAt = -1, settleDraws = 0, frameIdx = 0, cradleSteps = 0;
  var oStar = ctx.RENDER.drawStar, oBell = ctx.RENDER.drawBell,
      oProj = ctx.RENDER.drawProjectile, oStepP = ctx.PHYS.stepProjectile,
      oStepC = ctx.PHYS.stepCradle;
  ctx.RENDER.drawStar = function (c, s) { starCalls.push({ x: s.x, y: s.y, alive: s.alive }); return oStar.apply(this, arguments); };
  ctx.RENDER.drawBell = function (c, b) {
    if (!bellPos.some(function (x) { return Math.abs(x.x - b.x) < 2 && Math.abs(x.y - b.y) < 2; })) bellPos.push({ x: b.x, y: b.y, r: b.r });
    return oBell.apply(this, arguments);
  };
  ctx.RENDER.drawProjectile = function (c, f) {
    projDraws++;
    if (byId.get('screen-select') && byId.get('screen-select').classList.contains('show')) projDrawsOnSelect++;
    if (f && stepProjAt >= 0 && frameIdx > stepProjAt) settleDraws++;
    return oProj.apply(this, arguments);
  };
  ctx.PHYS.stepProjectile = function () { stepProjAt = frameIdx; return oStepP.apply(this, arguments); };
  ctx.PHYS.stepCradle = function () { cradleSteps++; return oStepC.apply(this, arguments); };

  var t = 0;
  var API = {
    ctx: ctx, store: store, id: function (n) { return byId.get(n); },
    cards: function () { return createdButtons.filter(function (b) { return b.tagName === 'button'; }); },
    key: function (k) { (winListeners.keydown || []).forEach(function (fn) { fn({ key: k }); }); },
    drive: function (n) {
      for (var i = 0; i < n; i++) { var fn = rafQueue.shift(); t += 16.7; frameIdx++; fn(t); }
    },
    flush: function () { var q = timers.splice(0); q.forEach(function (fn) { if (fn) fn(); }); },
    // 抓 1 号球拉到 deg 度并释放（一帧内完成 down→move→up）
    fireBall1: function (deg) {
      var cv = byId.get('game');
      var rad = deg * Math.PI / 180;
      cv.dispatch('pointerdown', { clientX: 1270, clientY: 430 });
      (winListeners.pointermove || []).forEach(function (fn) { fn({ clientX: 1270 + 300 * Math.sin(rad), clientY: 130 + 300 * Math.cos(rad) }); });
      (winListeners.pointerup || []).forEach(function (fn) { fn(); });
    }
  };
  API.counters = {
    starCalls: function () { return starCalls; }, bellPos: function () { return bellPos; },
    projDraws: function () { return projDraws; }, projDrawsOnSelect: function () { return projDrawsOnSelect; },
    settleDraws: function () { return settleDraws; },
    cradleWindow: function (n) { var a = cradleSteps; API.drive(n || 10); return cradleSteps - a; }
  };
  return API;
}

function enterLevel(E, i) { E.id('btn-start').onclick(); E.cards()[i].onclick(); E.drive(3); }
function enterEndless(E) { E.id('btn-start').onclick(); E.cards()[12].onclick(); E.drive(5); }

// ---------------- 1) 星星不泄漏进无尽 ----------------
console.log('== 1) 无尽模式不继承上一关星星 ==');
(function () {
  var E = buildEnv();
  enterLevel(E, 2); // 第 3 关有 1 颗星
  E.key('Escape'); E.drive(3);
  E.counters.starCalls().length = 0;
  enterEndless(E);
  var leaked = E.counters.starCalls().filter(function (s) {
    return s.alive && Math.abs(s.x - 540) < 2 && Math.abs(s.y - 700) < 2; });
  check('无尽第 1 轮无第 3 关星星', leaked.length === 0,
    '存活星星=' + JSON.stringify(E.counters.starCalls().filter(function (s) { return s.alive; }).map(function (s) { return [s.x, s.y]; })));
})();

// ---------------- 2) Esc 自动结算提示可见 ----------------
console.log('== 2) Esc 自动结算提示可见 ==');
(function () {
  var E = buildEnv();
  enterLevel(E, 0);
  E.fireBall1(80); E.drive(40);
  E.key('Escape');
  var h = E.id('hint');
  check('提示文本为自动结算且可见', h._text.indexOf('已自动结算') === 0 && h.classList.contains('show'),
    '"' + h._text.slice(0, 18) + '" show=' + h.classList.contains('show'));
})();

// ---------------- 3) 无尽中途退出落盘 + 脏档容错 ----------------
console.log('== 3) 无尽中途退出最高分落盘（含脏档容错） ==');
(function () {
  var E = buildEnv({ seed: 7, save: '{"endless":"99x","stars":"junk"}' }); // 脏档：endless 非数字
  enterEndless(E);
  check('脏档下 HUD「最高」显示数字而非 NaN', E.id('hud-target')._text === '0', 'hud-target=' + E.id('hud-target')._text);
  // 用种子布局计算命中弹道（抓最大的钟）
  var tgt = E.counters.bellPos().reduce(function (a, b) { return b.r > a.r ? b : a; });
  var drop = tgt.y - 430, dist = 1062 - tgt.x;
  var tFly = Math.sqrt(2 * Math.max(60, drop) / 1500);
  var v = (dist / tFly) * 1.07, base = v / 1.84;
  var alpha = Math.acos(Math.max(-1, 1 - base * base / 900000));
  E.fireBall1(alpha * 180 / Math.PI);
  E.drive(450);
  var score = +(E.id('hud-score')._text || 0);
  check('种子弹道命中钟拿到分数', score > 0, 'score=' + score);
  E.key('Escape');
  var saved = E.store['momentum-quintet-v1'];
  var ok = !!saved && JSON.parse(saved).endless === score;
  check('Esc 后最高分落盘为数字', ok, 'saved=' + saved);
})();

// ---------------- 4) 弹丸 settle 期间持续绘制 ----------------
console.log('== 4) 弹丸 settle 期间持续绘制 ==');
(function () {
  var E = buildEnv();
  enterLevel(E, 0);
  E.fireBall1(80);
  E.drive(300); // 覆盖 摆动→断弦→飞行→静置(settle)
  check('stepProjectile 停止后弹丸仍被绘制', E.counters.settleDraws() > 10, 'settle 绘制帧=' + E.counters.settleDraws());
})();

// ---------------- 5) 最后一发飞行中结算不双重计数 ----------------
console.log('== 5) 飞行中「结束结算」不双重计数 ==');
(function () {
  var E = buildEnv();
  enterLevel(E, 0);
  for (var i = 0; i < 4; i++) { E.fireBall1(80); E.drive(220); E.flush(); }
  check('前 4 发后 shots=1', E.id('hud-shots')._text === '1', 'shots=' + E.id('hud-shots')._text);
  E.fireBall1(80); E.drive(112);      // 最后一发飞行早期
  E.id('btn-finish').onclick();       // 弹结算浮层
  var tries1 = (E.id('result-box')._html.match(/第 (\d)\/3 次/) || [])[1];
  E.drive(300); E.flush();            // 弹丸静置 → endShot 650ms 回调
  var tries2 = (E.id('result-box')._html.match(/第 (\d)\/3 次/) || [])[1];
  check('回调触发后尝试次数不增加', tries1 === '1' && tries2 === '1', tries1 + '→' + tries2);
})();

// ---------------- 6) 慢镜头+结算浮层后重进不卡倍速 ----------------
console.log('== 6) 慢镜头期结算后重进，物理倍速复位 ==');
(function () {
  var E = buildEnv();
  enterLevel(E, 0);
  // 按第 1 关唯一钟的位置计算拉角（与用例 3 同法），确保弹道进入其 150px 慢镜头邻域
  // （修复错抓邻球后 fireBall1 弹速口径变化，固定 80° 不再稳定进入邻域）
  var tgt = E.counters.bellPos()[0];
  var drop = tgt.y - 430, dist = 1062 - tgt.x;
  var tFly = Math.sqrt(2 * Math.max(60, drop) / 1500);
  var v = (dist / tFly) * 1.07, base = v / 1.84;
  var alpha = Math.acos(Math.max(-1, 1 - base * base / 900000));
  E.fireBall1(alpha * 180 / Math.PI);
  // 逐帧捕获慢镜头窗口：弹丸经过钟 150px 邻域时每帧物理子步降到 ~1.5
  var sawSlow = false, guard = 0, minS = 99;
  while (!sawSlow && guard++ < 400) {
    var s = E.counters.cradleWindow(1);
    if (s < minS) minS = s;
    if (s < 2.5) sawSlow = true;
  }
  check('捕获到慢镜头窗口', sawSlow, sawSlow ? 'slow=' + minS.toFixed(2) + ' 步/帧' : '400 帧未捕获');
  if (!sawSlow) return;
  E.id('btn-finish').onclick();       // 慢镜头期弹浮层（物理冻结，endShot 的 timeScale 复位被阻断）
  E.drive(10); E.key('Escape');       // Esc → 选关（浮层期 Esc 不结算）
  E.cards()[0].onclick(); E.drive(3); // 重进第 1 关
  E.fireBall1(80); E.drive(2);        // 出手让摆动跑起来
  var after = E.counters.cradleWindow(10) / 10;
  check('重进后子步恢复正常(≥3.5)', after >= 3.5, 'after=' + after.toFixed(2) + ' 步/帧');
})();

// ---------------- 7) settle 中途回选关不绘制残弹 ----------------
console.log('== 7) 选关屏不绘制残留弹丸 ==');
(function () {
  var E = buildEnv();
  enterLevel(E, 0);
  E.fireBall1(80);
  E.drive(300);                       // 弹丸静置 settle 中
  var before = E.counters.projDraws();
  E.key('Escape'); E.drive(10);       // 中途回选关
  var added = E.counters.projDraws() - before;
  check('选关屏 0 次弹丸绘制', added === 0 && E.counters.projDrawsOnSelect() === 0, 'added=' + added);
})();

// ---------------- 8) 球心点击命中正确的球 ----------------
console.log('== 8) 球心点击命中正确的球（就近命中，不错抓邻球） ==');
(function () {
  var E = buildEnv();
  enterLevel(E, 0);
  var pulls = [];
  var oPull = E.ctx.PHYS.pullGroup;
  E.ctx.PHYS.pullGroup = function (cr, k, a) { pulls.push(k); return oPull.apply(this, arguments); };
  function tap(x) { // 只按下不移动/不松手：记录 pointerDown 选中的球号
    pulls.length = 0;
    E.id('game').dispatch('pointerdown', { clientX: x, clientY: 430 });
  }
  tap(1270); // 1 号球（最右）球心
  check('点 1 号球心 → 抓 1 号（k=0）', pulls[0] === 0, 'k=' + pulls[0]);
  tap(1218); // 2 号球球心
  check('点 2 号球心 → 抓 2 号（k=1）', pulls[0] === 1, 'k=' + pulls[0]);
  tap(1166); // 3 号球球心
  check('点 3 号球心 → 抓 3 号（k=2）', pulls[0] === 2, 'k=' + pulls[0]);
})();

// ---------------- 9) R 重玩按自动结算计一次 ----------------
console.log('== 9) R 重玩按自动结算计一次（防绕过 3 次结算预算） ==');
(function () {
  var E = buildEnv();
  enterLevel(E, 0);
  // 30° 小拉角：必断弦但打不中第 1 关的钟（得 0 分不达标），不触发通关锁定
  E.fireBall1(30); E.drive(2);   // 出手（usedShot=true）
  E.key('r'); E.drive(2);        // R → 自动结算第 1 次 + 重开本关（usedShot 复位）
  var n0 = E.cards().length;     // Esc 后 buildSelect 会新建一批卡片，须取新批次
  E.key('Escape'); E.drive(3);   // 未再出手 → Esc 不再结算
  var card = E.cards()[n0];
  var footHtml = (card.children[1] || {}).innerHTML || '';
  check('R 后选关卡片显示「已试 1/3」', footHtml.indexOf('已试 1/3') >= 0, footHtml);
})();

// ---------------- 10) endShot 悬空定时器不腰斩重开后的新出手 ----------------
console.log('== 10) 结算回调不腰斩重开后的新一次出手 ==');
(function () {
  var E = buildEnv();
  enterLevel(E, 0);
  E.fireBall1(30);
  E.drive(300);                  // 断弦→飞行→未中→静置 → endShot 挂起 650ms 回调（settle 期）
  E.key('r'); E.drive(2);        // R 重开（resetShot 应取消悬空回调）
  E.fireBall1(30);               // 立刻再出手一次
  var before = E.counters.projDraws();
  E.flush();                     // 悬空回调若未取消，此刻会 resetShot 杀掉本次出手
  E.drive(300);                  // 出手存活则：断弦→飞行→静置，弹丸持续绘制
  var drew = E.counters.projDraws() - before;
  check('重开后新出手完整走完（弹丸飞行被绘制）', drew > 10, 'drew=' + drew);
})();

// ---------------- 11) 第 12 关 Esc/R 自动结算恰好计一次（终局浮层） ----------------
console.log('== 11) 第 12 关终局路径不双重结算 ==');
(function () {
  // 10° 拉角弦不断（physics.test：10° 轻拉不断弦）→ 摆动失败复位：计一发、0 分，
  // 3 次用尽后第 3 次结算必触发 runOver——完全不依赖弹道命中
  function weakShot(E) { E.fireBall1(10); E.drive(460); }
  function l12card(E) { var c = E.cards(); return c[c.length - 2]; } // 每批 13 张，倒数第 2 = 第 12 关
  // Esc 路径：三次弱射三次 Esc → 第 3 次自动结算即整局终局
  var E1 = buildEnv();
  enterLevel(E1, 11);
  for (var i = 1; i <= 3; i++) {
    if (i > 1) { l12card(E1).onclick(); E1.drive(3); }
    weakShot(E1);
    E1.key('Escape'); E1.drive(3);
  }
  var h1 = (E1.id('result-box') || {})._html || '';
  var m1 = h1.match(/第 (\d+)\/3 次/);
  check('Esc×3 后终局浮层显示第 3/3 次', !!m1 && m1[1] === '3' && /挑战结束/.test(h1),
    m1 ? '第 ' + m1[1] + '/3 次' : '无匹配/未弹终局');
  // R 路径：三次弱射三次 R（前两次自动重开）→ 第 3 次结算即终局
  var E2 = buildEnv();
  enterLevel(E2, 11);
  for (var j = 1; j <= 3; j++) {
    weakShot(E2);
    E2.key('r'); E2.drive(3);
  }
  var h2 = (E2.id('result-box') || {})._html || '';
  var m2 = h2.match(/第 (\d+)\/3 次/);
  check('R×3 后终局浮层显示第 3/3 次', !!m2 && m2[1] === '3' && /挑战结束/.test(h2),
    m2 ? '第 ' + m2[1] + '/3 次' : '无匹配/未弹终局');
})();

// ---------------- 12) 布局结构守卫（防结构/分档/光标回退） ----------------
console.log('== 12) 布局结构与关键样式守卫 ==');
(function () {
  var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  var css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  check('index.html 含 select-head/select-body 结构', html.indexOf('select-head') >= 0 && html.indexOf('select-body') >= 0);
  check('选关屏 4×3+1 高度分档存在且限定侧栏模式', /@media \(min-height: 900px\) and \(min-width: 1151px\)/.test(css));
  check('画布光标为 default（防 grab 消失缺陷回退）', /#game \{[^}]*cursor: default/.test(css));
  check('网格顶与面板顶对齐结构（面板与网格同为 select-body 子元素）', /<div class="select-body">[\s\S]*?level-grid[\s\S]*?panel-select/.test(html));
  check('≤480 隐藏品牌页题 + ≤420 标题右侧居中让位（窄带规则在位）',
    /@media \(max-width: 480px\)[\s\S]{0,120}\.select-head \.brand\.page \{ display: none/.test(css) &&
    /@media \(max-width: 420px\)[\s\S]{0,160}\.select-head \{ padding-left: 136px; \}/.test(css));
  check('说明面板单栏化（一行一个说明，防双栏回退；白空格归一化防假绿/假红）',
    (function () {
      var n = ' ' + css.replace(/\s+/g, ' ') + ' ';
      return !/ ?\.score-list ?\{[^}]*column-count/.test(n) && !/ ?\.rule-list ?\{[^}]*column-count/.test(n) &&
        /\.score-list em ?\{[^}]*margin-left: ?auto/.test(n);
    })());
  check('首页两栏顶对齐（align-items: flex-start）', /\.title-wrap \{[^}]*align-items: flex-start/.test(css));
})();

console.log('\n' + (failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌'));
process.exit(failures === 0 ? 0 : 1);
