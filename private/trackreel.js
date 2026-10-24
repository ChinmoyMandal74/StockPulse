// THE EARNINGS TRACK RECORD VIDEO (2026-10-23, admin only): the Earnings
// track record card as a 27-second 9:16 video, for Instagram Reels and
// YouTube Shorts. The owner: "Build card with 1 included" (1: the video).
//
// paint(g, M, t) draws the frame at t milliseconds onto a 1080x1920 canvas
// context: a PURE function of the time and the model, as the Reel's is. The
// model is Cards.trackFrame's: every figure already worded by the card
// (tplStockTrack), so this file lays out and eases and does no arithmetic on
// the data. The ground, the glyph, the end card and the recorder are reel.js's.
//
// THE SAFE AREA, as the Reel's: Instagram and YouTube lay their own interface
// over the top, the bottom and the right edge. Everything to be read sits
// inside x 64..940 and y 250..1560.
(function (global) {
  'use strict';
  const K = global.Reel && global.Reel.kit;
  const W = 1080, H = 1920;
  const L = 64, R = 940, CW = R - L;
  const SANS = 'Geist, "Geist Fallback", system-ui, sans-serif';
  const MONO = '"Geist Mono", ui-monospace, monospace';
  const SCENES = [
    { id: 'open', t0: 0, t1: 3400 },
    { id: 'strip', t0: 3400, t1: 11600 },
    { id: 'hero', t0: 11600, t1: 16200 },
    { id: 'lines', t0: 16200, t1: 20400 },
    { id: 'revenue', t0: 20400, t1: 24200 },
    { id: 'end', t0: 24200, t1: 27400 },
  ];
  const DURATION = 27400, FADE_IN = 380, FADE_OUT = 300;
  const { clamp, prog, easeOut, easeInOut, font, fitFont, wrap, rrect, glyph, countUp } = K || {};
  const NONE_A = 0.22;

  function brand(g, M) {
    const I = M.ink;
    glyph(g, L, 252, 44, I.accent, 3);
    font(g, 700, 30, SANS); g.fillStyle = I.text; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('Tickr Lab', L + 56, 275);
    const txt = 'Since ' + M.since + ' · ' + M.n + ' releases';
    font(g, 500, 22, MONO);
    const w = g.measureText(txt).width + 36;
    g.strokeStyle = I.grid; g.lineWidth = 2; rrect(g, R - w, 255, w, 42, 21); g.stroke();
    g.fillStyle = I.axis; g.textAlign = 'center'; g.fillText(txt, R - w / 2, 277);
    g.textAlign = 'left';
  }
  function disclaimer(g, M) {
    g.globalAlpha = 0.85; font(g, 500, 22, MONO); g.fillStyle = M.ink.axis; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText('Mechanical readings — not investment advice', L, 1548);
    g.globalAlpha = 1;
  }
  function label(g, M, text, y, a) {
    g.globalAlpha = a; font(g, 600, 26, MONO); g.fillStyle = M.ink.accent; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText(text.toUpperCase(), L, y); g.globalAlpha = 1;
  }
  // A mark's colour: its label's, or the axis ink faint where none was stated.
  const markFill = (I, m) => m.color && !/color-mix/.test(m.color) ? m.color : I.axis;
  const markAlpha = (m) => (m.color && !/color-mix/.test(m.color) ? 1 : NONE_A);

  // ---- 1. who, and the question ---------------------------------------------
  function sceneOpen(g, M, t, A) {
    const I = M.ink;
    label(g, M, M.kick || 'Earnings track record', 470, A * easeOut(prog(t, 0, 400)));
    const p = easeOut(prog(t, 150, 600));
    g.globalAlpha = A * p; fitFont(g, M.name, 800, 92, 52, SANS, CW); g.fillStyle = I.text; g.textBaseline = 'alphabetic';
    const lines = wrap(g, M.name, CW).slice(0, 2);
    lines.forEach((ln, i) => g.fillText(ln, L, 590 + i * 100 + (1 - p) * 30));
    font(g, 600, 44, MONO); g.fillStyle = I.dim; g.fillText(M.sym, L, 590 + lines.length * 100 + 10);
    const q1 = 'What it said.', q2 = 'And what it did.';
    font(g, 800, 76, SANS);
    const s1 = q1.slice(0, Math.round(q1.length * prog(t, 1000, 700))), s2 = q2.slice(0, Math.round(q2.length * prog(t, 1800, 800)));
    g.globalAlpha = A; g.fillStyle = I.text; g.fillText(s1, L, 1060);
    g.fillStyle = I.accent; g.fillText(s2, L, 1160);
    g.globalAlpha = 1;
  }

  // ---- 2. the strip fills, a release at a time --------------------------------
  function sceneStrip(g, M, t, A) {
    const I = M.ink;
    label(g, M, 'What each results release said', 420, A * easeOut(prog(t, 0, 400)));
    font(g, 500, 30, SANS); g.globalAlpha = A * easeOut(prog(t, 100, 500)); g.fillStyle = I.dim; g.textBaseline = 'alphabetic';
    g.fillText('about its own outlook, oldest to newest', L, 470);
    const n = M.marks.length, gap = n > 30 ? 4 : 6, mw = (CW - gap * (n - 1)) / n, top = 560, mh = 200;
    const fill = prog(t, 700, 5600) * n;          // marks drawn so far
    const shown = Math.min(n, Math.floor(fill + 0.999));
    // The year the fill has reached, large.
    let year = '';
    for (let i = 0; i < shown; i++) if (M.marks[i].y) year = M.marks[i].y;
    for (let i = 0; i < n; i++) {
      const x = L + i * (mw + gap);
      const k = clamp(fill - i, 0, 1);
      g.globalAlpha = A * 0.5; g.fillStyle = I.grid; rrect(g, x, top, mw, mh, Math.min(6, mw / 3)); g.fill();
      if (k > 0) {
        const m = M.marks[i];
        g.globalAlpha = A * markAlpha(m) * easeOut(k);
        g.fillStyle = markFill(I, m);
        const h = mh * easeOut(k);
        rrect(g, x, top + mh - h, mw, h, Math.min(6, mw / 3)); g.fill();
      }
      if (M.marks[i].y) { g.globalAlpha = A * 0.9; font(g, 500, 20, MONO); g.fillStyle = I.axis; g.textAlign = 'left'; g.fillText(M.marks[i].y, x, top + mh + 34); }
    }
    if (year) { g.globalAlpha = A; font(g, 800, 120, MONO); g.fillStyle = I.text; g.textAlign = 'right'; g.fillText(year, R, 960); g.textAlign = 'left'; }
    // The running count of each kind, as the strip fills.
    const tally = {};
    for (let i = 0; i < shown; i++) { const c = M.marks[i].color && !/color-mix/.test(M.marks[i].color) ? M.marks[i].color : 'none'; tally[c] = (tally[c] || 0) + 1; }
    M.legend.forEach((l, i) => {
      const y = 1060 + i * 64;
      const p = easeOut(prog(t, 500 + i * 120, 400));
      g.globalAlpha = A * p;
      g.fillStyle = l.color || I.axis; g.globalAlpha = A * p * (l.color ? 1 : NONE_A * 2);
      rrect(g, L, y - 26, 30, 30, 7); g.fill();
      g.globalAlpha = A * p; font(g, 600, 34, SANS); g.fillStyle = I.text; g.textBaseline = 'alphabetic';
      g.fillText(l.word, L + 50, y);
      font(g, 700, 34, MONO); g.textAlign = 'right';
      g.fillText(String(tally[l.color || 'none'] || 0), R, y); g.textAlign = 'left';
    });
    g.globalAlpha = 1;
  }

  // ---- 3. the headline --------------------------------------------------------
  function sceneHero(g, M, t, A) {
    const I = M.ink;
    label(g, M, 'Said, then did', 520, A * easeOut(prog(t, 0, 400)));
    const k = easeOut(prog(t, 300, 1300));
    const parts = /^(\d+) of (\d+)$/.exec(M.hero.big);
    const big = parts ? Math.round(Number(parts[1]) * k) + ' of ' + parts[2] : M.hero.big;
    g.globalAlpha = A; fitFont(g, big, 800, 230, 120, SANS, CW); g.fillStyle = I.text; g.textBaseline = 'alphabetic';
    g.fillText(big, L, 800);
    const p = easeOut(prog(t, 1300, 700));
    g.globalAlpha = A * p; font(g, 600, 46, SANS); g.fillStyle = I.dim;
    wrap(g, M.hero.text, CW).slice(0, 4).forEach((ln, i) => g.fillText(ln, L, 900 + i * 62 + (1 - p) * 20));
    g.globalAlpha = 1;
  }

  // ---- 4. three lines -------------------------------------------------------
  function sceneLines(g, M, t, A) {
    const I = M.ink;
    label(g, M, 'The record', 470, A * easeOut(prog(t, 0, 400)));
    M.lines.forEach((ln, i) => {
      const p = easeOut(prog(t, 250 + i * 650, 500));
      if (p <= 0) return;
      const y = 600 + i * 260;
      g.globalAlpha = A * p; font(g, 500, 34, SANS); g.fillStyle = I.dim; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
      g.fillText(ln[0], L + (1 - p) * 40, y);
      fitFont(g, ln[1], 800, 62, 38, SANS, CW); g.fillStyle = I.text;
      wrap(g, ln[1], CW).slice(0, 2).forEach((w, j) => g.fillText(w, L + (1 - p) * 40, y + 80 + j * 70));
      g.globalAlpha = A * p * 0.6; g.strokeStyle = I.grid; g.lineWidth = 2; g.beginPath(); g.moveTo(L, y + 170); g.lineTo(R, y + 170); g.stroke();
    });
    g.globalAlpha = 1;
  }

  // ---- 5. revenue, quarter by quarter -----------------------------------------
  function sceneRevenue(g, M, t, A) {
    const I = M.ink;
    label(g, M, 'Revenue, quarter by quarter', 470, A * easeOut(prog(t, 0, 400)));
    const v = M.revenue, n = v.length;
    if (n < 2) return;
    const gap = 8, bw = (CW - gap * (n - 1)) / n, base = 1250, mh = 600;
    for (let i = 0; i < n; i++) {
      const k = easeOut(prog(t, 300 + i * 70, 600));
      const h = Math.max(6, mh * v[i] * k);
      g.globalAlpha = A * 0.92; g.fillStyle = I.accent;
      rrect(g, L + i * (bw + gap), base - h, bw, h, 6); g.fill();
    }
    const p = easeOut(prog(t, 300 + n * 70, 600));
    g.globalAlpha = A * p; font(g, 800, 72, MONO); g.fillStyle = I.text; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText(countUp(M.revLabel, p), L, 1360);
    if (M.yoy) { font(g, 600, 36, MONO); g.fillStyle = I.dim; g.fillText('latest quarter · ' + M.yoy, L, 1420); }
    g.globalAlpha = 1;
  }

  function sceneEnd(g, M, t, A) { global.Reel.endCard(g, M.ink, t, A, W, H, M.date); }

  const PAINT = { open: sceneOpen, strip: sceneStrip, hero: sceneHero, lines: sceneLines, revenue: sceneRevenue, end: sceneEnd };
  function paint(g, M, t) {
    t = clamp(t, 0, DURATION);
    g.save();
    K.groundOf(g, M.ink, t, W, H);
    for (let i = 0; i < SCENES.length; i++) {
      const s = SCENES[i], last = i === SCENES.length - 1;
      if (t < s.t0 || (!last && t >= s.t1)) continue;
      const local = t - s.t0;
      const A = Math.min(prog(local, 0, FADE_IN), last ? 1 : 1 - prog(t, s.t1 - FADE_OUT, FADE_OUT));
      if (s.id !== 'end') { g.globalAlpha = 1; brand(g, M); }
      PAINT[s.id](g, M, local, A);
    }
    disclaimer(g, M);
    g.restore();
  }

  global.TrackReel = { W, H, DURATION, SCENES, paint };
})(typeof window !== 'undefined' ? window : globalThis);
