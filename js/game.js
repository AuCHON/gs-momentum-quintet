/* =========================================================================
 * 动量五重奏 —— 主逻辑：状态机、输入、计分、HUD、主循环
 * 依赖：physics.js(全局 PHYS) / levels.js(全局 LEVELS) / render.js / audio.js
 * ========================================================================= */
(function () {
  'use strict';

  // 摆台在右侧（dir=-1）：1 号重球最靠右，向右上拖拽释放，5 号铃球向左弹射
  // frameX=1270：任何拉角下整球可见（90° 时球缘 x≈1596，110° 时 x≈1578）
  var P = Object.assign({}, PHYS.DEFAULTS, { frameX: 1270, frameY: 130, dir: -1 });
  var W = RENDER.W, H = RENDER.H, FLOOR = RENDER.FLOOR;
  var PULL_MAX = 1.92; // 最大拉角 ≈110°（更大的拉角球会甩出画面顶端，且弹速早已够用）
  // 关卡数据按「摆台在左(x=210)、向右发射」编写；镜像并左移 120px 到当前布局：
  // 目标 x' = 1480−x，出手点 x' = 1062，距离 (1062−x') = (x−418)，射程关系不变
  function mirrorX(x) { return W - 120 - x; }
  var DT = 1 / 240;                 // 物理固定步长
  var COMBO_CAP = 5;                // 连击倍率上限
  var VMAX_METER = 1700;            // 弹速条满值
  var MAX_TRIES = 3;                // 每关最多结算次数，第 3 次为最终成绩

  // ---------------- DOM ----------------
  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('game'), ctx = canvas.getContext('2d');
  var hud = $('hud'), meterBox = $('meter'), tensionBar = $('tension-bar'),
      speedBar = $('speed-bar'), tensionTip = $('tension-tip'),
      hudLevel = $('hud-level'), hudScore = $('hud-score'), hudTarget = $('hud-target'),
      hudShots = $('hud-shots'),
      btnMute = $('btn-mute'), btnRestart = $('btn-restart'), btnBack = $('btn-back'),
      btnFinish = $('btn-finish'), btnRules = $('btn-rules'), panelPlay = $('panel-play'),
      overlayResult = $('overlay-result');

  // ---------------- 画布缩放（letterbox） ----------------
  var scale = 1, offX = 0, offY = 0;
  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var vw = window.innerWidth, vh = window.innerHeight;
    scale = Math.min(vw / W, vh / H);
    offX = (vw - W * scale) / 2; offY = (vh - H * scale) / 2;
    canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
    canvas.style.width = vw + 'px'; canvas.style.height = vh + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  function toLogical(e) {
    return { x: (e.clientX - offX) / scale, y: (e.clientY - offY) / scale };
  }

  // ---------------- 存档 ----------------
  var SAVE_KEY = 'momentum-quintet-v1';
  function loadSave() {
    var d = { endless: 0 }; // 本地只持久无尽最高分（星级随本局，重开即清；旧档 stars 字段废弃不读）
    try {
      var raw = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (raw && typeof raw === 'object') {
        d.endless = +raw.endless || 0; // 脏档容错：非数字（"99x"/null/NaN）一律归 0，防最高分永久无法刷新
      }
    } catch (e) { /* 损坏 JSON 用默认档 */ }
    return d;
  }
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {}
  }
  var save = loadSave();

  // ---------------- 游戏状态 ----------------
  var G = {
    screen: 'title',            // title | select | play
    mode: 'level',              // level | endless
    levelIdx: 0,
    level: null,
    phase: 'aim',               // aim | swing | fly | settle
    score: 0, shots: 0, usedShot: false,
    round: 1,                   // 无尽模式轮次
    bells: [], stars: [], walls: [],
    particles: [], popups: [],
    flying: null,               // 弹丸
    aim: { active: false, k: 0 },
    time: 0, swingTimer: 0, peakV5: 0,
    timeScale: 1, shake: 0,
    levelBest: {},        // 本局已通关关卡的得分（仅达标结算计入；通关即锁定）
    levelTime: {},        // 各关通关时的耗时（秒）
    levelTries: {},       // 各关已用结算次数（上限 MAX_TRIES）
    levelExhausted: {},   // 3 次用尽仍未达标的关卡（本局锁定）
    runStars: [],         // 本局各关星级（随本局重置；无尽最高分才持久保存）
    elapsed: 0,           // 当前关卡秒表
    nextIdx: 0,           // 「下一关」目标（跳过本局已通关）
    settleTimer: null,    // endShot 的 650ms 结算回调句柄（resetShot 时取消，防悬空触发）
    comboHits: 0, comboTimer: 0
  };

  function newCradle() { return PHYS.makeCradle(P, P.frameX, P.frameY); }
  var cradle = newCradle();

  // ---------------- 关卡装载 ----------------
  // 本局已锁定判定：已通关 或 3 次机会用尽仍未达标
  function levelLocked(idx) {
    var k = 'L' + (idx === undefined ? G.levelIdx : idx);
    return G.levelBest[k] !== undefined || G.levelExhausted[k] === true;
  }

  function loadLevel(idx) {
    if (levelLocked(idx)) { // 已通关的关卡本局不可重玩
      showScreen('select');
      setHint('本局已通关该关——返回主页「开新挑战」即可重玩'); // 须在 showScreen 之后，否则提示被立即收起
      return;
    }
    G.mode = 'level'; G.levelIdx = idx;
    G.levelTheme = (LEVELS.META[idx] || {}).color || null; // 关卡主题色（背景氛围/HUD）
    var L = LEVELS.LEVELS[idx];
    G.level = L;
    G.score = 0; G.shots = L.shots; G.comboHits = 0; G.elapsed = 0; G.usedShot = false;
    G.particles = []; G.popups = []; // 清空上一局残留的粒子与飘字
    G.bells = L.bells.map(cloneBell);
    G.stars = L.stars.map(function (s) { return { x: mirrorX(s.x), y: s.y, alive: true }; });
    G.walls = L.walls.map(function (w) {
      return { x: mirrorX(w.x + w.w), y: w.y, w: w.w, h: w.h }; // 矩形镜像取右缘翻转
    });
    resetShot();
    showScreen('play');
    setHint(L.hint);
  }

  // 无尽模式成绩收尾：本局明细 + 持久最高分（自然结算 / 中途离开 / 重开共用，幂等）
  function settleEndless() {
    if (G.mode !== 'endless' || G.screen !== 'play') return;
    if (G.score > (G.levelBest['E'] || 0)) { G.levelBest['E'] = G.score; G.levelTime['E'] = G.elapsed; }
    if (G.score > (save.endless || 0)) { save.endless = G.score; persist(); }
  }

  function loadEndless() {
    settleEndless(); // 从进行中的无尽局重开时，先把已有成绩落盘（防丢分）
    G.mode = 'endless'; G.level = null;
    G.levelTheme = '#66e2b8'; // 无尽模式固定薄荷绿主题
    G.score = 0; G.shots = 10; G.round = 1; G.comboHits = 0; G.elapsed = 0; G.usedShot = false;
    G.stars = []; G.particles = []; G.popups = []; // 清空上一模式残留（星星/粒子/飘字）
    spawnEndlessRound();
    resetShot();
    showScreen('play');
    setHint('无尽模式：清空所有钟进入下一轮（+2 弹丸 +150 分），看你能刷多高！');
  }

  function spawnEndlessRound() {
    var r = LEVELS.makeEndlessRound(G.round);
    G.bells = r.bells.map(cloneBell);
    G.stars = r.stars.map(function (s) { return { x: mirrorX(s.x), y: s.y, alive: true }; }); // 整组替换：上一轮未收集的星星不带入新轮
    G.walls = r.walls.map(function (w) {
      return { x: mirrorX(w.x + w.w), y: w.y, w: w.w, h: w.h };
    });
  }

  function cloneBell(b) {
    var x = mirrorX(b.x);
    return { x: x, y: b.y, baseX: x, baseY: b.y, r: b.r, pts: b.pts,
             note: b.note, move: b.move ? Object.assign({}, b.move) : null,
             ringT: 0, hitCd: 0 };
  }

  function resetShot() {
    clearTimeout(G.settleTimer); // 取消悬空的结算回调：否则重开/新拖拽会被它静默杀掉（拖拽被吞、摆动被腰斩）
    cradle = newCradle();
    G.flying = null; G.phase = 'aim'; G.aim.active = false;
    G.comboHits = 0; G.swingTimer = 0; G.peakV5 = 0;
    G.timeScale = 1; // 复位慢镜头：结算浮层冻结物理时 endShot 的复位不会执行，须在此兜底
    updateHud();
  }

  // ---------------- 屏幕切换 ----------------
  function showScreen(name) {
    G.screen = name;
    // 切页清理：取消瞄准、收起仪表/提示，避免残留悬浮在其它页面
    G.aim.active = false;
    meterBox.classList.remove('show');
    $('hint').classList.remove('show');
    if (name !== 'play') panelPlay.classList.remove('show');
    $('screen-title').classList.toggle('show', name === 'title');
    $('screen-select').classList.toggle('show', name === 'select');
    hud.classList.toggle('show', name === 'play');
    $('overlay-result').classList.remove('show');
    $('overlay-help').classList.remove('show');
    if (name === 'select') buildSelect();
  }

  var hintTimer = null;
  function setHint(text) {
    var el = $('hint');
    el.textContent = text; el.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { el.classList.remove('show'); }, 6500);
  }

  // ---------------- 选关界面 ----------------
  // 关卡缩略图：用关卡数据画迷你布局（摆台右侧 + 钟颜色/移动轨迹 + 墙 + 星）
  function drawLevelPreview(cv, L, themeColor) {
    var dpr = 2, cw = 150, ch = 84;
    cv.width = cw * dpr; cv.height = ch * dpr;
    var c = cv.getContext('2d');
    c.scale(dpr, dpr);
    var s = cw / 1600;
    var X = function (x) { return x * s; };
    var Y = function (y) { return y * s; };
    c.fillStyle = 'rgba(8,12,28,0.95)';
    c.fillRect(0, 0, cw, ch);
    // 地面
    c.fillStyle = '#333f6b';
    c.fillRect(0, Y(RENDER.FLOOR), cw, ch - Y(RENDER.FLOOR));
    // 牛顿摆（右侧，与游戏内镜像布局一致：金5号在左端）
    c.fillStyle = '#4a557f';
    c.fillRect(X(1036), Y(102), X(1336) - X(1036), 2.5);
    c.strokeStyle = 'rgba(190,205,240,0.55)';
    c.lineWidth = 0.8;
    for (var i = 0; i < 5; i++) {
      var px = 1270 - i * 52;
      c.beginPath(); c.moveTo(X(px), Y(130)); c.lineTo(X(px), Y(430)); c.stroke();
      c.fillStyle = i === 4 ? (themeColor || '#ffc94d') : '#6f9ce8';
      c.beginPath(); c.arc(X(px), Y(430), 2.4, 0, PHYS.TAU); c.fill();
    }
    // 墙
    (L.walls || []).forEach(function (w) {
      c.fillStyle = '#565f85';
      c.fillRect(X(mirrorX(w.x + w.w)), Y(w.y), Math.max(2, w.w * s), w.h * s);
    });
    // 钟（分值同色）+ 移动轨迹
    (L.bells || []).forEach(function (b) {
      var bx = mirrorX(b.x), by = b.y;
      if (b.move) {
        c.strokeStyle = 'rgba(160,180,240,0.4)';
        c.setLineDash([1.5, 2.5]);
        c.beginPath();
        if (b.move.axis === 'y') {
          c.moveTo(X(bx), Y(by - b.move.amp)); c.lineTo(X(bx), Y(by + b.move.amp));
        } else {
          c.moveTo(X(mirrorX(b.x - b.move.amp)), Y(by));
          c.lineTo(X(mirrorX(b.x + b.move.amp)), Y(by));
        }
        c.stroke();
        c.setLineDash([]);
      }
      c.fillStyle = RENDER.BELL_PAL[b.r >= 44 ? 0 : b.r >= 30 ? 1 : 2].mid;
      c.beginPath(); c.arc(X(bx), Y(by), Math.max(2.5, b.r * s), 0, PHYS.TAU); c.fill();
    });
    // 星星
    (L.stars || []).forEach(function (st) {
      c.fillStyle = '#ffd75e';
      RENDER.starPath(c, X(mirrorX(st.x)), Y(st.y), 3.4, 0);
      c.fill();
    });
  }

  function buildSelect() {
    var grid = $('level-grid');
    grid.innerHTML = '';
    LEVELS.LEVELS.forEach(function (L, i) {
      var meta = LEVELS.META[i];
      var st = G.runStars[i] || 0; // 星级随本局，重置后从零点亮
      var runSc = G.levelBest['L' + i];
      var exhausted = G.levelExhausted['L' + i] === true; // 3 次用尽未达标
      var locked = runSc !== undefined || exhausted;
      var card = document.createElement('button');
      card.className = 'level-card' + (locked ? ' locked' : '');
      card.disabled = locked;
      card.title = locked ? '本局已锁定；返回主页「开新挑战」可重玩' : '';
      card.style.setProperty('--c', meta.color);
      card.innerHTML =
        '<span class="lv-top"><span class="lv-num">' + (i + 1) + '</span>' +
        '<span class="lv-name">' + L.name + '</span></span>' +
        '<span class="lv-tag">' + meta.tag + '</span>';
      var map = document.createElement('canvas');
      map.className = 'lv-map';
      card.appendChild(map);
      var foot = document.createElement('span');
      foot.className = 'lv-foot';
      foot.innerHTML = locked
        ? (exhausted
            ? '<span class="lv-badge fail">✗ 3 次未达标</span>'
            : '<span class="lv-badge">✓ 已通关 ' + runSc + ' 分</span>')
        : '<span class="lv-stars">' + (G.levelTries['L' + i] ? '已试 ' + G.levelTries['L' + i] + '/3 · ' : '') +
          '★'.repeat(st) + '<span class="dim">' + '★'.repeat(3 - st) + '</span></span>';
      card.appendChild(foot);
      drawLevelPreview(map, L, meta.color);
      if (!locked) card.onclick = function () { SFX.click(); loadLevel(i); };
      grid.appendChild(card);
    });
    var endCard = document.createElement('button');
    endCard.className = 'level-card endless';
    endCard.style.setProperty('--c', '#66e2b8');
    endCard.innerHTML = '<span class="lv-top"><span class="lv-num">∞</span>' +
      '<span class="lv-name">无尽模式</span></span>' +
      '<span class="lv-tag">无限刷分</span>';
    var efoot = document.createElement('span');
    efoot.className = 'lv-foot lv-stars';
    efoot.textContent = '最高 ' + (save.endless || 0);
    endCard.appendChild(efoot);
    endCard.onclick = function () { SFX.click(); loadEndless(); };
    grid.appendChild(endCard);
  }

  // ---------------- 输入：拖拽牛顿摆 ----------------
  function pointerDown(e) {
    if (G.screen !== 'play') return;
    // 摆动中（弦没断）也允许直接抓球，跳过等待
    if (G.phase === 'swing') resetShot();
    if (G.phase !== 'aim') return;
    var pt = toLogical(e);
    // 命中 1~4 号球（可拉组）：抓半径内取「距离最小」的球。
    // 命中半径(2.2r=57.2)大于球间距(52)，若按固定顺序取首个命中，
    // 点球心会错抓左侧邻球——链放大倍率随之错档（×1.84→×1.62…）
    var best = -1, bestD = P.r * 2.2;
    for (var i = 0; i < 4; i++) {
      var pos = PHYS.ballPos(cradle.balls[i], P);
      var d = Math.hypot(pt.x - pos.x, pt.y - pos.y);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0) {
      G.aim.active = true; G.aim.k = best;
      meterBox.classList.add('show');
      pointerMove(e);
    }
  }

  function pointerMove(e) {
    if (!G.aim.active) return;
    var pt = toLogical(e);
    var b = cradle.balls[G.aim.k];
    var dx = pt.x - b.pivotX, dy = pt.y - b.pivotY;
    var ang = Math.atan2(dx, dy); // 相对竖直向下
    // 摆台在右(dir=-1)：向右上拖，角度限 10°..110°；在左则向左上
    ang = P.dir < 0 ? PHYS.clamp(ang, 0.17, PULL_MAX) : PHYS.clamp(ang, -PULL_MAX, -0.17);
    PHYS.pullGroup(cradle, G.aim.k, ang);
    updateMeter(ang);
  }

  function pointerUp() {
    if (!G.aim.active) return;
    G.aim.active = false;
    meterBox.classList.remove('show');
    var ang = Math.abs(cradle.balls[G.aim.k].a);
    if (ang < 0.17) { return; }   // 太小不算发射
    G.shots--; G.usedShot = true;
    G.phase = 'swing'; G.swingTimer = 0;
    SFX.shot();
    updateHud();
  }

  canvas.addEventListener('pointerdown', pointerDown);
  window.addEventListener('pointermove', pointerMove);
  window.addEventListener('pointerup', pointerUp);

  // ---------------- 瞄准仪表 ----------------
  function updateMeter(ang) {
    var k = G.aim.k + 1;
    var v = PHYS.predictSpeed(P, k, ang);
    speedBar.style.width = Math.min(100, v / VMAX_METER * 100) + '%';
    $('speed-num').textContent = Math.round(v);
    // 断线条件：T = m₅·(g + v₅²/L) > breakT（v₅ 用预估弹速）
    var tNow = P.massBell * (P.g + v * v / P.L);
    var willBreak = tNow > P.breakT;
    tensionBar.style.width = Math.min(100, tNow / P.breakT * 100) + '%';
    tensionBar.classList.toggle('ok', willBreak);
    tensionTip.textContent = willBreak ? '弦将断 → 弹射!' : '张力不足 · 拉再高一点';
    tensionTip.className = willBreak ? 'ok' : '';
  }

  // ---------------- 命中处理 ----------------
  function addPopup(x, y, text, color, big) {
    G.popups.push({ x: x, y: y, text: text, color: color, life: 1.1, big: !!big });
  }

  function burst(x, y, color, n, speed) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * PHYS.TAU, s = speed * (0.4 + Math.random());
      G.particles.push({
        x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60,
        grav: 700, r0: 2 + Math.random() * 3.5,
        color: color, life: 0.5 + Math.random() * 0.5, max: 1
      });
    }
  }

  function ringWave(x, y, color, r1) {
    G.particles.push({ x: x, y: y, vx: 0, vy: 0, shape: 'ring', r0: 10, r1: r1 || 70,
      color: color, life: 0.5, max: 0.5 });
  }

  function onBellHit(bell) {
    G.comboHits = Math.min(G.comboHits + 1, COMBO_CAP);
    var mult = G.comboHits;
    var pts = bell.pts * mult;
    G.score += pts;
    bell.ringT = 1; bell.hitCd = 0.3;
    // 无尽模式：钟被撞响后即消失（清空进入下一轮）
    if (G.mode === 'endless') {
      var idx = G.bells.indexOf(bell);
      if (idx >= 0) G.bells.splice(idx, 1);
    }
    // 分值配色（与计分图例一致）：大青铜 / 中蓝钢 / 小紫晶
    var pal = RENDER.BELL_PAL[RENDER.bellTier(bell)];
    SFX.bell(bell.note, mult - 1);
    addPopup(bell.x, bell.y - bell.r - 14, '+' + pts + (mult > 1 ? '  ×' + mult + ' 连击!' : ''), pal.pop, mult > 1);
    burst(bell.x, bell.y, pal.burst, 14, 260);
    ringWave(bell.x, bell.y, 'rgba(' + pal.rgb + ',0.8)', bell.r * 2);
    G.shake = Math.min(10, 4 + bell.pts / 60);
    updateHud();
  }

  function onStarHit(st) {
    st.alive = false;
    G.comboHits = Math.min(G.comboHits + 1, COMBO_CAP);
    var pts = 350 * G.comboHits;
    G.score += pts;
    SFX.star();
    addPopup(st.x, st.y - 34, '★ +' + pts, '#ffe98a', true);
    burst(st.x, st.y, '#fff3b0', 22, 320);
    ringWave(st.x, st.y, 'rgba(255,240,150,0.9)', 90);
    G.shake = 8;
    updateHud();
  }

  // ---------------- 一步物理 + 事件 ----------------
  function physicsStep(dt) {
    // 瞄准中：拉起的球组钉在当前角度（不受重力积分影响）
    if (G.aim.active) PHYS.pullGroup(cradle, G.aim.k, cradle.balls[G.aim.k].a);
    // 摆
    var evs = PHYS.stepCradle(cradle, dt, P);
    for (var i = 0; i < evs.length; i++) {
      var ev = evs[i];
      if (ev.type === 'clack') SFX.clack(ev.speed);
      if (ev.type === 'break') {
        SFX.snap();
        G.shake = 12;
        burst(ev.x, ev.y, G.levelTheme || '#ffcf6e', 10, 200);
        var b5 = cradle.balls[4];
        G.flying = { x: b5.fx, y: b5.fy, vx: b5.fvx, vy: b5.fvy,
                     r: P.r, m: P.massBell, spin: 0, trail: [], restTime: 0 };
        G.phase = 'fly';
        G.comboHits = 0;
      }
    }
    // 移动钟
    for (var bi = 0; bi < G.bells.length; bi++) {
      var bell = G.bells[bi];
      if (bell.move) {
        var m = bell.move, ph = G.time * PHYS.TAU / m.period + (m.phase || 0);
        if (m.axis === 'y') bell.y = bell.baseY + Math.sin(ph) * m.amp;
        else bell.x = bell.baseX + Math.sin(ph) * m.amp;
      }
      if (bell.ringT > 0) bell.ringT = Math.max(0, bell.ringT - dt * 2.2);
      if (bell.hitCd > 0) bell.hitCd -= dt;
    }
    // 弹丸
    if (G.flying && G.phase === 'fly') {
      var f = G.flying;
      var fevs = PHYS.stepProjectile(f, dt, P, G.walls);
      for (var j = 0; j < fevs.length; j++) {
        if (fevs[j].type === 'bounce') { SFX.bounce(fevs[j].speed); burst(f.x, f.y, '#8ab4ff', 5, 140); }
      }
      // 慢镜头：接近任一目标
      var near = false;
      for (var b2 = 0; b2 < G.bells.length; b2++) {
        if (Math.hypot(f.x - G.bells[b2].x, f.y - G.bells[b2].y) < 150) { near = true; break; }
      }
      G.timeScale += ((near ? 0.38 : 1) - G.timeScale) * 0.12;
      // 命中检测
      for (var b3 = 0; b3 < G.bells.length; b3++) {
        var bl = G.bells[b3];
        if (bl.hitCd > 0) continue;
        if (PHYS.circleHit(f, bl.x, bl.y, bl.r)) {
          onBellHit(bl);
          // 沿钟心法线反弹（碰撞后继续飞 → 支持连击）
          var nx = f.x - bl.x, ny = f.y - bl.y, nd = Math.hypot(nx, ny) || 1;
          nx /= nd; ny /= nd;
          var vn = f.vx * nx + f.vy * ny;
          if (vn < 0) { f.vx -= 1.5 * vn * nx; f.vy -= 1.5 * vn * ny; }
          f.x = bl.x + nx * (f.r + bl.r + 1);
          f.y = bl.y + ny * (f.r + bl.r + 1);
        }
      }
      for (var s2 = 0; s2 < G.stars.length; s2++) {
        var st = G.stars[s2];
        if (st.alive && PHYS.circleHit(f, st.x, st.y, 24)) onStarHit(st);
      }
      var ended = fevs.some(function (e2) { return e2.type === 'out' || e2.type === 'rest'; });
      if (ended) endShot();
    }
    // 摆动阶段：弦没断 → 等摆动充分展开后再判失败
    // （松手瞬间所有 ω≈0，若无宽限期会立刻被误判"静止"）
    if (G.phase === 'swing') {
      G.swingTimer += dt;
      var b5 = cradle.balls[4];
      if (!b5.broken) G.peakV5 = Math.max(G.peakV5, Math.abs(b5.w) * cradle.L);
      var calm = true;
      for (var q = 0; q < 4; q++) if (Math.abs(cradle.balls[q].w) > 0.06) calm = false;
      // 阻尼只会耗能：峰值速度对应的张力到不了阈值 → 永远不会断
      var noHope = G.peakV5 < 270;
      var done = (G.swingTimer > 2.0 && (calm || noHope)) || G.swingTimer > 7;
      if (done && !G.flying) {
        setHint('张力不足，弦没有断——拉得再高一点！');
        resetShot();
      }
    }
  }

  function endShot() {
    G.phase = 'settle';
    G.timeScale = 1;
    // 无尽模式：清空所有钟 → 下一轮
    if (G.mode === 'endless') {
      var alive = G.bells.length;
      if (alive === 0) {
        G.round++; G.shots += 2; G.score += 150;
        addPopup(W / 2, 420, '第 ' + G.round + ' 轮!  +2 弹丸 +150', '#8ef2c0', true);
        SFX.win();
        spawnEndlessRound();
      }
    }
    updateHud();
    clearTimeout(G.settleTimer); // 防同相位重复叠加
    G.settleTimer = setTimeout(function () {
      // 结算浮层已弹出（如飞行中点了「结束结算」）则跳过：避免二次结算/在浮层背后复位
      if (G.screen !== 'play' || overlayResult.classList.contains('show')) return;
      if (G.shots <= 0) showResult();
      else resetShot();
    }, 650);
  }

  // ---------------- HUD ----------------
  // 本次会话总分：各关最佳成绩之和
  function sessionTotal() {
    var s = 0;
    for (var k in G.levelBest) s += G.levelBest[k];
    return s;
  }

  function updateHud() {
    var L = G.level;
    hudLevel.textContent = G.mode === 'endless'
      ? '无尽模式 · 第 ' + G.round + ' 轮'
      : '第 ' + (G.levelIdx + 1) + ' 关 · ' + (L ? L.name : '') + ' · 第 ' +
        Math.min((G.levelTries['L' + G.levelIdx] || 0) + 1, MAX_TRIES) + '/' + MAX_TRIES + ' 次';
    // 关卡主题色同步到 HUD
    hudLevel.style.color = (G.mode === 'level' && LEVELS.META[G.levelIdx])
      ? LEVELS.META[G.levelIdx].color : '';
    hudScore.textContent = G.score;
    $('hud-target-lab').textContent = G.mode === 'endless' ? '最高' : '目标';
    hudTarget.textContent = G.mode === 'endless'
      ? Math.max(save.endless, G.score)
      : (L ? L.target : 0);
    hudShots.textContent = G.shots;
    // 弹丸告急（≤2）红色预警
    $('stat-shots').classList.toggle('low', G.shots <= 2 && G.shots >= 0);
  }

  // ---------------- 结算 ----------------
  function fmtTime(t) {
    if (t == null) return '—';
    var m = Math.floor(t / 60), s = Math.floor(t % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // 关卡明细：得分 + 耗时（未挑战显示 —），当前进行中的条目高亮
  function buildDetailHTML() {
    var rows = '';
    LEVELS.LEVELS.forEach(function (L, i) {
      var k = 'L' + i;
      var played = G.levelBest[k] !== undefined;
      var cur = G.mode === 'level' && G.levelIdx === i;
      rows += '<div class="r-row' + (cur ? ' cur' : '') + '">' +
        '<span class="c1">' + (i + 1) + ' · ' + L.name + '</span>' +
        '<span class="c2">' + (played ? G.levelBest[k] : '—') + '</span>' +
        '<span class="c3">' + (played ? fmtTime(G.levelTime[k]) : '—') + '</span></div>';
    });
    var ePlayed = G.levelBest['E'] !== undefined;
    rows += '<div class="r-row' + (G.mode === 'endless' ? ' cur' : '') + '">' +
      '<span class="c1">∞ · 无尽模式</span>' +
      '<span class="c2">' + (ePlayed ? G.levelBest['E'] : '—') + '</span>' +
      '<span class="c3">' + (ePlayed ? fmtTime(G.levelTime['E']) : '—') + '</span></div>';
    return '<div class="r-detail">' +
      '<div class="r-detail-title">关卡明细 · 本局已通关</div>' +
      '<div class="r-detail-head"><span>关卡</span><span>得分</span><span>耗时</span></div>' +
      '<div class="r-detail-list">' + rows + '</div></div>';
  }

  // 结算记录（结算弹窗与离开关卡自动结算共用）：
  // 每次结算计一次尝试（上限 MAX_TRIES=3，第 3 次为最终成绩）；
  // 达标 → 计入本局并锁定；3 次用尽未达标 → 锁定。
  // 返回 { ok, stars, tries, runOver }
  function settleLevel() {
    var key = 'L' + G.levelIdx;
    var L = G.level;
    var ok = G.score >= L.target;
    var st = ok ? (G.score >= L.s3 ? 3 : G.score >= L.s2 ? 2 : 1) : 0;
    G.levelTries[key] = (G.levelTries[key] || 0) + 1;
    if (ok) {
      G.runStars[G.levelIdx] = Math.max(G.runStars[G.levelIdx] || 0, st);
      if (G.levelBest[key] === undefined || G.score > G.levelBest[key]) G.levelTime[key] = G.elapsed;
      G.levelBest[key] = Math.max(G.levelBest[key] || 0, G.score);
    } else if (G.levelTries[key] >= MAX_TRIES) {
      G.levelExhausted[key] = true;
    }
    // 第 12 关（末关）结算 = 整局终局结算，不论其他关卡是否玩过
    var isLast = G.levelIdx === LEVELS.LEVELS.length - 1;
    return { ok: ok, stars: st, tries: G.levelTries[key],
             runOver: isLast && (ok || G.levelTries[key] >= MAX_TRIES) };
  }

  // pre：调用方（retry/leaveToSelect）已结算过的结果——直接复用，防止第 12 关 runOver
  // 路径「先 settleLevel 判 runOver、showResult 内部再结算一次」的双重计次
  function showResult(pre) {
    var ov = $('overlay-result'), box = $('result-box');
    var html = '';
    if (G.mode === 'level') {
      var L = G.level;
      var r = pre || settleLevel();
      var ok = r.ok, st = r.stars, tries = r.tries;
      if (r.runOver) {
        // —— 整局终局结算（第 12 关）——
        var clearedN = Object.keys(G.levelBest).filter(function (k) { return k.charAt(0) === 'L'; }).length;
        html = '<div class="r-title ' + (ok ? 'win' : 'fail') + '">' +
          (ok ? '挑战结束!' : '挑战结束 · 末关未达标') + '</div>';
        if (ok) html += '<div class="r-stars"><span class="lit">' + '★'.repeat(st) +
          '</span><span class="dim">' + '★'.repeat(3 - st) + '</span></div>';
        html += '<div class="r-score">末关得分 <b>' + G.score + '</b> / 目标 ' + L.target +
          ' · 第 ' + tries + '/' + MAX_TRIES + ' 次</div>';
        html += '<div class="r-score r-total">本局总分 <b>' + sessionTotal() + '</b>' +
          ' <small>已通关 ' + clearedN + ' / ' + LEVELS.LEVELS.length + ' 关</small></div>';
        html += buildDetailHTML();
        html += '<div class="r-btns"><button id="r-newrun" class="primary">开新挑战</button>' +
          '<button id="r-endless">去无尽模式</button><button id="r-back">选关</button>' +
          '<button id="r-home">🏠 主页</button></div>';
      } else {
        // —— 普通关卡结算 ——
        html = '<div class="r-title ' + (ok ? 'win' : 'fail') + '">' +
          (ok ? '实验成功!' : (tries >= MAX_TRIES ? '未达目标 · 机会已用尽' : '未达目标')) + '</div>';
        if (ok) html += '<div class="r-stars"><span class="lit">' + '★'.repeat(st) +
          '</span><span class="dim">' + '★'.repeat(3 - st) + '</span></div>';
        html += '<div class="r-score">本关得分 <b>' + G.score + '</b> / 目标 ' + L.target +
          ' <small>(' + L.s2 + '☆ / ' + L.s3 + '★)</small> · 第 ' + tries + '/' + MAX_TRIES + ' 次</div>';
        html += '<div class="r-score r-total">本局总分 <b>' + sessionTotal() + '</b>' +
          (ok ? '' : ' <small>（未达标不计入总分，' +
            (tries >= MAX_TRIES ? '本关 3 次机会已用尽' : '还剩 ' + (MAX_TRIES - tries) + ' 次机会') + '）</small>') + '</div>';
        html += buildDetailHTML();
        html += '<div class="r-btns">';
        if (!ok && tries < MAX_TRIES) {
          html += '<button id="r-retry" class="primary">重玩 (R) · 剩 ' + (MAX_TRIES - tries) + ' 次</button>';
        }
        if (ok) {
          // 「下一关」自动跳过本局已锁定的关卡
          var n = G.levelIdx + 1;
          while (n < LEVELS.LEVELS.length && levelLocked(n)) n++;
          G.nextIdx = n;
          html += '<button id="r-next" class="primary">' +
            (n < LEVELS.LEVELS.length ? '下一关' : '全部通关! 去无尽模式') + '</button>';
        }
        html += '<button id="r-back">选关</button><button id="r-home">🏠 主页</button></div>';
      }
    } else {
      var best = Math.max(save.endless, G.score);
      var isNew = G.score > (save.endless || 0);
      if (isNew) { save.endless = G.score; persist(); }
      // 无尽模式：本次会话只计最高一轮（耗时随最佳轮记录）
      var eImproved = G.levelBest['E'] === undefined || G.score > G.levelBest['E'];
      G.levelBest['E'] = Math.max(G.levelBest['E'] || 0, G.score);
      if (eImproved) G.levelTime['E'] = G.elapsed;
      html = '<div class="r-title">弹丸耗尽</div>' +
        '<div class="r-score">本轮得分 <b>' + G.score + '</b> · 抵达第 ' + G.round + ' 轮</div>' +
        (isNew ? '<div class="r-new">新纪录!</div>' : '<div class="r-score">最高纪录 ' + best + '</div>') +
        '<div class="r-score r-total">本局总分 <b>' + sessionTotal() + '</b></div>' +
        buildDetailHTML() +
        '<div class="r-btns"><button id="r-retry" class="primary">再来一次 (R)</button><button id="r-back">返回</button><button id="r-home">🏠 主页</button></div>';
    }
    // 品牌名贯穿所有结算弹窗
    box.innerHTML = '<div class="r-brand">动量五重奏 · MOMENTUM QUINTET</div>' + html;
    ov.classList.add('show');
    if (G.mode === 'level' ? G.score >= G.level.target : false) SFX.win(); else SFX.fail();
    var r1 = $('r-retry'); if (r1) r1.onclick = function () { SFX.click(); retry(); };
    var r2 = $('r-next'); if (r2) r2.onclick = function () {
      SFX.click();
      if (G.nextIdx >= LEVELS.LEVELS.length) loadEndless();
      else loadLevel(G.nextIdx);
    };
    var r3 = $('r-back'); if (r3) r3.onclick = function () { SFX.click(); showScreen('select'); };
    // 结算弹窗「主页」= 结束本局，自动初始化全部本局数据
    var r4 = $('r-home'); if (r4) r4.onclick = function () { SFX.click(); resetSession(); showScreen('title'); };
    var r5 = $('r-newrun'); if (r5) r5.onclick = function () { SFX.click(); resetSession(); showScreen('select'); };
    var r6 = $('r-endless'); if (r6) r6.onclick = function () { SFX.click(); loadEndless(); };
  }

  function retry() {
    if (G.mode === 'level') {
      // R 重玩与 Esc 同规：已出手/有得分的尝试按自动结算计一次，
      // 否则「3 次结算机会」可被无限免费重打绕过
      if (G.screen === 'play' && !overlayResult.classList.contains('show') &&
          (G.usedShot || G.score > 0)) {
        var sr = settleLevel();
        if (sr.runOver) { showResult(sr); return; } // 第 12 关：任何结算都触发整局终局（复用已结算结果，防双重计次）
      }
      if (levelLocked()) {
        // 回选关屏提示（结算浮层下 setHint 会被 z-30 遮挡，此处必须离开浮层才可见）
        showScreen('select');
        setHint('本局该关已锁定——返回主页「开新挑战」即可重玩');
        return;
      }
      loadLevel(G.levelIdx);
    }
    else loadEndless();
  }

  // 清空本局全部数据（得分/耗时/次数/锁定/星级），仅无尽最高分持久保留
  function resetSession() {
    G.levelBest = {};
    G.levelTime = {};
    G.levelTries = {};
    G.levelExhausted = {};
    G.runStars = [];
    G.score = 0;
  }

  // 从当前关卡返回选关：已出手的关卡自动结算（计一次尝试）
  function leaveToSelect() {
    settleEndless(); // 无尽模式中途离开也要保存最高分（否则丢分）
    var settleMsg = null;
    if (G.mode === 'level' && G.screen === 'play' &&
        !overlayResult.classList.contains('show') && (G.usedShot || G.score > 0)) {
      var key = 'L' + G.levelIdx;
      var before = G.levelTries[key] || 0;
      var lr = settleLevel();
      if (lr.runOver) { showResult(lr); return; } // 第 12 关：自动结算同样触发整局终局浮层（复用已结算结果）
      settleMsg = '已自动结算「' + G.level.name + '」：第 ' + (before + 1) + '/' + MAX_TRIES + ' 次';
    }
    showScreen('select');
    // 提示须在 showScreen 之后设置（showScreen 会收起提示条）
    if (settleMsg) setHint(settleMsg);
  }

  // ---------------- 按钮与快捷键 ----------------
  $('btn-start').onclick = function () {
    SFX.click();
    // 本局尚无成绩 → 直接进入选关；已有成绩 → 询问「继续上局 / 开新挑战」
    var played = Object.keys(G.levelBest).length;
    if (played === 0) { showScreen('select'); return; }
    $('confirm-info').innerHTML = '当前本局已有成绩：总分 <b>' + sessionTotal() +
      '</b> 分 · 已挑战 ' + played + ' 项';
    $('overlay-confirm').classList.add('show');
  };
  $('c-continue').onclick = function () {
    SFX.click();
    $('overlay-confirm').classList.remove('show');
    showScreen('select'); // 保留本局全部数据，继续挑战
  };
  $('c-new').onclick = function () {
    SFX.click();
    resetSession();
    $('overlay-confirm').classList.remove('show');
    showScreen('select');
  };
  $('c-cancel').onclick = function () { SFX.click(); $('overlay-confirm').classList.remove('show'); };
  $('overlay-confirm').addEventListener('click', function (e) {
    if (e.target === this) $('c-cancel').onclick(); // 点背景取消
  });
  $('btn-help').onclick = function () { SFX.click(); $('overlay-help').classList.add('show'); };
  $('help-close').onclick = function () { SFX.click(); $('overlay-help').classList.remove('show'); };
  document.querySelector('.back-title').onclick = function () { SFX.click(); showScreen('title'); };
  btnBack.onclick = function () { SFX.click(); leaveToSelect(); };
  btnRestart.onclick = function () { SFX.click(); retry(); };
  btnFinish.onclick = function () { SFX.click(); showResult(); };
  btnRules.onclick = function () {
    SFX.click();
    panelPlay.classList.toggle('show');
  };
  btnMute.onclick = function () {
    var m = SFX.toggleMute();
    btnMute.textContent = m ? '🔇' : '🔊';
  };

  window.addEventListener('keydown', function (e) {
    if (e.key === 'r' || e.key === 'R') { if (G.screen === 'play') retry(); }
    if (e.key === 'm' || e.key === 'M') btnMute.onclick();
    if (e.key === 'Escape') {
      if ($('overlay-confirm').classList.contains('show')) $('overlay-confirm').classList.remove('show');
      else if ($('overlay-help').classList.contains('show')) $('overlay-help').classList.remove('show');
      else if (G.screen === 'play') leaveToSelect();
    }
  });

  // ---------------- 主循环 ----------------
  var lastT = 0, acc = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    var real = Math.min(0.05, (t - lastT) / 1000 || 0);
    lastT = t;
    G.time += real;
    if (G.screen === 'play') {
      // 结算浮层弹出时暂停计时与物理：结算快照不被浮层背后的命中/摆动继续改写
      if (!overlayResult.classList.contains('show')) {
        G.elapsed += real;
        acc += real * G.timeScale;
      }
      var guard = 0;
      while (acc >= DT && guard++ < 24) {
        physicsStep(DT);
        acc -= DT;
      }
      if (G.shake > 0) G.shake = Math.max(0, G.shake - real * 30);
    }
    draw(real);
  }

  function draw(dt) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    var sx = 0, sy = 0;
    if (G.shake > 0.3) { sx = (Math.random() - 0.5) * G.shake; sy = (Math.random() - 0.5) * G.shake; }
    ctx.translate(offX + sx * scale, offY + sy * scale);
    ctx.scale(scale, scale);

    if (G.screen === 'play' || G.screen === 'select') {
      RENDER.drawBackground(ctx, G.levelTheme);
      G.walls.forEach(function (w) { RENDER.drawWall(ctx, w); });
      G.stars.forEach(function (s) { if (s.alive) RENDER.drawStar(ctx, s, G.time); });
      G.bells.forEach(function (b) { RENDER.drawBell(ctx, b, G.time); });
      RENDER.drawFrame(ctx, P);
      if (G.screen === 'play') RENDER.drawCradle(ctx, cradle, G.aim.active ? G.aim : null, G.time, G.levelTheme);
      // settle 期间继续绘制弹丸（静置/出界停留），避免「左下角瞬间消失」的突兀感；
      // 仅游戏内绘制——settle 中途回选关时不把残弹画到选关屏上
      if (G.screen === 'play' && G.flying && (G.phase === 'fly' || G.phase === 'settle'))
        RENDER.drawProjectile(ctx, G.flying, G.levelTheme);
      RENDER.drawParticles(ctx, G.particles, dt);
      RENDER.drawPopups(ctx, G.popups, dt);
    }
  }

  // ---------------- 启动 ----------------
  // 「玩法/计分」面板贯穿所有页面：克隆主页面板到选关屏与游戏内
  // （注意显式选中主页面板，避免命中 DOM 中更靠前的空面板 #panel-play）
  var panelHTML = document.querySelector('#screen-title .title-panel').innerHTML;
  $('panel-select').innerHTML = panelHTML;
  panelPlay.innerHTML = panelHTML;
  resize();
  requestAnimationFrame(frame);
})();
