// THE REEL (2026-10-19, admin only): one stock as a 22-second 9:16 video.
//
// The owner, over a stock-data API's Instagram ad: "Can you help me creating
// such marketing videos for instagram reel", then "One stock storyboard is
// fine .. I want to see this in action first and then decide changes".
//
// paint(g, M, t) draws the frame at t milliseconds onto a 1080x1920 canvas
// context. It is a PURE function of the time and the model: no state carried
// between frames, so a frame can be drawn in any order (a test seeks to the
// middle of a scene) and the recording is the same every time. The model is
// Cards.reelFrame's: every number already formatted by the card module, so
// this file eases and lays out and does no arithmetic on the data.
//
// THE SAFE AREA. Instagram lays its own interface over a Reel: the header
// across the top, the caption and the buttons along the bottom, the like and
// share column down the right. Everything that has to be read sits inside
// x 64..940 and y 250..1560; the ground and the grid run to the edges.
(function (global) {
  'use strict';
  const W = 1080, H = 1920;
  const L = 64, R = 940, CW = R - L;
  const SANS = 'Geist, "Geist Fallback", system-ui, sans-serif';
  const MONO = '"Geist Mono", ui-monospace, monospace';
  // The storyboard, in milliseconds. Each scene fades in over FADE_IN and out
  // over FADE_OUT at its end; the last one holds.
  const SCENES = [
    { id: 'open', t0: 0, t1: 3400 },
    { id: 'figures', t0: 3400, t1: 9800 },
    { id: 'signal', t0: 9800, t1: 14600 },
    { id: 'chart', t0: 14600, t1: 19400 },
    { id: 'end', t0: 19400, t1: 22600 },
  ];
  const DURATION = 22600, FADE_IN = 380, FADE_OUT = 300;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const prog = (t, a, d) => clamp((t - a) / d, 0, 1);
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);
  const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

  // A #rrggbb colour at no opacity.
  const clear = (hex) => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex)); return m ? 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',0)' : 'rgba(0,0,0,0)'; };
  function font(g, w, px, fam) { g.font = w + ' ' + px + 'px ' + fam; }
  // The largest size up to `max` at which `text` fits `width`, never under `min`.
  function fitFont(g, text, w, max, min, fam, width) {
    let px = max;
    for (; px > min; px -= 2) { font(g, w, px, fam); if (g.measureText(text).width <= width) break; }
    font(g, w, px, fam);
    return px;
  }
  function wrap(g, text, width) {
    const words = String(text || '').split(/\s+/).filter(Boolean), lines = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? cur + ' ' + w : w;
      if (cur && g.measureText(next).width > width) { lines.push(cur); cur = w; } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  function rrect(g, x, y, w, h, r) {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
  }
  // A formatted figure counted up from zero: "+23.4%" at k=0.5 reads "+11.7%".
  // Text that is not a number ("—", "loss") is returned as it is.
  function countUp(txt, k) {
    const m = /^([+−-]?\$?)(\d[\d,]*\.?\d*)(.*)$/.exec(String(txt));
    if (!m || k >= 1) return String(txt);
    const raw = m[2].replace(/,/g, ''), dec = (raw.split('.')[1] || '').length;
    const v = Number(raw) * k;
    const s = dec ? v.toFixed(dec) : String(Math.round(v));
    return m[1] + (m[2].indexOf(',') >= 0 ? Number(s).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : s) + m[3];
  }

  // ---- the ground, the grid, the brand ------------------------------------
  function ground(g, M, t) {
    const I = M.ink;
    g.globalAlpha = 1;
    g.fillStyle = I.ground; g.fillRect(0, 0, W, H);
    // A slow glow in the accent, drifting, so even a held frame breathes.
    const gx = 220 + 120 * Math.sin(t / 4200), gy = 520 + 160 * Math.cos(t / 5300);
    const glow = g.createRadialGradient(gx, gy, 0, gx, gy, 900);
    glow.addColorStop(0, I.accent); glow.addColorStop(1, I.ground);
    g.globalAlpha = 0.10; g.fillStyle = glow; g.fillRect(0, 0, W, H);
    // The grid, a chart's own paper.
    g.globalAlpha = 1; g.strokeStyle = I.grid; g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= W; x += 60) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); }
    for (let y = 0; y <= H; y += 60) { g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); }
    g.stroke();
    // Fade the grid out towards the foot, where Instagram's caption sits.
    const foot = g.createLinearGradient(0, H * 0.55, 0, H);
    // From the ground itself at no opacity: from transparent BLACK, a light
    // ground fades through grey.
    foot.addColorStop(0, clear(I.ground)); foot.addColorStop(1, I.ground);
    g.fillStyle = foot; g.fillRect(0, H * 0.55, W, H * 0.45);
  }
  // The site's glyph: a line that dips and climbs, with its arrowhead.
  function glyph(g, x, y, s, color, lw) {
    g.save(); g.translate(x, y); g.scale(s / 24, s / 24);
    g.strokeStyle = color; g.lineWidth = lw * 24 / s; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(3, 17.4); g.lineTo(8.6, 12); g.lineTo(12.2, 14.7); g.lineTo(20, 6.4); g.stroke();
    g.beginPath(); g.moveTo(14.6, 6.4); g.lineTo(20, 6.4); g.lineTo(20, 11.8); g.stroke();
    g.restore();
  }
  function brand(g, M) {
    const I = M.ink;
    glyph(g, L, 252, 44, I.accent, 3);
    font(g, 700, 30, SANS); g.fillStyle = I.text; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('Tickr Lab', L + 56, 275);
    // The day the numbers describe, as a chip on the right.
    const txt = 'Close of ' + (M.date || '');
    font(g, 500, 22, MONO);
    const w = g.measureText(txt).width + 36;
    g.globalAlpha = 0.9; g.strokeStyle = I.grid; g.lineWidth = 2;
    rrect(g, R - w, 255, w, 42, 21); g.stroke();
    g.fillStyle = I.axis; g.textAlign = 'center'; g.fillText(txt, R - w / 2, 277);
    g.globalAlpha = 1; g.textAlign = 'left';
  }
  function disclaimer(g, M, alpha) {
    g.globalAlpha = alpha * 0.85;
    font(g, 500, 22, MONO); g.fillStyle = M.ink.axis; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText('Mechanical readings — not investment advice', L, 1548);
    g.globalAlpha = 1;
  }
  function label(g, M, text, y, a) {
    g.globalAlpha = a;
    font(g, 600, 26, MONO); g.fillStyle = M.ink.accent; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText(text.toUpperCase(), L, y);
    g.globalAlpha = 1;
  }

  // ---- 1. the opening line, typed -----------------------------------------
  function sceneOpen(g, M, t, A) {
    const I = M.ink;
    const LINES = [['One stock.', I.text, 0], ['Every reading.', I.dim, 950], ['After every close.', I.accent, 1900]];
    const TYPE = 800;
    font(g, 800, 112, SANS); g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    let cx = null, cy = null;
    LINES.forEach(([txt, col, at], i) => {
      const p = prog(t, at, TYPE);
      if (p <= 0) return;
      const n = Math.round(txt.length * p), shown = txt.slice(0, n);
      const y = 720 + i * 140;
      g.globalAlpha = A; g.fillStyle = col;
      g.fillText(shown, L, y);
      cx = L + g.measureText(shown).width + 10; cy = y;
    });
    // The cursor, blinking at the end of whatever is being typed.
    if (cx != null && Math.floor(t / 420) % 2 === 0) {
      g.globalAlpha = A; g.fillStyle = I.accent; g.fillRect(cx, cy - 92, 10, 104);
    }
    g.globalAlpha = 1;
  }

  // ---- 2. the stock and its twelve figures --------------------------------
  function sceneFigures(g, M, t, A) {
    const I = M.ink;
    const fadeUp = (at, d) => { const p = easeOut(prog(t, at, d || 420)); return [A * p, (1 - p) * 28]; };
    let [a, dy] = fadeUp(0);
    g.globalAlpha = a; font(g, 500, 26, MONO); g.fillStyle = I.axis; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText(fitText(g, M.kick, CW), L, 400 + dy);
    [a, dy] = fadeUp(140);
    g.globalAlpha = a; g.fillStyle = I.text;
    // A long name takes a second line at a smaller size rather than an
    // ellipsis; the panel below gives back the room.
    let npx = fitFont(g, M.name, 800, 84, 56, SANS, CW), names = [M.name];
    if (g.measureText(M.name).width > CW) {
      npx = 56; font(g, 800, npx, SANS);
      names = wrap(g, M.name, CW);
      if (names.length > 2) names = [names[0], fitText(g, names.slice(1).join(' '), CW)];
    }
    const extra = (names.length - 1) * Math.round(npx * 1.1);
    names.forEach((ln, i) => g.fillText(fitText(g, ln, CW), L, 490 + i * Math.round(npx * 1.1) + dy));
    [a, dy] = fadeUp(280);
    g.globalAlpha = a; font(g, 600, 34, MONO);
    let x = L;
    const part = (s, col) => { g.fillStyle = col; g.fillText(s, x, 550 + extra + dy); x += g.measureText(s).width; };
    part(M.sym, I.dim);
    if (M.price) part('  ·  ' + M.price, I.dim);
    if (M.today) { part('  ·  ', I.dim); part(M.today + ' today', M.todayUp ? I.up : I.down); }
    // The panel.
    [a, dy] = fadeUp(520, 500);
    const PY = 610 + extra, PH = 900 - extra;
    g.globalAlpha = a * 0.05; g.fillStyle = I.text; rrect(g, L - 4, PY + dy, CW + 8, PH, 22); g.fill();
    g.globalAlpha = a * 0.9; g.strokeStyle = I.grid; g.lineWidth = 2; rrect(g, L - 4, PY + dy, CW + 8, PH, 22); g.stroke();
    g.globalAlpha = a; font(g, 600, 24, MONO); g.fillStyle = I.axis;
    g.fillText('RETURNS, POSITION, AND THE BUSINESS', L + 32, PY + 58 + dy);
    // Twelve cells, three across, each rising in turn and counting up.
    const cols = 3, cw = (CW - 40) / cols, ch = Math.floor((PH - 116) / 4), top = PY + 96;
    (M.cells || []).forEach((c, i) => {
      const at = 900 + i * 260;
      const p = easeOut(prog(t, at, 480));
      if (p <= 0) return;
      const cx = L + 20 + (i % cols) * cw, cy = top + Math.floor(i / cols) * ch + (1 - p) * 24;
      g.globalAlpha = A * p;
      font(g, 500, 24, MONO); g.fillStyle = I.axis; g.fillText(c.label, cx + 12, cy + 48);
      const col = c.cls === 'pos' ? I.up : c.cls === 'neg' ? I.down : I.text;
      g.fillStyle = col;
      fitFont(g, c.txt, 700, 54, 30, MONO, cw - 24);
      g.fillText(countUp(c.txt, easeOut(prog(t, at, 900))), cx + 12, cy + 120);
    });
    g.globalAlpha = 1;
  }
  function fitText(g, text, width) {
    let s = String(text || '');
    if (g.measureText(s).width <= width) return s;
    while (s.length > 1 && g.measureText(s + '…').width > width) s = s.slice(0, -1);
    return s + '…';
  }

  // ---- 3. the Signal, with the rule that fired ----------------------------
  function sceneSignal(g, M, t, A) {
    const I = M.ink;
    label(g, M, 'What the rules read', 400, A * easeOut(prog(t, 0, 400)));
    const ROW = 104, top = 450;
    const idx = M.action ? M.ladder.findIndex((l) => l.word === M.action) : -1;
    // The highlight sweeps down the ladder and settles on this stock's step.
    const sweep = easeInOut(prog(t, 300, 1300));
    const at = idx < 0 ? -1 : sweep * idx;
    M.ladder.forEach((l, i) => {
      const p = easeOut(prog(t, 120 + i * 70, 380));
      const y = top + i * ROW;
      const on = idx >= 0 && Math.abs(at - i) < 0.5;
      const settled = on && sweep >= 1;
      g.globalAlpha = A * p * (on ? 1 : 0.32);
      font(g, settled ? 800 : 650, settled ? 58 : 46, SANS);
      g.fillStyle = on ? l.color : I.dim; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(l.word, L + 40, y + ROW / 2);
      if (on) {
        g.globalAlpha = A * p; g.fillStyle = l.color;
        rrect(g, L, y + 18, 10, ROW - 36, 5); g.fill();
      }
    });
    // The rule, typed under the ladder once the highlight has settled.
    const ry = top + 6 * ROW + 90;
    const pr = prog(t, 1800, 300);
    if (pr > 0) {
      g.globalAlpha = A * pr;
      label(g, M, idx < 0 ? 'Not scored' : 'The rule that fired', ry, A * pr);
      const rule = idx < 0 ? 'Not enough stored history for the rules to reach a reading.' : (M.flag || '');
      font(g, 600, 40, SANS); g.fillStyle = I.text; g.textBaseline = 'alphabetic';
      const lines = wrap(g, rule, CW).slice(0, 4);
      const total = lines.join(' ').length;
      let left = Math.round(total * prog(t, 2000, 1500));
      lines.forEach((ln, i) => {
        const s = ln.slice(0, Math.max(0, left)); left -= ln.length + 1;
        g.globalAlpha = A; g.fillText(s, L, ry + 64 + i * 54);
      });
      g.globalAlpha = A * 0.8; font(g, 500, 24, MONO); g.fillStyle = I.axis;
      g.fillText('Balanced rules · a reading of strength, not an instruction', L, ry + 64 + Math.max(1, lines.length) * 54 + 30);
    }
    g.globalAlpha = 1;
  }

  // ---- 4. a year of its price ---------------------------------------------
  function sceneChart(g, M, t, A) {
    const I = M.ink;
    label(g, M, 'One year · price only', 400, A * easeOut(prog(t, 0, 400)));
    const C = M.chart && M.chart.closes;
    if (!C || C.length < 2) {
      g.globalAlpha = A; font(g, 600, 40, SANS); g.fillStyle = I.dim; g.textBaseline = 'alphabetic';
      g.fillText('No stored history to draw.', L, 600); g.globalAlpha = 1; return;
    }
    const col = M.moveUp == null ? I.flat : M.moveUp ? I.up : I.down;
    const draw = easeInOut(prog(t, 350, 3100));
    // The headline figure counts with the line.
    g.globalAlpha = A * easeOut(prog(t, 200, 400));
    font(g, 800, 128, SANS); g.fillStyle = col; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText(countUp(M.move, draw), L - 4, 560);
    font(g, 500, 28, MONO); g.fillStyle = I.axis;
    g.fillText('over the past year', L, 610);
    // The plot.
    const px = L, py = 700, pw = CW, ph = 640;
    let lo = Infinity, hi = -Infinity;
    for (const v of C) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const pad = (hi - lo) * 0.08 || 1;
    lo -= pad; hi += pad;
    const X = (i) => px + (i / (C.length - 1)) * pw, Y = (v) => py + (1 - (v - lo) / (hi - lo)) * ph;
    g.globalAlpha = A; g.strokeStyle = I.grid; g.lineWidth = 1.5;
    for (let k = 0; k <= 4; k++) { const y = py + (k / 4) * ph; g.beginPath(); g.moveTo(px, y); g.lineTo(px + pw, y); g.stroke(); }
    // The first close, dashed, so the move reads against where it began.
    g.setLineDash([8, 8]); g.strokeStyle = I.axis; g.globalAlpha = A * 0.6;
    g.beginPath(); g.moveTo(px, Y(C[0])); g.lineTo(px + pw, Y(C[0])); g.stroke(); g.setLineDash([]);
    const kk = draw * (C.length - 1), n = Math.floor(kk), f = kk - n;
    const tipV = n + 1 < C.length ? C[n] + (C[n + 1] - C[n]) * f : C[C.length - 1];
    const tipX = px + (kk / (C.length - 1)) * pw, tipY = Y(tipV);
    // Area under the line, then the line.
    const grad = g.createLinearGradient(0, py, 0, py + ph);
    grad.addColorStop(0, col); grad.addColorStop(1, I.ground);
    g.beginPath(); g.moveTo(X(0), py + ph);
    for (let i = 0; i <= n; i++) g.lineTo(X(i), Y(C[i]));
    g.lineTo(tipX, tipY); g.lineTo(tipX, py + ph); g.closePath();
    g.globalAlpha = A * 0.18; g.fillStyle = grad; g.fill();
    g.globalAlpha = A; g.strokeStyle = col; g.lineWidth = 5; g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath(); g.moveTo(X(0), Y(C[0]));
    for (let i = 1; i <= n; i++) g.lineTo(X(i), Y(C[i]));
    g.lineTo(tipX, tipY); g.stroke();
    // The tip: a dot with a soft ring.
    g.fillStyle = col; g.globalAlpha = A * 0.25; g.beginPath(); g.arc(tipX, tipY, 22, 0, Math.PI * 2); g.fill();
    g.globalAlpha = A; g.beginPath(); g.arc(tipX, tipY, 10, 0, Math.PI * 2); g.fill();
    // The dates under the plot.
    const day = (iso) => { const d = new Date(iso + 'T12:00:00'); return isNaN(d) ? iso : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); };
    font(g, 500, 24, MONO); g.fillStyle = I.axis; g.textBaseline = 'alphabetic';
    g.textAlign = 'left'; g.fillText(day(M.chart.dates[0]), px, py + ph + 44);
    g.textAlign = 'right'; g.fillText(day(M.chart.dates[M.chart.dates.length - 1]), px + pw, py + ph + 44);
    g.textAlign = 'left'; g.globalAlpha = 1;
  }

  // ---- 5. the end card ----------------------------------------------------
  function sceneEnd(g, M, t, A) {
    const I = M.ink;
    const p = easeOut(prog(t, 0, 600));
    const cx = W / 2;
    g.globalAlpha = A * p;
    glyph(g, cx - 80, 560 - (1 - p) * 30, 160, I.accent, 7);
    font(g, 800, 104, SANS); g.fillStyle = I.text; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillText('Tickr Lab', cx, 860);
    const p2 = easeOut(prog(t, 350, 500));
    g.globalAlpha = A * p2;
    font(g, 600, 46, MONO); g.fillStyle = I.accent;
    g.fillText('tickrlab.com', cx, 950);
    font(g, 500, 34, SANS); g.fillStyle = I.dim;
    ['Every stock on the screen, measured', 'the same way after every close.'].forEach((ln, i) => g.fillText(ln, cx, 1060 + i * 48));
    font(g, 500, 24, MONO); g.fillStyle = I.axis;
    g.fillText('Readings to the close of ' + (M.date || ''), cx, 1210);
    g.textAlign = 'left'; g.globalAlpha = 1;
  }

  const PAINT = { open: sceneOpen, figures: sceneFigures, signal: sceneSignal, chart: sceneChart, end: sceneEnd };
  function paint(g, M, t) {
    t = clamp(t, 0, DURATION);
    g.save();
    ground(g, M, t);
    for (let i = 0; i < SCENES.length; i++) {
      const s = SCENES[i], last = i === SCENES.length - 1;
      if (t < s.t0 || (!last && t >= s.t1)) continue;
      const local = t - s.t0;
      const A = Math.min(prog(local, 0, FADE_IN), last ? 1 : 1 - prog(t, s.t1 - FADE_OUT, FADE_OUT));
      if (s.id !== 'end') brand(g, M);
      PAINT[s.id](g, M, local, A);
    }
    disclaimer(g, M, 1);
    g.restore();
  }

  global.Reel = { W, H, DURATION, SCENES, paint, countUp };
})(typeof window !== 'undefined' ? window : globalThis);
