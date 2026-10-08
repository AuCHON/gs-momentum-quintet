/* =========================================================================
 * 动量五重奏 —— 关卡数据
 * 逻辑舞台 1600×900，地面 y=872。
 * 【本文件坐标系】摆台在左（支点 x=210、y=130，摆长 300），5 号球出手点
 * (418, 430) 水平向右弹射，受重力下坠：
 *   y(x) = 430 + 750·((x−418)/v)² ，可稳定实现的弹速 v ≈ 400~1250 px/s
 *   （越远/越高的目标需要更高弹速；贴地目标可靠落地弹跳滚入）
 * 游戏实际布局为镜像（摆台在右侧 x=1270、向左发射，出手点 (1062, 430)），
 * 加载时由 game.js 的 mirrorX(x)=1480−x 统一变换（镜像并左移 120px，
 * 为右侧拉球留出画面空间）——目标与出手点的距离保持不变，射程关系
 * 完全对称，故本表坐标依然有效。所有坐标均已按上式校验可达。
 *
 * bell: {x, y, r, pts, note(五声音阶), move?:{axis:'x'|'y', amp, period, phase}}
 * star: {x, y} 一次性奖励（350 分）
 * wall:{x, y, w, h} 障碍墙（可反弹）
 * 三星线：target=1星 / s2=2星 / s3=3星
 * ========================================================================= */
(function (root) {
  'use strict';

  var BIG   = { r: 46, pts: 100, note: 0 };
  var MID   = { r: 34, pts: 200, note: 2 };
  var SMALL = { r: 25, pts: 300, note: 4 };

  function bell(x, y, kind, move) {
    var b = { x: x, y: y, r: kind.r, pts: kind.pts, note: kind.note };
    if (move) b.move = move;
    return b;
  }

  var LEVELS = [
    { // 1 —— 教学：一颗大钟，学会拖拽释放
      name: '第一声', hint: '抓住最右边的重球向右上方拖——看右下仪表，弹速到 870 左右松手！',
      shots: 5, target: 100, s2: 200, s3: 400,
      bells: [bell(880, 640, BIG)],
      stars: [], walls: []
    },
    { // 2 —— 近远双钟：轻拉与重拉
      name: '远与近', hint: '近钟轻轻拉（约 540），远钟使劲拉（约 1070）——拉太轻弦不会断',
      shots: 5, target: 300, s2: 500, s3: 700,
      bells: [bell(740, 700, BIG), bell(1130, 760, MID)],
      stars: [], walls: []
    },
    { // 3 —— 高低差 + 第一颗星
      name: '高与低', hint: '高处的钟要小拉角（下坠少），低处的远钟要大拉角全力弹射',
      shots: 6, target: 500, s2: 800, s3: 1100,
      bells: [bell(590, 500, MID), bell(1240, 800, SMALL)],
      stars: [{ x: 940, y: 700 }],
      walls: []
    },
    { // 4 —— 竖直移动钟：预判
      name: '钟摆的预判', hint: '上下移动的钟——让球飞到它“将要到达”的位置',
      shots: 6, target: 400, s2: 750, s3: 1100,
      bells: [bell(950, 640, MID, { axis: 'y', amp: 150, period: 3.2, phase: 0 }),
              bell(700, 780, BIG)],
      stars: [], walls: []
    },
    { // 5 —— 高墙：弹道要越过去
      name: '越墙', hint: '墙挡住了低平弹道——弹速够快、下坠才少，才能越过墙顶（约 790 以上）',
      shots: 6, target: 500, s2: 900, s3: 1300,
      bells: [bell(1060, 700, MID), bell(1200, 820, BIG)],
      stars: [{ x: 950, y: 790 }],
      walls: [{ x: 770, y: 580, w: 26, h: 292 }]
    },
    { // 6 —— 峡谷夹缝：落点要准
      name: '峡谷', hint: '两堵墙之间藏着星星——射程要正好落进夹缝（约 1100 弹速）',
      shots: 7, target: 600, s2: 1000, s3: 1500,
      bells: [bell(880, 700, MID), bell(1070, 780, SMALL)],
      stars: [{ x: 1150, y: 760 }],
      walls: [{ x: 780, y: 620, w: 24, h: 252 },
              { x: 1330, y: 500, w: 24, h: 372 }]
    },
    { // 7 —— 横移钟 + 追分星
      name: '游走的钟', hint: '左右巡逻的小钟值 300 分——瞄准它运动的前方出手',
      shots: 7, target: 800, s2: 1300, s3: 1800,
      bells: [bell(900, 740, SMALL, { axis: 'x', amp: 230, period: 4.0, phase: 0 }),
              bell(660, 540, MID)],
      stars: [{ x: 1250, y: 820 }],
      walls: []
    },
    { // 8 —— 回廊谷地：两墙之间的深谷
      name: '回廊', hint: '先越过第一堵矮墙落入谷地！谷里的钟和星一次飞行可以连击',
      shots: 7, target: 900, s2: 1400, s3: 1900,
      bells: [bell(1000, 780, MID), bell(1080, 830, SMALL), bell(1420, 840, BIG)],
      stars: [{ x: 1030, y: 840 }],
      walls: [{ x: 880, y: 700, w: 24, h: 172 },
              { x: 1180, y: 700, w: 24, h: 172 }]
    },
    { // 9 —— 钟林：连击的主场
      name: '钟林', hint: '一次飞行连续命中多个目标，连击倍率会暴涨（×2、×3…最高 ×5）',
      shots: 8, target: 1100, s2: 1700, s3: 2300,
      bells: [bell(640, 620, MID),
              bell(880, 770, SMALL),
              bell(1080, 660, SMALL),
              bell(1280, 744, MID, { axis: 'y', amp: 120, period: 2.8, phase: 1 })], // y+amp+r=898≤900：摆到最低点也完整在画布内
      stars: [{ x: 1000, y: 680 }],
      walls: []
    },
    { // 10 —— 五重奏：移动钟 + 双墙 + 连击合奏
      name: '五重奏', hint: '多目标合奏——预判、越墙、落地滚弹、连击！',
      shots: 9, target: 1600, s2: 2300, s3: 3000,
      bells: [bell(600, 560, MID, { axis: 'y', amp: 90, period: 2.4, phase: 0.5 }),
              bell(850, 780, SMALL, { axis: 'x', amp: 130, period: 3.6, phase: 0 }),
              bell(940, 580, SMALL),
              bell(1060, 660, MID),
              bell(1330, 830, BIG)],
      stars: [{ x: 980, y: 700 }, { x: 1200, y: 740 }],
      walls: [{ x: 730, y: 680, w: 22, h: 192 },
              { x: 1160, y: 760, w: 22, h: 112 }]
    },
    { // 11 —— 精准乐器：三面小钟的弹速控制考核
      name: '精准乐器', hint: '三面小钟各需不同弹速——用「抓球号数 × 拉角」精调，一次飞行连击刷分',
      shots: 8, target: 1200, s2: 1900, s3: 2600,
      bells: [bell(640, 520, SMALL),
              bell(880, 600, SMALL),
              bell(1150, 760, SMALL, { axis: 'y', amp: 100, period: 3.0, phase: 0 })],
      stars: [{ x: 1000, y: 840 }],
      walls: [{ x: 780, y: 620, w: 24, h: 252 }]
    },
    { // 12 —— 终章：三重门 + 全机制大合奏
      name: '终章·动量交响', hint: '三堵门、巡逻钟、门下滚弹收尾——所有技巧的最后合奏!',
      shots: 9, target: 1800, s2: 2600, s3: 3400,
      bells: [bell(780, 730, MID),
              bell(860, 660, SMALL, { axis: 'x', amp: 100, period: 3.4, phase: 0 }),
              bell(920, 600, SMALL),
              bell(1130, 780, SMALL),
              bell(1432, 840, BIG)], // x≤1434：镜像后(1480−x)钟完整在画布内（1450 会使左缘越界 16px）
      stars: [{ x: 1080, y: 720 }, { x: 1330, y: 820 }],
      walls: [{ x: 700, y: 660, w: 22, h: 212 },
              { x: 1000, y: 720, w: 22, h: 152 },
              { x: 1300, y: 760, w: 22, h: 40 }]
    }
  ];

  // ---------------- 无尽模式：程序化生成一轮目标 ----------------
  // 可达性约束：y ≥ 430 + 750·((x−418)/1050)²（1050 = 稳定可得的弹速），
  // 保证每颗钟都能被打到；横移钟按最远端校验。
  function yMinFor(x) {
    var t = (x - 418) / 1050;
    return Math.max(470, 430 + 750 * t * t);
  }

  function makeEndlessRound(round, rng) {
    rng = rng || Math.random;
    var bells = [], stars = [], walls = [];
    var n = Math.min(3 + Math.floor(round / 2), 6);
    var lastX = 600;
    // x 上限 1170：保证 yMinFor(x) ≤ 815，钟的可达下限不出地面
    for (var i = 0; i < n; i++) {
      var kind = round < 3 ? (i === 0 ? BIG : MID)
               : (rng() < 0.45 ? SMALL : rng() < 0.7 ? MID : BIG);
      var x = clampN(lastX + 80 + rng() * 260, 560, 1170);
      var yTop = clampN(470 + rng() * 380, 470, 840);
      var y = clampN(yTop, yMinFor(x), 840);
      var b = bell(Math.round(x), Math.round(y), kind);
      if (round >= 2 && rng() < 0.35 + Math.min(round * 0.04, 0.25)) {
        if (rng() < 0.5) {
          b.move = { axis: 'y', amp: 60 + rng() * 120, period: 2.2 + rng() * 1.6, phase: rng() * 6.28 };
        } else {
          var amp = Math.min(90 + rng() * 150, 1194 - x);
          // 横移最远端也要可达
          var yNeed = yMinFor(x + amp);
          if (y < yNeed) y = clampN(yNeed, 470, 840);
          b.y = Math.round(y);
          b.move = { axis: 'x', amp: amp, period: 2.8 + rng() * 1.8, phase: rng() * 6.28 };
        }
      }
      bells.push(b);
      lastX = x;
    }
    if (round >= 2 && rng() < 0.6) {
      var sx = 700 + rng() * 450;
      stars.push({ x: Math.round(sx), y: Math.round(clampN(700 + rng() * 160, Math.max(700, yMinFor(sx)), 846)) });
    }
    if (round >= 3 && rng() < 0.55) {
      // 矮墙（顶端 ≥600）且离摆不太远，保证能越过
      var wx = 700 + rng() * 250;
      var wy = 600 + rng() * 100;
      walls.push({ x: Math.round(wx), y: Math.round(wy), w: 24, h: Math.round(872 - wy) });
    }
    return { bells: bells, stars: stars, walls: walls };
  }

  function clampN(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // 每关的视觉标识：主题色（互不重复、色相差异明显）+ 机制标签
  // 青/黄绿/亮黄/红/棕/翡翠/紫/靛/橙/品红/天蓝/金琥珀
  var META = [
    { color: '#4dd0e1', tag: '教学入门' },
    { color: '#8bc34a', tag: '远近双钟' },
    { color: '#fdd835', tag: '高低差' },
    { color: '#ef5350', tag: '移动钟预判' },
    { color: '#a1887f', tag: '越墙' },
    { color: '#2e9e6b', tag: '峡谷夹缝' },
    { color: '#ab47bc', tag: '横移巡逻' },
    { color: '#5c6bc0', tag: '双墙回廊' },
    { color: '#ff7043', tag: '连击主场' },
    { color: '#ec407a', tag: '五球合奏' },
    { color: '#29b6f6', tag: '弹速精控' },
    { color: '#ffb300', tag: '终局之战' }
  ];

  var API = { LEVELS: LEVELS, META: META, makeEndlessRound: makeEndlessRound, KIND: { BIG: BIG, MID: MID, SMALL: SMALL } };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.LEVELS = API;
})(typeof window !== 'undefined' ? window : globalThis);
