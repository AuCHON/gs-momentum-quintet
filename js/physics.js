/* =========================================================================
 * 动量五重奏 —— 物理内核（纯逻辑，无 DOM，可在 Node 中单元测试）
 *
 * 涉及的物理规律：
 *   重力   单摆：ω' = -(g/L)·sinθ - c·ω ；抛体：a = g - k·v·|v|
 *   碰撞   相邻球沿连心线的弹性碰撞（动量守恒 + 恢复系数 e），
 *           碰后把速度重新投影回各自摆弧切向（摆线约束）
 *   速度   高度→速度：v = √(2gL(1-cosα))（能量守恒）
 *   惯性   5 球链式动量传递（牛顿摆）。质量从左到右递减
 *           [2.4, 1.8, 1.35, 1.0, 0.55]——重球撞轻球保留更多速度，
 *           链越长速度放大越多（抓越靠左的球，末球弹得越快）
 *   断线   张力 T = m·(g·cosθ + L·ω²)，超过阈值即断（5号球专用弦）
 * ========================================================================= */
(function (root) {
  'use strict';

  // ---------------- 默认物理参数（逻辑坐标 1600×900，px/s 制） ----------------
  var DEFAULTS = {
    g: 1500,            // 重力加速度 px/s²
    L: 300,             // 摆线长度
    r: 26,              // 球半径（摆心间距 = 2r）
    massChain: [2.4, 1.8, 1.35, 1.0],  // 1~4号球质量（递减 → 速度逐级放大）
    massBell: 0.55,     // 5号球（铃球，最轻 → 弹射最快）
    eBall: 0.985,       // 球-球恢复系数
    damp: 0.055,        // 摆角阻尼
    airK: 0.00022,      // 抛体空气阻力系数（v² 阻力）
    eWall: 0.55,        // 弹丸-墙恢复系数
    eFloor: 0.42,       // 弹丸-地面恢复系数
    fricFloor: 0.75,    // 地面切向摩擦保留系数
    // 5号球断线张力阈值：T = m₅(g + v₅²/L) > breakT
    // 实测：抓1号球需 α>19°、抓4球需 α>27° 才会断弦（轻拉不断，教学点）
    breakT: 1100,
    stageW: 1600,
    stageH: 900,
    floorY: 872,
    dir: 1               // 摆动方向：1=摆台在左向右发射；-1=摆台在右向左发射（镜像布局）
  };

  var TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // ============================ 单摆系统 ============================
  // 每颗球一根摆线，pivot 等距排布；angle=0 竖直向下，向右为正。
  // state[i] = { a: 角度, w: 角速度, m: 质量, broken: 是否已断线 }
  function makeCradle(opts, frameX, frameY) {
    var P = opts;
    var dir = P.dir || 1; // dir=-1 时 0 号球（最重）在 frameX，4 号铃球在其左侧
    var balls = [];
    for (var i = 0; i < 5; i++) {
      balls.push({
        i: i,
        a: 0, w: 0,
        m: i === 4 ? P.massBell : P.massChain[i],
        broken: false,
        pivotX: frameX + dir * i * 2 * P.r,
        pivotY: frameY
      });
    }
    return { balls: balls, L: P.L, P: P };
  }

  function ballPos(b, P) {
    return {
      x: b.pivotX + P.L * Math.sin(b.a),
      y: b.pivotY + P.L * Math.cos(b.a)
    };
  }

  // 球心速度（切向）：v = L·ω，方向 (cosθ, -sinθ)
  function ballVel(b, P) {
    return { x: P.L * b.w * Math.cos(b.a), y: -P.L * b.w * Math.sin(b.a) };
  }

  // 摆线张力（仅用径向分量，θ=0 时 T = m(g + Lω²)）
  function tension(b, P) {
    return b.m * (P.g * Math.cos(b.a) + P.L * b.w * b.w);
  }

  // 把速度向量投影回摆弧 → 新角速度（摆线约束）
  function projectToArc(b, vx, vy, P) {
    var tx = Math.cos(b.a), ty = -Math.sin(b.a); // 切向单位向量
    b.w = (vx * tx + vy * ty) / P.L;
  }

  // 拖拽整组：抓第 k 颗(0基)则 0..k 一起抬到 angle（刚性组，同步静止）
  function pullGroup(cradle, k, angle) {
    for (var i = 0; i <= k; i++) {
      cradle.balls[i].a = angle;
      cradle.balls[i].w = 0;
    }
  }

  // 单步积分（建议 dt ≤ 1/240 s，配合多次碰撞迭代）
  // 返回事件数组：[{type:'clack', i, j, speed}, {type:'break', i, speed}]
  function stepCradle(cradle, dt, opts) {
    var P = cradle.P;
    var ev = [];
    var balls = cradle.balls;
    var i, b, p, v;

    // --- 1. 摆动力学（未断线的球） ---
    for (i = 0; i < 5; i++) {
      b = balls[i];
      if (b.broken) continue;
      var w0 = b.w;
      b.w += (-(P.g / cradle.L) * Math.sin(b.a) - P.damp * b.w) * dt;
      b.a += b.w * dt;
      // 断线检测（仅 5 号球）
      if (i === 4 && tension(b, P) > P.breakT) {
        p = ballPos(b, P); v = ballVel(b, P);
        b.broken = true;
        b.fx = p.x; b.fy = p.y; b.fvx = v.x; b.fvy = v.y; // 转为自由抛体
        b.a = 0; b.w = 0;
        ev.push({ type: 'break', i: 4, speed: Math.hypot(v.x, v.y), x: p.x, y: p.y });
      }
    }

    // --- 2. 相邻球碰撞（多次迭代求穿透解） ---
    var minSep = 2 * P.r * 0.998;
    for (var iter = 0; iter < 4; iter++) {
      for (i = 0; i < 4; i++) {
        var A = balls[i], B = balls[i + 1];
        if (A.broken || B.broken) continue;
        var pa = ballPos(A, P), pb = ballPos(B, P);
        var dx = pb.x - pa.x, dy = pb.y - pa.y;
        var d = Math.hypot(dx, dy);
        if (d >= minSep || d === 0) continue;
        var nx = dx / d, ny = dy / d;
        // 位置修正（沿法线各退一半穿透）
        var push = (minSep - d) / 2;
        var da = (push / P.L); // 弧长近似转角度
        // A 沿 -n 退、B 沿 +n 退（投影到各自切向）
        A.a -= da * (nx * Math.cos(A.a) - ny * Math.sin(A.a));
        B.a += da * (nx * Math.cos(B.a) - ny * Math.sin(B.a));
        // 速度：沿连心线的弹性碰撞
        var va = ballVel(A, P), vb = ballVel(B, P);
        var rel = (va.x - vb.x) * nx + (va.y - vb.y) * ny; // 接近速度
        if (rel <= 0) continue;
        var e = P.eBall;
        var jImp = (1 + e) * rel / (1 / A.m + 1 / B.m); // 冲量大小
        var vax = va.x - jImp * nx / A.m, vay = va.y - jImp * ny / A.m;
        var vbx = vb.x + jImp * nx / B.m, vby = vb.y + jImp * ny / B.m;
        projectToArc(A, vax, vay, P);
        projectToArc(B, vbx, vby, P);
        if (iter === 0) ev.push({ type: 'clack', i: i, j: i + 1, speed: rel });
      }
    }
    return ev;
  }

  // ============================ 抛体（5号球飞行） ============================
  // f: {x,y,vx,vy, r, m, spin, trail:[]}
  function stepProjectile(f, dt, P, walls) {
    var ev = [];
    var sp = Math.hypot(f.vx, f.vy);
    // 重力 + v² 空气阻力
    var k = P.airK * sp;
    f.vx += (-k * f.vx) * dt;
    f.vy += (P.g - k * f.vy) * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.spin += f.vx * dt * 0.02;
    f.trail.push(f.x, f.y);
    if (f.trail.length > 44) f.trail.splice(0, 2);

    // 墙（竖直矩形）反弹
    if (walls) {
      for (var i = 0; i < walls.length; i++) {
        var w = walls[i];
        var hit = f.x + f.r > w.x && f.x - f.r < w.x + w.w &&
                  f.y + f.r > w.y && f.y - f.r < w.y + w.h;
        if (!hit) continue;
        // 取最小穿透方向反弹
        var penL = f.x + f.r - w.x, penR = w.x + w.w - (f.x - f.r);
        var penT = f.y + f.r - w.y, penB = w.y + w.h - (f.y - f.r);
        var minPen = Math.min(penL, penR, penT, penB);
        if (minPen === penL) { f.x = w.x - f.r; f.vx = -Math.abs(f.vx) * P.eWall; ev.push({ type: 'bounce', side: 'l', speed: Math.abs(f.vx) }); }
        else if (minPen === penR) { f.x = w.x + w.w + f.r; f.vx = Math.abs(f.vx) * P.eWall; ev.push({ type: 'bounce', side: 'r', speed: Math.abs(f.vx) }); }
        else if (minPen === penT) { f.y = w.y - f.r; f.vy = -Math.abs(f.vy) * P.eWall; ev.push({ type: 'bounce', side: 't', speed: Math.abs(f.vy) }); }
        else { f.y = w.y + w.h + f.r; f.vy = Math.abs(f.vy) * P.eWall; ev.push({ type: 'bounce', side: 'b', speed: Math.abs(f.vy) }); }
      }
    }
    // 地面
    if (f.y + f.r > P.floorY) {
      f.y = P.floorY - f.r;
      if (Math.abs(f.vy) > 40) ev.push({ type: 'bounce', side: 'floor', speed: Math.abs(f.vy) });
      f.vy = -Math.abs(f.vy) * P.eFloor;
      f.vx *= P.fricFloor;
      f.spin = f.vx * 0.04;
    }
    // 出界
    if (f.x > P.stageW + 80 || f.x < -80) ev.push({ type: 'out' });
    // 静止判定
    if (f.y + f.r >= P.floorY - 1 && Math.hypot(f.vx, f.vy) < 50) {
      f.restTime = (f.restTime || 0) + dt;
      if (f.restTime > 0.45) ev.push({ type: 'rest' });
    } else f.restTime = 0;
    return ev;
  }

  // 圆 vs 圆（弹丸 vs 钟心）碰撞检测
  function circleHit(f, cx, cy, cr) {
    var dx = f.x - cx, dy = f.y - cy;
    return dx * dx + dy * dy < (f.r + cr) * (f.r + cr);
  }

  // 圆 vs 矩形（弹丸 vs 墙，供渲染高亮）
  function pointInRect(x, y, w0) {
    return x >= w0.x && x <= w0.x + w0.w && y >= w0.y && y <= w0.y + w0.h;
  }

  // 释放瞬间的理论弹速提示（用于 HUD 预估条，非作弊精确值）
  // k=拉起球数(1基), angle=|拉角|。系数由 node test 实测校准：
  //   抓1球(长链) ×1.84 / 抓2球 ×1.62 / 抓3球 ×1.43 / 抓4球 ×1.26
  var TRANSFER = [0, 1.84, 1.62, 1.43, 1.26];
  function predictSpeed(P, k, angleRad) {
    var v = Math.sqrt(2 * P.g * P.L * (1 - Math.cos(angleRad)));
    return v * (TRANSFER[k] || 1.3);
  }

  // ---------------- 导出（浏览器全局 / Node module） ----------------
  var API = {
    DEFAULTS: DEFAULTS,
    TAU: TAU,
    clamp: clamp,
    makeCradle: makeCradle,
    ballPos: ballPos,
    ballVel: ballVel,
    tension: tension,
    pullGroup: pullGroup,
    stepCradle: stepCradle,
    stepProjectile: stepProjectile,
    circleHit: circleHit,
    pointInRect: pointInRect,
    predictSpeed: predictSpeed,
    TRANSFER: TRANSFER
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.PHYS = API;
})(typeof window !== 'undefined' ? window : globalThis);
