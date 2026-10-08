/* =========================================================================
 * 动量五重奏 —— WebAudio 音效合成（无外部资源，全部程序生成）
 * 首次用户手势时初始化（浏览器自动播放策略）。
 * ========================================================================= */
(function (root) {
  'use strict';

  var ctx = null;
  var master = null;
  var muted = false;

  function init() {
    if (ctx) return true;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    return true;
  }

  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

  function ready() {
    if (muted) return false;
    if (!init()) return false;
    resume();
    return true;
  }

  // 通用音符：频率、时长、类型、音量、泛音
  function tone(freq, dur, type, vol, when, harmonics) {
    var t0 = ctx.currentTime + (when || 0);
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(master);
    var osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    osc.connect(g);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
    if (harmonics) {
      for (var i = 0; i < harmonics.length; i++) {
        var h = harmonics[i];
        var g2 = ctx.createGain();
        g2.gain.setValueAtTime(vol * h[1], t0);
        g2.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * h[2]);
        g2.connect(master);
        var o2 = ctx.createOscillator();
        o2.type = 'sine';
        o2.frequency.value = freq * h[0];
        o2.connect(g2);
        o2.start(t0); o2.stop(t0 + dur + 0.05);
      }
    }
  }

  function noise(dur, vol, hp) {
    var t0 = ctx.currentTime;
    var len = Math.floor(ctx.sampleRate * dur);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = hp || 2000;
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0);
  }

  // 五声音阶（C 大调宫商角徵羽 + 高八度），钟越大音越低
  var SCALE = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.5, 1174.7];

  var SFX = {
    // 钢球互撞：短促哒声，音量随撞击速度
    clack: function (speed) {
      if (!ready()) return;
      var v = Math.min(0.5, speed / 2600);
      if (v < 0.02) return;
      tone(210 + Math.min(240, speed * 0.12), 0.05, 'square', v * 0.5, 0, [[2.7, 0.5, 0.4], [5.1, 0.25, 0.3]]);
      noise(0.03, v * 0.35, 3200);
    },
    // 断线：绷断 + 嗖
    snap: function () {
      if (!ready()) return;
      noise(0.16, 0.5, 1400);
      tone(1400, 0.1, 'sawtooth', 0.12);
      tone(600, 0.22, 'sine', 0.1, 0.03);
    },
    // 命中钟：五声音阶钟声
    bell: function (noteIdx, combo) {
      if (!ready()) return;
      var f = SCALE[Math.min(noteIdx + (combo || 0), SCALE.length - 1)];
      tone(f, 1.5, 'sine', 0.35, 0, [[2.76, 0.3, 0.5], [5.4, 0.12, 0.3]]);
    },
    // 收集星星：上行琶音
    star: function () {
      if (!ready()) return;
      [0, 2, 4, 7].forEach(function (s, i) {
        tone(659.25 * Math.pow(2, s / 12), 0.35, 'triangle', 0.22, i * 0.07);
      });
    },
    bounce: function (speed) {
      if (!ready()) return;
      tone(120, 0.08, 'sine', Math.min(0.3, speed / 3000));
    },
    click: function () {
      if (!ready()) return;
      tone(660, 0.06, 'triangle', 0.15);
    },
    shot: function () {
      if (!ready()) return;
      noise(0.08, 0.2, 900);
    },
    win: function () {
      if (!ready()) return;
      [0, 4, 7, 12].forEach(function (s, i) {
        tone(523.25 * Math.pow(2, s / 12), 0.5, 'triangle', 0.2, i * 0.12);
      });
    },
    fail: function () {
      if (!ready()) return;
      [300, 240, 180].forEach(function (f, i) { tone(f, 0.4, 'sawtooth', 0.12, i * 0.15); });
    },
    toggleMute: function () {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.55;
      return muted;
    },
    isMuted: function () { return muted; }
  };

  root.SFX = SFX;
})(typeof window !== 'undefined' ? window : globalThis);
