/* =========================================================================
 * 动量五重奏 —— 渲染层（Canvas 2D，逻辑坐标 1600×900）
 * 负责绘制世界：实验室背景、牛顿摆、琴弦、钟、星、墙、弹丸、粒子、飘字
 * ========================================================================= */
(function (root) {
  'use strict';

  var W = 1600, H = 900, FLOOR = 872;

  // ---------- 小工具 ----------
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function starPath(ctx, x, y, R, rot) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var rad = i % 2 === 0 ? R : R * 0.45;
      var a = rot + i * Math.PI / 5 - Math.PI / 2;
      var px = x + rad * Math.cos(a), py = y + rad * Math.sin(a);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  // ---------- 背景 ----------
  var bgCache = null;
  // #rrggbb → rgba 字符串
  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  // 主题色衍生明暗：t>0 向白插值，t<0 等比变暗
  function shade(hex, t) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (t >= 0) {
      r = Math.round(r + (255 - r) * t); g = Math.round(g + (255 - g) * t); b = Math.round(b + (255 - b) * t);
    } else {
      var k = 1 + t;
      r = Math.round(r * k); g = Math.round(g * k); b = Math.round(b * k);
    }
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function drawBackground(ctx, theme) {
    if (!bgCache) {
      var c = document.createElement('canvas');
      c.width = W; c.height = H;
      var b = c.getContext('2d');
      var grad = b.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '#0b1020');
      grad.addColorStop(0.65, '#0e1530');
      grad.addColorStop(1, '#131a36');
      b.fillStyle = grad;
      b.fillRect(0, 0, W, H);
      // 网格纸
      b.strokeStyle = 'rgba(90,120,200,0.07)';
      b.lineWidth = 1;
      for (var gx = 0; gx <= W; gx += 40) { b.beginPath(); b.moveTo(gx + 0.5, 0); b.lineTo(gx + 0.5, H); b.stroke(); }
      for (var gy = 0; gy <= H; gy += 40) { b.beginPath(); b.moveTo(0, gy + 0.5); b.lineTo(W, gy + 0.5); b.stroke(); }
      // 远景装饰：公式
      b.fillStyle = 'rgba(120,150,230,0.06)';
      b.font = 'italic 26px Georgia, serif';
      b.fillText('T = m(g·cosθ + Lω²)', 1020, 220);
      b.fillText('v = √(2gL(1−cosα))', 1060, 268);
      b.fillText('Σmv = const', 560, 180);
      bgCache = c;
    }
    ctx.drawImage(bgCache, 0, 0);
    // 关卡主题色氛围：顶部光带 + 中央环境光 + 地面亮线 + 边缘晕圈
    if (theme) {
      var tg = ctx.createLinearGradient(0, 0, W, 0);
      tg.addColorStop(0, hexA(theme, 0.02));
      tg.addColorStop(0.5, hexA(theme, 0.18));
      tg.addColorStop(1, hexA(theme, 0.02));
      ctx.fillStyle = tg;
      ctx.fillRect(0, 0, W, 96);
      var rg = ctx.createRadialGradient(W * 0.34, H * 0.42, 60, W * 0.34, H * 0.42, W * 0.72);
      rg.addColorStop(0, hexA(theme, 0.22));
      rg.addColorStop(0.6, hexA(theme, 0.07));
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = hexA(theme, 0.3);
      ctx.lineWidth = 7;
      ctx.strokeRect(3, 3, W - 6, H - 6);
    }
    // 地面（主题色提亮地面顶线）
    var fg = ctx.createLinearGradient(0, FLOOR, 0, H);
    fg.addColorStop(0, '#232c4e');
    fg.addColorStop(1, '#161c38');
    ctx.fillStyle = fg;
    ctx.fillRect(0, FLOOR, W, H - FLOOR);
    ctx.fillStyle = theme ? hexA(theme, 0.85) : '#3d4a7d';
    ctx.fillRect(0, FLOOR, W, 4);
    ctx.fillStyle = 'rgba(120,150,230,0.25)';
    for (var x = 0; x < W; x += 80) ctx.fillRect(x, FLOOR + 14, 40, 2);
  }

  // ---------- 牛顿摆框架与琴弦 ----------
  function drawFrame(ctx, P) {
    var dir = P.dir || 1;
    var span = 8 * P.r; // 5 球支点总跨距
    var x0 = P.frameX + Math.min(0, dir * span) - 46;
    var x1 = P.frameX + Math.max(0, dir * span) + 46;
    var y = P.frameY;
    // 顶梁
    var g = ctx.createLinearGradient(0, y - 26, 0, y + 10);
    g.addColorStop(0, '#59648f'); g.addColorStop(0.5, '#39415f'); g.addColorStop(1, '#232a44');
    ctx.fillStyle = g;
    rr(ctx, x0, y - 26, x1 - x0, 34, 8); ctx.fill();
    // 立柱
    ctx.fillStyle = '#2c3352';
    rr(ctx, x0 - 8, y - 26, 18, FLOOR - y + 20, 6); ctx.fill();
    rr(ctx, x1 - 10, y - 26, 18, FLOOR - y + 20, 6); ctx.fill();
    // 铭牌
    ctx.fillStyle = 'rgba(140,170,255,0.5)';
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('NEWTON·05 动量实验台', (x0 + x1) / 2, y - 36);
    ctx.textAlign = 'left';
  }

  function drawCradle(ctx, cradle, aim, time, theme) {
    var P = cradle.P, balls = cradle.balls;
    // 阴影
    for (var i = 0; i < 5; i++) {
      var b = balls[i];
      var pos = b.broken ? { x: b.fx || 0, y: b.fy || 0 } : PHYS.ballPos(b, P);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(pos.x, FLOOR + 6, P.r * 0.9, 6, 0, 0, PHYS.TAU);
      ctx.fill();
    }
    // 摆线（5号球用可断弦：张力越高越红）
    for (var i2 = 0; i2 < 5; i2++) {
      var b2 = balls[i2];
      if (b2.broken) continue;
      var p2 = PHYS.ballPos(b2, P);
      var T = PHYS.tension(b2, P);
      var tt = Math.max(0, Math.min(1, (T - b2.m * P.g) / (P.breakT - b2.m * P.g)));
      ctx.strokeStyle = i2 === 4
        ? 'rgb(' + Math.round(150 + 100 * tt) + ',' + Math.round(200 - 140 * tt) + ',' + Math.round(220 - 160 * tt) + ')'
        : 'rgba(190,205,240,0.75)';
      ctx.lineWidth = i2 === 4 ? 2 + 1.5 * tt : 2;
      ctx.beginPath();
      ctx.moveTo(b2.pivotX, b2.pivotY);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      // 支点
      ctx.fillStyle = '#5a6798';
      ctx.beginPath(); ctx.arc(b2.pivotX, b2.pivotY, 4, 0, PHYS.TAU); ctx.fill();
    }
    // 钢球
    for (var i3 = 0; i3 < 5; i3++) {
      var b3 = balls[i3];
      var p3 = b3.broken ? { x: b3.fx || -999, y: b3.fy || -999 } : PHYS.ballPos(b3, P);
      if (b3.broken) continue;
      drawBall(ctx, p3.x, p3.y, P.r, i3 === 4, time, String(i3 + 1), i3 === 4 ? theme : null);
    }
    // 拖拽瞄准辅助
    if (aim && aim.active) drawAim(ctx, cradle, aim, time);
  }

  function drawBall(ctx, x, y, r, isBellBall, time, label, theme) {
    // 5 号球随关卡主题色着色（无主题时回退金色）
    var bHi = '#fff6d8', bMid = '#ffc94d', bLo = '#c67f00';
    if (theme) { bHi = shade(theme, 0.62); bMid = shade(theme, 0.08); bLo = shade(theme, -0.45); }
    ctx.save();
    if (isBellBall) {
      // 铃球：主题色水晶 + 呼吸光晕（与宝蓝钢球强烈区分）
      var glow = 0.5 + 0.5 * Math.sin(time * 0.004);
      ctx.shadowColor = theme ? hexA(theme, 0.55 + 0.35 * glow)
                              : 'rgba(255,200,90,' + (0.55 + 0.35 * glow) + ')';
      ctx.shadowBlur = 20 + 12 * glow;
    } else {
      ctx.shadowColor = 'rgba(100,150,255,0.45)';
      ctx.shadowBlur = 10;
    }
    var g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    if (isBellBall) {
      g.addColorStop(0, bHi); g.addColorStop(0.45, bMid); g.addColorStop(1, bLo);
    } else {
      // 钢球：宝蓝金属
      g.addColorStop(0, '#e6efff'); g.addColorStop(0.5, '#6f9ce8'); g.addColorStop(1, '#2b4fa8');
    }
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, PHYS.TAU); ctx.fill();
    ctx.restore();
    // 高光
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.3, y - r * 0.38, r * 0.22, r * 0.14, -0.6, 0, PHYS.TAU);
    ctx.fill();
    if (isBellBall) {
      ctx.strokeStyle = 'rgba(230,250,255,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, r - 1.5, 0, PHYS.TAU); ctx.stroke();
    }
    // 编号（1~4 钢球白字 / 5 铃球主题色深字）
    if (label) {
      ctx.font = '800 ' + Math.round(r * 0.78) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = isBellBall ? 'rgba(255,255,255,0.7)' : 'rgba(8,12,30,0.6)';
      ctx.strokeText(label, x, y + 1);
      ctx.fillStyle = isBellBall ? (theme ? shade(theme, -0.62) : '#7a5200') : '#f2f6ff';
      ctx.fillText(label, x, y + 1);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
  }

  // 瞄准：摆弧虚线、角度、拉起组高亮
  function drawAim(ctx, cradle, aim, time) {
    var P = cradle.P, k = aim.k;
    var p0 = PHYS.ballPos(cradle.balls[k], P);
    // 目标摆弧（从当前位置到最低点的虚线弧）
    ctx.setLineDash([6, 8]);
    ctx.strokeStyle = 'rgba(255,215,120,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    var a0 = cradle.balls[k].a, a1 = 0;
    for (var s = 0; s <= 20; s++) {
      var aa = a0 + (a1 - a0) * s / 20;
      var x = cradle.balls[k].pivotX + P.L * Math.sin(aa);
      var y = cradle.balls[k].pivotY + P.L * Math.cos(aa);
      if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // 拉起组标签：抓到的球号（1~4，越靠右链越长、放大越高）
    ctx.fillStyle = 'rgba(255,215,120,0.9)';
    ctx.font = '600 16px system-ui, sans-serif';
    var label = '抓 ' + (k + 1) + ' 号球 · 链放大 ×' + (PHYS.TRANSFER[k + 1] || 1.3).toFixed(2);
    var ly = Math.max(p0.y - P.r - 18, 28); // 高拉角时标签不超出画面顶端
    if (P.dir < 0) {
      // 摆台在右：文字右对齐、向球左侧展开，避免超出右边界
      ctx.textAlign = 'right';
      ctx.fillText(label, p0.x - P.r - 12, ly);
      ctx.textAlign = 'left';
    } else {
      ctx.fillText(label, p0.x - 78, ly);
    }
    var deg = Math.round(Math.abs(a0 * 180 / Math.PI));
    ctx.fillText(deg + '°', p0.x - P.r - 34, p0.y + 6);
  }

  // ---------- 钟（分值配色：大·青铜 / 中·蓝钢 / 小·紫晶，与计分图例一致） ----------
  var BELL_PAL = [
    { hi: '#ffe9a8', mid: '#d9a520', lo: '#8a6410', lip: '#6b4d0a', tongue: '#5a4010', knock: '#e8c060',
      pop: '#e0a35c', rgb: '224,163,92',  burst: '#ffd9a0' },   // 大钟 +100 青铜
    { hi: '#e6efff', mid: '#7fa8e8', lo: '#3a5aa8', lip: '#2e4780', tongue: '#3d5a9e', knock: '#a8c4f0',
      pop: '#7fb4ff', rgb: '127,180,255', burst: '#b8d4ff' },   // 中钟 +200 蓝钢
    { hi: '#f4e8ff', mid: '#c792ea', lo: '#7a3fb8', lip: '#5e2f92', tongue: '#6a3aa5', knock: '#e0c0f5',
      pop: '#c792ff', rgb: '199,146,255', burst: '#e5ccff' }    // 小钟 +300 紫晶
  ];

  function bellTier(bell) { return bell.r >= 44 ? 0 : bell.r >= 30 ? 1 : 2; }

  function drawBell(ctx, bell, time) {
    var x = bell.x, y = bell.y, r = bell.r;
    var pal = BELL_PAL[bellTier(bell)];
    var ring = bell.ringT > 0 ? bell.ringT : 0;
    var sway = ring > 0 ? Math.sin(time * 0.04) * ring * 0.5 : 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(sway * 0.12);
    var sc = 1 + ring * 0.15;
    ctx.scale(sc, sc);
    // 钟体
    var g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, pal.hi); g.addColorStop(0.5, pal.mid); g.addColorStop(1, pal.lo);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-r * 0.62, -r * 0.72);
    ctx.quadraticCurveTo(0, -r * 1.15, r * 0.62, -r * 0.72);
    ctx.quadraticCurveTo(r * 1.02, -r * 0.1, r * 0.92, r * 0.55);
    ctx.lineTo(-r * 0.92, r * 0.55);
    ctx.quadraticCurveTo(-r * 1.02, -r * 0.1, -r * 0.62, -r * 0.72);
    ctx.closePath();
    ctx.fill();
    // 钟口
    ctx.fillStyle = pal.lip;
    rr(ctx, -r * 0.98, r * 0.5, r * 1.96, r * 0.3, r * 0.14); ctx.fill();
    // 钟舌
    ctx.strokeStyle = pal.tongue; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, r * 0.55); ctx.lineTo(sway * 8, r * 0.95); ctx.stroke();
    ctx.fillStyle = pal.knock;
    ctx.beginPath(); ctx.arc(sway * 8, r * 0.98, r * 0.13, 0, PHYS.TAU); ctx.fill();
    // 高光
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.34, -r * 0.4, r * 0.2, r * 0.34, 0.5, 0, PHYS.TAU);
    ctx.fill();
    ctx.restore();
    // 命中光环（分值同色）
    if (ring > 0) {
      ctx.strokeStyle = 'rgba(' + pal.rgb + ',' + (ring * 0.8) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, r * (1.3 + (1 - ring) * 1.2), 0, PHYS.TAU); ctx.stroke();
    }
  }

  // ---------- 星星 ----------
  function drawStar(ctx, st, time) {
    var rot = time * 0.0012;
    var pulse = 0.85 + 0.15 * Math.sin(time * 0.005 + st.x);
    ctx.save();
    ctx.translate(st.x, st.y);
    ctx.shadowColor = 'rgba(255,230,120,0.9)';
    ctx.shadowBlur = 22;
    ctx.fillStyle = '#ffd75e';
    starPath(ctx, 0, 0, 26 * pulse, rot);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    starPath(ctx, st.x, st.y, 10 * pulse, rot);
    ctx.fill();
  }

  // ---------- 墙 ----------
  function drawWall(ctx, w) {
    var g = ctx.createLinearGradient(w.x, 0, w.x + w.w, 0);
    g.addColorStop(0, '#565f85'); g.addColorStop(0.5, '#3c4568'); g.addColorStop(1, '#2a3149');
    ctx.fillStyle = g;
    rr(ctx, w.x, w.y, w.w, w.h, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(160,180,240,0.3)';
    ctx.lineWidth = 1.5;
    rr(ctx, w.x + 2, w.y + 2, w.w - 4, w.h - 4, 3); ctx.stroke();
    // 铆钉
    ctx.fillStyle = 'rgba(200,215,255,0.4)';
    for (var y = w.y + 12; y < w.y + w.h - 6; y += 26) {
      ctx.beginPath(); ctx.arc(w.x + w.w / 2, y, 2.2, 0, PHYS.TAU); ctx.fill();
    }
  }

  // ---------- 弹丸 + 拖尾 ----------
  function drawProjectile(ctx, f, theme) {
    var trailC = theme || '#ffc64d';
    var n = f.trail.length / 2;
    for (var i = 0; i < n; i++) {
      var a = i / n;
      ctx.fillStyle = hexA(trailC, a * 0.4);
      ctx.beginPath();
      ctx.arc(f.trail[i * 2], f.trail[i * 2 + 1], 3 + a * 5, 0, PHYS.TAU);
      ctx.fill();
    }
    drawBall(ctx, f.x, f.y, f.r, true, 0, '5', theme);
  }

  // ---------- 粒子与飘字 ----------
  function drawParticles(ctx, ps, dt) {
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      p.life -= dt;
      if (p.life <= 0) { ps.splice(i, 1); i--; continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += (p.grav || 0) * dt;
      var a = p.life / p.max;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.shape === 'ring') {
        ctx.strokeStyle = p.color; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r0 + (1 - a) * p.r1, 0, PHYS.TAU); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, (p.r0 || 3) * a, 0, PHYS.TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawPopups(ctx, pops, dt) {
    for (var i = 0; i < pops.length; i++) {
      var t = pops[i];
      t.life -= dt;
      if (t.life <= 0) { pops.splice(i, 1); i--; continue; }
      var a = Math.min(1, t.life / 0.35);
      ctx.globalAlpha = a;
      ctx.font = '800 ' + (t.big ? 34 : 24) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(10,14,30,0.85)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color || '#ffd75e';
      ctx.fillText(t.text, t.x, t.y);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
      t.y -= dt * 55;
    }
  }

  var API = {
    W: W, H: H, FLOOR: FLOOR,
    BELL_PAL: BELL_PAL, bellTier: bellTier, hexA: hexA, shade: shade,
    drawBackground: drawBackground,
    drawFrame: drawFrame,
    drawCradle: drawCradle,
    drawBell: drawBell,
    drawStar: drawStar,
    drawWall: drawWall,
    drawProjectile: drawProjectile,
    drawParticles: drawParticles,
    drawPopups: drawPopups,
    starPath: starPath
  };
  root.RENDER = API;
})(typeof window !== 'undefined' ? window : globalThis);
