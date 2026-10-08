/* =========================================================================
 * 动量五重奏 —— 物理内核单元测试（Node 运行：node test/physics.test.js）
 * 1) 拉起 k 球 → 5 号球断弦弹速表（校准 TRANSFER 与关卡可达性）
 * 2) 惯性/动量守恒：轻质末球获得更高速度
 * 3) 轻拉不断弦、重拉必断弦
 * 4) 抛体弹道：理论射程 vs 仿真射程（含空气阻力）
 * 5) 稳定性：长时间仿真无 NaN、无穿透
 * ========================================================================= */
'use strict';

var PHYS = require('../js/physics.js');

var P = Object.assign({}, PHYS.DEFAULTS, { frameX: 210, frameY: 130 });
var DT = 1 / 240;

function simulatePull(k, angleDeg) {
  // k: 拉起球数（1..4，抓第 k 颗）
  var cradle = PHYS.makeCradle(P, P.frameX, P.frameY);
  PHYS.pullGroup(cradle, k - 1, -angleDeg * Math.PI / 180);
  var breakInfo = null, t = 0;
  while (t < 8) {
    var evs = PHYS.stepCradle(cradle, DT, P);
    t += DT;
    for (var i = 0; i < evs.length; i++) {
      if (evs[i].type === 'break') { breakInfo = evs[i]; break; }
    }
    if (breakInfo) break;
  }
  return breakInfo;
}

var failures = 0;
function check(name, cond, detail) {
  var ok = !!cond;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  [' + detail + ']' : ''));
  if (!ok) failures++;
}

console.log('== 1) 弹速校准表（拉角 × 拉球数 → 5号球断弦弹速） ==');
var table = {};
[1, 2, 3, 4].forEach(function (k) {
  table[k] = {};
  [25, 40, 60, 80].forEach(function (a) {
    var br = simulatePull(k, a);
    var v = br ? Math.round(br.speed) : 0;
    table[k][a] = v;
    console.log('  拉 ' + k + ' 球 @ ' + String(a).padStart(2) + '°  →  ' +
      (br ? v + ' px/s   断于 y=' + Math.round(br.y) : '未断弦'));
  });
});

console.log('\n== 2) 质量阶梯：只抓1号重球（长链放大）应明显快于抓4球 ==');
var v1 = table[1][80], v4 = table[4][80];
check('抓1球 > 抓4球×1.15 (' + v1 + ' vs ' + v4 + ')', v1 > v4 * 1.15);
check('抓球数越少弹速越高（阶梯单调）',
  table[1][60] > table[2][60] && table[2][60] > table[3][60] && table[3][60] > table[4][60]);
check('最大弹速在 1200~2000 区间 (' + v1 + ')', v1 > 1200 && v1 < 2000);

console.log('\n== 2b) 镜像布局（摆台在右 dir=-1）弹速应与原布局一致 ==');
var PM = Object.assign({}, P, { frameX: 1270, dir: -1 });
(function () {
  var cradle = PHYS.makeCradle(PM, PM.frameX, PM.frameY);
  PHYS.pullGroup(cradle, 0, 80 * Math.PI / 180); // 正角度 = 向右上拉
  var info = null, t = 0;
  while (t < 8) {
    var evs = PHYS.stepCradle(cradle, DT, PM);
    t += DT;
    for (var i = 0; i < evs.length; i++) if (evs[i].type === 'break') { info = evs[i]; break; }
    if (info) break;
  }
  check('镜像断弦 (v=' + (info ? Math.round(info.speed) : 0) + ')', !!info);
  var fvx = cradle.balls[4].fvx; // 断弦瞬间 5 号球水平速度（镜像布局应为负 = 向左飞）
  check('镜像向左飞 (vx=' + Math.round(fvx || 0) + ')', !!info && fvx < -100);
  check('镜像弹速 ≈ 原布局 (' + (info ? Math.round(info.speed) : 0) + ' vs ' + v1 + ')',
    !!info && Math.abs(info.speed - v1) < 8);
  // 满拉角(1.92 rad ≈ 110°)时整球必须在画面内
  var cradle2 = PHYS.makeCradle(PM, PM.frameX, PM.frameY);
  PHYS.pullGroup(cradle2, 0, 1.92);
  var p = PHYS.ballPos(cradle2.balls[0], PM);
  check('满拉角整球可见 (球心 x=' + Math.round(p.x) + ', y=' + Math.round(p.y) + ')',
    p.x + PM.r <= 1600 && p.x - PM.r >= 0 && p.y + PM.r <= 900 && p.y - PM.r >= 0);
})();

console.log('\n== 3) 断弦阈值 ==');
check('10° 轻拉不断弦', !simulatePull(1, 10));
check('30° 必断弦', !!simulatePull(1, 30));

console.log('\n== 4) 抛体射程（含空气阻力/落地弹跳前的首次落点） ==');
[600, 900, 1200].forEach(function (v) {
  // 理论：首次触地 x = 418 + v·√(2·(872−26−430)/g)
  var tFly = Math.sqrt(2 * (872 - 26 - 430) / P.g);
  var theory = 418 + v * tFly;
  var f = { x: 418, y: 430, vx: v, vy: 0, r: P.r, trail: [], restTime: 0 };
  var firstTouch = null, tt = 0;
  while (tt < 4) {
    var evs = PHYS.stepProjectile(f, DT, P, []);
    tt += DT;
    var evFloor = evs.some(function (e) { return e.side === 'floor'; });
    if (evFloor && firstTouch === null) firstTouch = f.x;
    if (f.restTime > 0.4) break;
  }
  var drift = Math.abs(firstTouch - theory) / theory;
  check('v=' + v + ' 首落点 ' + Math.round(firstTouch) + ' ≈ 理论 ' + Math.round(theory) + ' (偏差 ' + (drift * 100).toFixed(1) + '%)',
    drift < 0.09);
});

console.log('\n== 5) 稳定性：拉4球@155° 疯狂摆动 30 秒 ==');
var cradle = PHYS.makeCradle(P, P.frameX, P.frameY);
PHYS.pullGroup(cradle, 3, -2.7);
var bad = false, maxOverlap = 0;
for (var s = 0, T = 30; s < T / DT; s++) {
  PHYS.stepCradle(cradle, DT, P);
  for (var i = 0; i < 4; i++) {
    var A = PHYS.ballPos(cradle.balls[i], P), B = PHYS.ballPos(cradle.balls[i + 1], P);
    if (!cradle.balls[i].broken && !cradle.balls[i + 1].broken) {
      var d = Math.hypot(B.x - A.x, B.y - A.y);
      if (!isFinite(d) || d < 2 * P.r * 0.9) { bad = true; maxOverlap = Math.max(maxOverlap, 2 * P.r - d); }
    }
  }
  cradle.balls.forEach(function (b) {
    if (!isFinite(b.a) || !isFinite(b.w)) bad = true;
  });
  if (bad) break;
}
check('无 NaN / 无明显穿透 (最大穿透 ' + maxOverlap.toFixed(2) + 'px)', !bad);

console.log('\n== 6) 关卡可达性抽查（用实测最大弹速） ==');
var maxV = Math.max(table[1][80], table[2][80], table[3][80], table[4][80]);
console.log('  实测最大弹速 = ' + maxV + ' px/s');
var LV = require('../js/levels.js').LEVELS;
var reachOK = true;
function needV(x, y) { return (x - 418) / Math.sqrt(Math.max(0.01, y - 430) / 750); }
LV.forEach(function (L, li) {
  L.bells.forEach(function (b) {
    var need = needV(b.x, b.y);
    // 贴地目标（y≥800）可靠落地弹跳/滚动命中，只需中速可达其下方地面
    if (need > maxV * 0.98 && b.y < 800) {
      console.log('  ✗ 第' + (li + 1) + '关 钟(' + b.x + ',' + b.y + ') 需 ' + Math.round(need) + ' > 最大 ' + maxV);
      reachOK = false;
    }
  });
  (L.stars || []).forEach(function (s) {
    var need = needV(s.x, s.y);
    if (need > maxV * 0.98 && s.y < 800) {
      console.log('  ✗ 第' + (li + 1) + '关 星(' + s.x + ',' + s.y + ') 需 ' + Math.round(need) + ' > 最大 ' + maxV);
      reachOK = false;
    }
  });
});
check('全部静态目标在最大弹速内可达', reachOK);

console.log('\n== 6b) 关卡目标镜像后完整在画布内（game.js 布局 mirrorX(x)=1480−x） ==');
(function () {
  var visOK = true;
  function fail(msg) { console.log('  ✗ ' + msg); visOK = false; }
  LV.forEach(function (L, li) {
    (L.bells || []).forEach(function (b) {
      var ext = b.move ? b.move.amp : 0;
      if (!b.move || b.move.axis === 'x') {
        var mx = 1480 - b.x;
        if (mx - ext - b.r < 0 || mx + ext + b.r > 1600)
          fail('第' + (li + 1) + '关 钟(' + b.x + ',r=' + b.r + (ext ? ',amp=' + ext : '') + ') 镜像横向越界');
      } else {
        if (b.y - ext - b.r < 0 || b.y + ext + b.r > 900)
          fail('第' + (li + 1) + '关 钟(' + b.x + ',' + b.y + ',r=' + b.r + ',amp=' + ext + ') 纵向越界');
      }
    });
    (L.stars || []).forEach(function (s) {
      var mx = 1480 - s.x;
      if (mx - 26 < 0 || mx + 26 > 1600) fail('第' + (li + 1) + '关 星(' + s.x + ') 镜像越界');
    });
    (L.walls || []).forEach(function (w) {
      var mx = 1480 - (w.x + w.w);
      if (mx < 0 || mx + w.w > 1600) fail('第' + (li + 1) + '关 墙(' + w.x + ',w=' + w.w + ') 镜像越界');
    });
  });
  check('镜像后钟(含移动幅度)/星/墙完整在 1600×900 画布内', visOK);
})();

console.log('\n== 7) 无尽模式生成器：300 轮随机抽查 ==');
var GEN = require('../js/levels.js').makeEndlessRound;
var genOK = true;
for (var rd = 1; rd <= 300; rd++) {
  // 固定种子的简易 LCG，保证可复现
  var seed = rd * 2654435761 % 4294967296;
  var rngG = function () { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  var r = GEN(rd, rngG);
  r.bells.forEach(function (b) {
    var inStage = b.x > 500 && b.x < 1560 && b.y >= 470 && b.y <= 846;
    var reach = b.y < 800 ? needV(b.x, b.y) <= maxV * 0.98 : true;
    if (!inStage || !reach || !isFinite(b.x) || !isFinite(b.y)) {
      console.log('  ✗ 第' + rd + '轮 钟(' + b.x + ',' + b.y + ') inStage=' + inStage + ' reach=' + reach);
      genOK = false;
    }
  });
  r.stars.forEach(function (s) {
    if (s.y > 846 || s.x > 1200 || needV(s.x, s.y) > maxV * 0.98) {
      console.log('  ✗ 第' + rd + '轮 星(' + s.x + ',' + s.y + ')');
      genOK = false;
    }
  });
  r.walls.forEach(function (w) {
    if (w.y < 560 || w.x > 1000 || w.h < 0) {
      console.log('  ✗ 第' + rd + '轮 墙(' + w.x + ',' + w.y + ',' + w.h + ')');
      genOK = false;
    }
  });
}
check('无尽生成器全部在界内且可达', genOK);

console.log('\n' + (failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌'));
process.exit(failures === 0 ? 0 : 1);
