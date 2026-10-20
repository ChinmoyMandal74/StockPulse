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
  function ground(g, M, t) { groundOf(g, M.ink, t, W, H); }
  // Any of the three sizes: the Video from images tool paints its end card
  // at 4:5 and 1:1 as well as 9:16.
  function groundOf(g, I, t, w, h) {
    g.globalAlpha = 1;
    g.fillStyle = I.ground; g.fillRect(0, 0, w, h);
    // A slow glow in the accent, drifting, so even a held frame breathes.
    const gx = 220 + 120 * Math.sin(t / 4200), gy = h * 0.27 + 160 * Math.cos(t / 5300);
    const glow = g.createRadialGradient(gx, gy, 0, gx, gy, 900);
    glow.addColorStop(0, I.accent); glow.addColorStop(1, I.ground);
    g.globalAlpha = 0.10; g.fillStyle = glow; g.fillRect(0, 0, w, h);
    // The grid, a chart's own paper.
    g.globalAlpha = 1; g.strokeStyle = I.grid; g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= w; x += 60) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, h); }
    for (let y = 0; y <= h; y += 60) { g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); }
    g.stroke();
    // Fade the grid out towards the foot, where Instagram's caption sits.
    const foot = g.createLinearGradient(0, h * 0.55, 0, h);
    // From the ground itself at no opacity: from transparent BLACK, a light
    // ground fades through grey.
    foot.addColorStop(0, clear(I.ground)); foot.addColorStop(1, I.ground);
    g.fillStyle = foot; g.fillRect(0, h * 0.55, w, h * 0.45);
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
  function sceneEnd(g, M, t, A) { endCard(g, M.ink, t, A, W, H, M.date); }
  // At any of the three sizes, centred on the card. `date` is the day the
  // readings describe, and is left off when there are none (an image reel).
  function endCard(g, I, t, A, w, h, date) {
    const p = easeOut(prog(t, 0, 600));
    const cx = w / 2, cy = h / 2;
    g.globalAlpha = A * p;
    glyph(g, cx - 80, cy - 400 - (1 - p) * 30, 160, I.accent, 7);
    font(g, 800, 104, SANS); g.fillStyle = I.text; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillText('Tickr Lab', cx, cy - 100);
    const p2 = easeOut(prog(t, 350, 500));
    g.globalAlpha = A * p2;
    font(g, 600, 46, MONO); g.fillStyle = I.accent;
    g.fillText('tickrlab.com', cx, cy - 10);
    font(g, 500, 34, SANS); g.fillStyle = I.dim;
    ['Every stock on the screen, measured', 'the same way after every close.'].forEach((ln, i) => g.fillText(ln, cx, cy + 100 + i * 48));
    if (date) {
      font(g, 500, 24, MONO); g.fillStyle = I.axis;
      g.fillText('Readings to the close of ' + date, cx, cy + 250);
    }
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

  // ---- VIDEO FROM IMAGES (2026-10-20, admin only, /reelmaker) -------------
  //
  // The owner: "a seperate tool only for the admin wherein admin can select
  // upto 4 images and the app create a video, adds the 5th Tickr Lab mark and
  // adds all the transitions", then "include all 3 sizes ... Also include the
  // color for the 5th slide". Up to four images, each held for `per`
  // milliseconds, a transition into the next, and the Reel's end card last.
  //
  // THE THREE SHAPES Instagram takes for a video, all 1080 wide. 9:16 is the
  // full-screen Reel and Story; 4:5 is the tallest a feed post goes; 1:1 is
  // the square post. The page explains which is for what.
  const SHAPES = [
    { id: 'story', label: '9:16', w: 1080, h: 1920 },
    { id: 'portrait', label: '4:5', w: 1080, h: 1350 },
    { id: 'square', label: '1:1', w: 1080, h: 1080 },
  ];
  const TRANS_MS = 650, END_MS = 3400, CAP_IN = 300;
  // Each image composed ONCE onto a canvas of the video's own shape: an image
  // of another shape sits whole in the middle, over a blurred, darkened copy
  // of itself filling the frame, so a square card in a 9:16 video has no bars.
  // Blurring 1080x1920 on every frame would stall the recording; done here it
  // costs once per image.
  function composeImage(img, w, h) {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const g = c.getContext('2d');
    const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
    const cover = Math.max(w / iw, h / ih), contain = Math.min(w / iw, h / ih);
    const same = Math.abs(iw / ih - w / h) / (w / h) < 0.03;
    if (same) {
      g.drawImage(img, (w - iw * cover) / 2, (h - ih * cover) / 2, iw * cover, ih * cover);
      return c;
    }
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.filter = 'blur(48px) brightness(0.5)';
    const k = cover * 1.15;
    g.drawImage(img, (w - iw * k) / 2, (h - ih * k) / 2, iw * k, ih * k);
    g.filter = 'none';
    g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 60; g.shadowOffsetY = 18;
    g.drawImage(img, (w - iw * contain) / 2, (h - ih * contain) / 2, iw * contain, ih * contain);
    return c;
  }
  // The plan: S = { w, h, per, trans ('fade'|'slide'|'zoom'), ink, slides:
  // [{ canvas (from composeImage), caption }] }; a slide may instead carry
  // draw(g, local), a card building itself (cardSlide, below). Its length in milliseconds:
  const slidesDuration = (S) => S.slides.length * S.per + END_MS;
  // One caption: white on a dark band, typed in as the image settles. Inside
  // the 9:16 safe area (clear of Instagram's caption and buttons), and near
  // the foot on the two feed shapes, which carry no overlay.
  function caption(g, S, text, t) {
    if (!text) return;
    const p = prog(t, CAP_IN, 700);
    if (p <= 0) return;
    const maxW = S.w - 2 * L - 60;
    font(g, 700, 50, SANS);
    const lines = wrap(g, text, maxW).slice(0, 3);
    const lh = 64, padX = 30, padY = 24;
    const boxH = lines.length * lh + padY * 2 - 14;
    const bottom = S.h === 1920 ? 1530 : S.h - 90;
    const y0 = bottom - boxH;
    const boxW = Math.min(S.w - 2 * L, Math.max(...lines.map((l) => g.measureText(l).width)) + padX * 2);
    const a = easeOut(prog(t, CAP_IN, 350));
    g.globalAlpha = a * 0.72; g.fillStyle = '#000';
    rrect(g, L, y0 + (1 - a) * 20, boxW, boxH, 18); g.fill();
    g.globalAlpha = a; g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    const total = lines.join(' ').length;
    let left = Math.round(total * p);
    lines.forEach((ln, i) => {
      g.fillText(ln.slice(0, Math.max(0, left)), L + padX, y0 + (1 - a) * 20 + padY + 44 + i * lh);
      left -= ln.length + 1;
    });
    g.globalAlpha = 1;
  }
  // Item i at its own local time: an image (with its slow zoom when asked) or,
  // past the last image, the end card on its ground.
  function item(g, S, i, local) {
    const n = S.slides.length;
    if (i >= n) {
      groundOf(g, S.ink, local, S.w, S.h);
      endCard(g, S.ink, local, 1, S.w, S.h, null);
      g.globalAlpha = 0.85;
      font(g, 500, 22, MONO); g.fillStyle = S.ink.axis; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.fillText('Mechanical readings — not investment advice', S.w / 2, S.h === 1920 ? 1548 : S.h - 60);
      g.textAlign = 'left'; g.globalAlpha = 1;
      return;
    }
    const sl = S.slides[i];
    if (S.trans === 'zoom') {
      // From 100% to 108% over the image's time on screen and its way out.
      const z = 1 + 0.08 * clamp(local / (S.per + TRANS_MS), 0, 1);
      g.save(); g.translate(S.w / 2, S.h / 2); g.scale(z, z); g.translate(-S.w / 2, -S.h / 2);
      if (sl.draw) sl.draw(g, local); else g.drawImage(sl.canvas, 0, 0, S.w, S.h);
      g.restore();
    } else if (sl.draw) sl.draw(g, local);
    else g.drawImage(sl.canvas, 0, 0, S.w, S.h);
    caption(g, S, sl.caption, local);
  }
  // The frame at t: the current item, and over the last TRANS_MS of its time
  // the next one coming in -- faded in, or pushed in from the right.
  function paintSlides(g, S, t) {
    const n = S.slides.length;
    t = clamp(t, 0, slidesDuration(S));
    const i = Math.min(n, Math.floor(t / S.per));
    const local = t - i * S.per;
    g.save();
    g.globalAlpha = 1;
    g.fillStyle = '#000'; g.fillRect(0, 0, S.w, S.h);
    const into = i < n ? local - (S.per - TRANS_MS) : -1;
    if (into <= 0) item(g, S, i, local);
    else {
      const p = easeInOut(clamp(into / TRANS_MS, 0, 1));
      if (S.trans === 'slide') {
        g.save(); g.translate(-p * S.w, 0); item(g, S, i, local); g.restore();
        g.save(); g.translate((1 - p) * S.w, 0); item(g, S, i + 1, into - TRANS_MS); g.restore();
      } else {
        item(g, S, i, local);
        // The incoming item drawn whole on its own canvas, then laid over at
        // p: drawing it straight at partial alpha would let its own layers
        // (the ground, the grid) show through one another.
        const off = S._off || (S._off = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(S.w, S.h) : Object.assign(document.createElement('canvas'), { width: S.w, height: S.h }));
        const og = off.getContext('2d');
        og.clearRect(0, 0, S.w, S.h);
        item(og, S, i + 1, into - TRANS_MS);
        g.globalAlpha = p; g.drawImage(off, 0, 0); g.globalAlpha = 1;
      }
    }
    g.restore();
  }
  // A colour picked by hand for the end card: dark or light ink by its
  // brightness. The accent there is the ink itself, because the site's blue
  // can vanish on a ground somebody chose (a blue one, say).
  function customInk(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
    const [r, gg, b] = m ? [1, 2, 3].map((k) => parseInt(m[k], 16) / 255) : [0, 0, 0];
    const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const lum = 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
    const ground = m ? '#' + m[1] + m[2] + m[3] : '#050505';
    return lum > 0.4
      ? { ground, text: '#0d1017', dim: '#2a313c', axis: '#3a4350', grid: 'rgba(13,16,23,0.10)', accent: '#0d1017' }
      : { ground, text: '#ffffff', dim: '#e9ecf2', axis: '#cfd6e2', grid: 'rgba(255,255,255,0.08)', accent: '#ffffff' };
  }

  // ---- VIDEO FROM CARDS (2026-10-20, admin only, the promo studio) ---------
  //
  // The owner, after trying Video from images: "It is not adding any dynamic
  // content like the race charts". An image is pixels; a card on the stage is
  // a layout whose parts are known. So any studio card can BUILD ITSELF: its
  // kicker and title slide in, its rows arrive one after another and wipe in
  // from the left (so a row's bar grows as it comes), grid cells pop in, and a
  // chart draws left to right. One rule for every template, no per-card code.
  //
  // HOW. The card is drawn twice by the one rasteriser: once whole, and once
  // with its parts hidden (the empty card: the ground, the brand, the
  // footer). Each frame is the empty card plus each part cut from the whole
  // one, placed by its own easing. What cannot move is a number INSIDE a
  // part: it is already pixels, so it arrives with its row rather than
  // counting up. The Reel (one stock) is the template that counts.
  //
  // cardParts(root, box) finds the parts, in reading order, never nested:
  //   - an <svg>, <canvas> or <img> wider than 300px is a chart: 'draw';
  //   - an element whose children repeat (three or more of one tag and
  //     class: table rows, list rows, grid cells) gives each child as a part,
  //     'row' when it is wide and short, 'pop' when it is closer to square;
  //   - anything small (under 140px tall, or with nothing inside) is a block
  //     that fades up: 'fade';
  //   - otherwise it is looked inside.
  // The brand and the footer stay on the empty card, so they never move.
  // `box` is the artboard's own rectangle; rectangles come back relative to it,
  // in the artboard's pixels.
  const PART_CAP = 48;
  function cardParts(root, box) {
    const out = [];
    const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height }; };
    const shown = (el) => { const r = el.getBoundingClientRect(); return r.width >= 4 && r.height >= 4 && getComputedStyle(el).visibility !== 'hidden'; };
    const sig = (el) => el.tagName + '.' + (typeof el.className === 'string' ? el.className : (el.className && el.className.baseVal) || '');
    const visit = (el, depth) => {
      for (const c of el.children) {
        if (out.length >= PART_CAP) return;
        if (c.matches('.s-top, .s-foot, .s-aura, style, script') || !shown(c)) continue;
        const r = rectOf(c);
        const tag = c.tagName.toLowerCase();
        if (tag === 'svg' || tag === 'canvas' || tag === 'img') { out.push({ el: c, r, kind: r.w > 300 ? 'draw' : 'fade' }); continue; }
        const kids = [...c.children].filter(shown);
        const count = {};
        for (const k of kids) count[sig(k)] = (count[sig(k)] || 0) + 1;
        const most = kids.length ? Math.max(...Object.values(count)) : 0;
        if (kids.length >= 3 && most >= 3) {
          for (const k of kids) {
            if (out.length >= PART_CAP) break;
            const kr = rectOf(k);
            out.push({ el: k, r: kr, kind: kr.w > kr.h * 3 ? 'row' : 'pop' });
          }
          continue;
        }
        if (!kids.length || depth > 7 || (r.h < 140 && !c.querySelector('svg, canvas, img'))) { out.push({ el: c, r, kind: 'fade' }); continue; }
        visit(c, depth + 1);
      }
    };
    visit(root, 0);
    return out;
  }
  // How long each kind takes to arrive, and the gap between one part's start
  // and the next: shorter when there are many, so a forty-row card is still
  // built within about two and a half seconds.
  const PART_MS = { fade: 450, row: 520, pop: 420, draw: 1500 };
  function cardSchedule(parts) {
    const gap = Math.min(140, 2000 / Math.max(1, parts.length));
    return parts.map((p, i) => ({ x: p.r.x, y: p.r.y, w: p.r.w, h: p.r.h, kind: p.kind, at: 250 + i * gap }));
  }
  // The painter for one card: `bg` the empty card, `full` the whole one, both
  // at the video's size; `parts` from cardSchedule.
  function cardSlide(bg, full, parts) {
    return function (g, local) {
      g.drawImage(bg, 0, 0);
      for (const p of parts) {
        const q = prog(local, p.at, PART_MS[p.kind]);
        if (q <= 0) continue;
        const e = easeOut(q);
        const x = Math.max(0, p.x), y = Math.max(0, p.y), w = Math.max(1, Math.min(p.w, full.width - x)), h = Math.max(1, Math.min(p.h, full.height - y));
        if (q >= 1) { g.drawImage(full, x, y, w, h, x, y, w, h); continue; }
        g.save();
        if (p.kind === 'draw') {
          const cw = w * easeInOut(q);
          g.drawImage(full, x, y, cw, h, x, y, cw, h);
        } else if (p.kind === 'row') {
          g.globalAlpha = Math.min(1, e * 1.5);
          const cw = w * e;
          g.drawImage(full, x, y, cw, h, x, y + (1 - e) * 10, cw, h);
        } else if (p.kind === 'pop') {
          g.globalAlpha = e;
          const k = 0.92 + 0.08 * e;
          g.translate(x + w / 2, y + h / 2); g.scale(k, k);
          g.drawImage(full, x, y, w, h, -w / 2, -h / 2, w, h);
        } else {
          g.globalAlpha = e;
          g.drawImage(full, x, y, w, h, x, y + (1 - e) * 26, w, h);
        }
        g.restore();
      }
    };
  }

  // ---- MUSIC MADE HERE (2026-10-20, the owner: "I have to provide the
  // music?", then "yes option 1"). Four short loops composed in code and
  // rendered in the browser by Web Audio's offline renderer: nothing to
  // licence, no file to find. Each is eight bars over a four-chord
  // progression, rendered with its reverb tail folded back onto its start so
  // it loops without a seam, then levelled to the same loudness. Seeded noise,
  // so a track sounds the same on every render.
  //
  // Clean and simple by design (synthesised pads, plucks and drums), not a
  // produced song. Your own file stays the other choice.
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
  function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function noiseBuf(ctx, secs, seed) {
    const b = ctx.createBuffer(1, Math.round(ctx.sampleRate * secs), ctx.sampleRate), d = b.getChannelData(0), r = seeded(seed);
    for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
    return b;
  }
  function roomImpulse(ctx, secs, seed) {
    const n = Math.round(ctx.sampleRate * secs), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c), r = seeded(seed + c); for (let i = 0; i < n; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / n, 3); }
    return b;
  }
  // The instruments. `out` is where a voice goes (the reverb bus or dry).
  function makeVoices(ctx) {
    const master = ctx.createDynamicsCompressor();
    master.threshold.value = -16; master.ratio.value = 3; master.attack.value = 0.01; master.release.value = 0.25;
    master.connect(ctx.destination);
    const bus = ctx.createGain(); bus.connect(master);
    const verb = ctx.createConvolver(); verb.buffer = roomImpulse(ctx, 2.4, 7);
    const wet = ctx.createGain(); wet.gain.value = 0.32;
    bus.connect(verb); verb.connect(wet); wet.connect(master);
    const dry = ctx.createGain(); dry.connect(master);
    const noise = noiseBuf(ctx, 1, 11);
    const V = {
      pad(notes, t, dur, vol) {
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1300; f.Q.value = 0.4;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + Math.min(0.9, dur * 0.3));
        g.gain.setValueAtTime(vol, t + Math.max(0.9, dur - 0.3)); g.gain.linearRampToValueAtTime(0, t + dur + 0.6);
        f.connect(g); g.connect(bus);
        for (const n of notes) for (const det of [-8, 8]) {
          const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(n); o.detune.value = det;
          o.connect(f); o.start(t); o.stop(t + dur + 0.7);
        }
      },
      bass(n, t, dur, vol, type) {
        const o = ctx.createOscillator(); o.type = type || 'triangle'; o.frequency.value = midi(n);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.012);
        g.gain.setTargetAtTime(vol * 0.6, t + 0.012, 0.15); g.gain.setTargetAtTime(0, t + dur, 0.06);
        o.connect(g); g.connect(dry); o.start(t); o.stop(t + dur + 0.4);
      },
      pluck(n, t, vol, decay) {
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3200;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
        f.connect(g); g.connect(bus);
        const a = ctx.createOscillator(); a.type = 'triangle'; a.frequency.value = midi(n);
        const b = ctx.createOscillator(); b.type = 'sine'; b.frequency.value = midi(n) * 2;
        const bg = ctx.createGain(); bg.gain.value = 0.3;
        a.connect(f); b.connect(bg); bg.connect(f);
        a.start(t); b.start(t); a.stop(t + decay + 0.05); b.stop(t + decay + 0.05);
      },
      kick(t, vol) {
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
        const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
        o.connect(g); g.connect(dry); o.start(t); o.stop(t + 0.4);
      },
      hat(t, vol) {
        const s = ctx.createBufferSource(); s.buffer = noise;
        const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
        const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        s.connect(f); f.connect(g); g.connect(dry); s.start(t, (t * 7.31) % 0.9); s.stop(t + 0.06);
      },
      clap(t, vol) {
        const s = ctx.createBufferSource(); s.buffer = noise;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 0.8;
        const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        s.connect(f); f.connect(g); g.connect(bus); s.start(t, (t * 3.17) % 0.7); s.stop(t + 0.22);
      },
    };
    return V;
  }
  // Chords as MIDI notes in close voicing, and their bass roots.
  const CH = {
    Am: [57, 60, 64], F: [57, 60, 65], C: [55, 60, 64], G: [55, 59, 62],
  };
  const ROOT = { Am: 45, F: 41, C: 48, G: 43 };
  const BARS = 8;
  const TRACKS = [
    { id: 'calm', name: 'Calm', note: 'slow ambient pads', bpm: 80, prog: ['Am', 'F', 'C', 'G'],
      play(V, beat, bar, b, ch, root) {
        V.pad(CH[ch], b * bar, bar, 0.045);
        V.bass(root, b * bar, bar * 0.95, 0.2, 'sine');
        V.pluck(CH[ch][b % 3] + 12, b * bar, 0.07, 2.6);
        V.pluck(CH[ch][2] + 12, b * bar + 2 * beat, 0.05, 2.6);
      } },
    { id: 'pulse', name: 'Pulse', note: 'soft electronic beat', bpm: 110, prog: ['Am', 'F', 'C', 'G'],
      play(V, beat, bar, b, ch, root) {
        const t0 = b * bar;
        V.pad(CH[ch], t0, bar, 0.03);
        for (let k = 0; k < 4; k++) { V.kick(t0 + k * beat, 0.5); V.hat(t0 + k * beat + beat / 2, 0.1); }
        for (let k = 0; k < 8; k++) V.bass(root + (k % 2 ? 12 : 0), t0 + k * beat / 2, beat * 0.4, 0.17);
        const arp = [0, 1, 2, 1];
        for (let k = 0; k < 16; k++) V.pluck(CH[ch][arp[k % 4]] + 12, t0 + k * beat / 4, 0.03, 0.28);
      } },
    { id: 'bright', name: 'Bright', note: 'upbeat pop beat', bpm: 124, prog: ['C', 'G', 'Am', 'F'],
      play(V, beat, bar, b, ch, root) {
        const t0 = b * bar;
        for (let k = 0; k < 4; k++) {
          V.kick(t0 + k * beat, 0.55);
          if (k % 2) V.clap(t0 + k * beat, 0.22);
          V.hat(t0 + k * beat, 0.05); V.hat(t0 + k * beat + beat / 2, 0.1);
          for (const n of CH[ch]) V.pluck(n + 12, t0 + k * beat + beat / 2, 0.035, 0.3);
        }
        for (let k = 0; k < 8; k++) V.bass(root, t0 + k * beat / 2, beat * 0.38, 0.2);
      } },
    { id: 'keys', name: 'Keys', note: 'gentle piano-like arpeggio', bpm: 90, prog: ['Am', 'F', 'C', 'G'],
      play(V, beat, bar, b, ch, root) {
        const t0 = b * bar, c = CH[ch];
        const run = [c[0], c[1], c[2], c[0] + 12, c[2], c[1], c[2], c[0] + 12];
        run.forEach((n, k) => V.pluck(n, t0 + k * beat / 2, k % 4 ? 0.07 : 0.1, 1.8));
        V.bass(root + 12, t0, bar * 0.95, 0.09, 'sine');
        V.pad(c, t0, bar, 0.015);
      } },
  ];
  const trackCache = {};
  // One loop of a track as an AudioBuffer, rendered once per page.
  function renderTrack(id) {
    if (trackCache[id]) return trackCache[id];
    const T = TRACKS.find((x) => x.id === id);
    if (!T) return Promise.reject(new Error('No such track.'));
    const OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    if (!OAC) return Promise.reject(new Error('This browser cannot make music here.'));
    const rate = 44100, beat = 60 / T.bpm, bar = beat * 4, loop = bar * BARS, tail = 3;
    const ctx = new OAC(2, Math.round(rate * (loop + tail)), rate);
    const V = makeVoices(ctx);
    for (let b = 0; b < BARS; b++) { const ch = T.prog[b % T.prog.length]; T.play(V, beat, bar, b, ch, ROOT[ch]); }
    trackCache[id] = ctx.startRendering().then((full) => {
      // Fold the tail past the loop's end back onto its start, so the reverb
      // and the last notes ring into the next time round instead of cutting.
      const n = Math.round(rate * loop), out = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: rate });
      let peak = 0, energy = 0;
      const chans = [0, 1].map((c) => {
        const src = full.getChannelData(c), d = new Float32Array(n);
        for (let i = 0; i < n; i++) d[i] = src[i] + (i + n < src.length ? src[i + n] : 0);
        for (let i = 0; i < n; i++) { peak = Math.max(peak, Math.abs(d[i])); energy += d[i] * d[i]; }
        return d;
      });
      // Levelled by loudness (the average), so moving between tracks does not
      // jump in volume; drums set a track's peak without making it louder.
      // The peak stays under 0.95 whatever that asks for.
      const rms = Math.sqrt(energy / (2 * n));
      const k = peak > 0 && rms > 0 ? Math.min(0.95 / peak, 0.19 / rms) : 1;
      chans.forEach((d, c) => { for (let i = 0; i < n; i++) d[i] *= k; out.copyToChannel(d, c); });
      return out;
    });
    trackCache[id].catch(() => { delete trackCache[id]; });
    return trackCache[id];
  }

  // ---- recording, shared by the Reel, Video from cards and Video from images
  // H.264 MP4 where the browser offers it (Chrome does), which is what
  // Instagram takes; WebM otherwise, and the caller says so. With music the
  // audio is AAC inside the same MP4 (2026-10-20: Chrome 155 offers it).
  function mime(withAudio) {
    if (typeof MediaRecorder === 'undefined') return '';
    const list = withAudio
      ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm']
      : ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    for (const m of list) if (MediaRecorder.isTypeSupported(m)) return m;
    return '';
  }
  // MUSIC (2026-10-20, the owner: "Just add option for music"; no sound
  // effects). A file the admin picks, decoded in the browser and never sent
  // anywhere. It plays from `offset` seconds into the track, looping if the
  // track is shorter than the video, faded in over 0.4s and out over the last
  // two seconds, at `volume` (0 to 1). It is heard while playing as well as
  // recorded, so Play is a true preview.
  const MUSIC_FADE_IN = 0.4, MUSIC_FADE_OUT = 2;
  async function loadMusic(file) {
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) throw new Error('This browser cannot play audio here.');
    const ctx = new AC();
    try { return await ctx.decodeAudioData(await file.arrayBuffer()); }
    finally { ctx.close && ctx.close(); }
  }
  // Play `paintAt(t)` on the canvas in real time for `ms` milliseconds, and
  // when `record` is set return the recording as { blob, ext }. Real time,
  // because MediaRecorder records what the canvas shows as it shows it: a
  // background tab throttles the frames, so the tab has to stay in front.
  // `music`: { buffer (an AudioBuffer from loadMusic), volume, offset } or null.
  async function run(cv, ms, paintAt, record, music) {
    // A made track may still be rendering: wait for it here.
    if (music && music.ready && !music.buffer) music = Object.assign({}, music, { buffer: await music.ready });
    const type = record ? mime(!!music) : '';
    if (record && !type) throw new Error('This browser cannot record video. Use Chrome.');
    let rec = null, actx = null, src = null; const chunks = [];
    const lead = 0.06;
    paintAt(0);
    let stream = record ? cv.captureStream(30) : null;
    if (music && music.buffer) {
      actx = new (global.AudioContext || global.webkitAudioContext)();
      if (actx.state === 'suspended') await actx.resume().catch(() => {});
      src = actx.createBufferSource();
      src.buffer = music.buffer;
      const dur = music.buffer.duration;
      const off = music.offset > 0 && music.offset < dur - 1 ? music.offset : 0;
      src.loop = dur < ms / 1000 + off;
      if (src.loop) { src.loopStart = off; src.loopEnd = dur; }
      const gain = actx.createGain();
      const vol = Math.max(0, Math.min(1, music.volume == null ? 0.8 : music.volume));
      const t0a = actx.currentTime + lead, end = t0a + ms / 1000;
      gain.gain.setValueAtTime(0, t0a);
      gain.gain.linearRampToValueAtTime(vol, t0a + MUSIC_FADE_IN);
      gain.gain.setValueAtTime(vol, Math.max(t0a + MUSIC_FADE_IN, end - MUSIC_FADE_OUT));
      gain.gain.linearRampToValueAtTime(0, end);
      src.connect(gain);
      gain.connect(actx.destination);
      if (stream) {
        const dest = actx.createMediaStreamDestination();
        gain.connect(dest);
        stream = new MediaStream([...stream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
      }
      src.start(t0a, off);
      src.stop(end + 0.3);
    }
    if (record) {
      rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 10e6, audioBitsPerSecond: 192e3 });
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.start(250);
    }
    try {
      await new Promise((resolve) => {
        // The picture's clock starts when the music does.
        const t0 = performance.now() + (actx ? lead * 1000 : 0);
        const step = (now) => {
          const t = Math.max(0, now - t0);
          paintAt(t);
          if (t < ms + 400) requestAnimationFrame(step); else resolve();
        };
        requestAnimationFrame(step);
      });
      if (!rec) return null;
      await new Promise((resolve) => { rec.onstop = resolve; rec.stop(); });
    } finally {
      if (src) try { src.stop(); } catch (e) { /* already stopped */ }
      if (actx) actx.close().catch(() => {});
    }
    const base = type.split(';')[0];
    return { blob: new Blob(chunks, { type: base }), ext: base === 'video/mp4' ? 'mp4' : 'webm' };
  }
  // The music control, one implementation for the three hosts: a list (no
  // music, the four tracks made here, or your own file), Listen, volume, and
  // for your own file where in the track to start. Returns { get() } giving
  // run()'s `music` argument, or null for none. A made track may still be
  // rendering when Play is pressed: `ready` is its promise and run() waits.
  function musicPicker(host, onChange) {
    const VOLS = [[1, '100%'], [0.8, '80%'], [0.6, '60%'], [0.4, '40%'], [0.25, '25%']];
    const STARTS = [0, 5, 10, 15, 20, 30, 45, 60, 90];
    const col = 'display:flex;flex-direction:column;gap:4px;font-size:12.5px;color:var(--muted)';
    host.innerHTML = '<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">'
      + '<span style="' + col + '">Track<select data-m="src" aria-label="Music">'
      + '<option value="">No music</option>'
      + TRACKS.map((t) => '<option value="' + t.id + '">' + t.name + ' — ' + t.note + '</option>').join('')
      + '<option value="file">Your own file…</option></select></span>'
      + '<button class="btn" type="button" data-m="listen" hidden>Listen</button></div>'
      + '<div data-m="own" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px" hidden>'
      + '<button class="btn" type="button" data-m="pick">Choose a file</button>'
      + '<span data-m="name" style="font-size:12.5px;color:var(--muted);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px">No file chosen</span>'
      + '<input type="file" data-m="file" accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/ogg" hidden></div>'
      + '<div data-m="opts" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px" hidden>'
      + '<span style="' + col + '">Volume<select data-m="vol" aria-label="Music volume">'
      + VOLS.map(([v, l]) => '<option value="' + v + '"' + (v === 0.8 ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></span>'
      + '<span data-m="offw" style="' + col + '" hidden>Start the track at<select data-m="off" aria-label="Start the track at">'
      + STARTS.map((s) => '<option value="' + s + '">' + (s ? s + ' seconds' : 'the beginning') + '</option>').join('') + '</select></span></div>';
    const $m = (k) => host.querySelector('[data-m="' + k + '"]');
    let fileBuf = null, listening = null;
    const src = () => $m('src').value;
    const stopListen = () => {
      if (!listening) return;
      try { listening.src.stop(); } catch (e) { /* already stopped */ }
      listening.ctx.close().catch(() => {});
      listening = null;
      $m('listen').textContent = 'Listen';
    };
    const paint = () => {
      const s = src();
      $m('own').hidden = s !== 'file';
      $m('opts').hidden = !s || (s === 'file' && !fileBuf);
      $m('offw').hidden = s !== 'file';
      $m('listen').hidden = !s || (s === 'file' && !fileBuf);
    };
    // A made track starts rendering the moment it is picked, so Play rarely waits.
    $m('src').addEventListener('change', () => {
      stopListen();
      if (TRACKS.some((t) => t.id === src())) renderTrack(src()).catch(() => {});
      paint();
      if (onChange) onChange();
    });
    $m('pick').addEventListener('click', () => $m('file').click());
    $m('file').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      stopListen();
      $m('name').textContent = 'Reading ' + f.name + '…'; $m('name').style.color = 'var(--muted)';
      try {
        fileBuf = await loadMusic(f);
        $m('name').textContent = f.name + ' · ' + Math.round(fileBuf.duration) + ' s';
      } catch (err) {
        fileBuf = null;
        $m('name').textContent = 'Could not read that file as audio'; $m('name').style.color = 'var(--amber)';
      }
      paint();
      if (onChange) onChange();
    });
    // Listen: the chosen music alone, ten seconds at the chosen volume.
    $m('listen').addEventListener('click', async () => {
      if (listening) { stopListen(); return; }
      const s = src();
      const buf = s === 'file' ? fileBuf : await renderTrack(s).catch(() => null);
      if (!buf) return;
      const ctx = new (global.AudioContext || global.webkitAudioContext)();
      const node = ctx.createBufferSource(); node.buffer = buf; node.loop = true;
      const g = ctx.createGain(), vol = Number($m('vol').value), t = ctx.currentTime;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.3);
      g.gain.setValueAtTime(vol, t + 9); g.gain.linearRampToValueAtTime(0, t + 10);
      node.connect(g); g.connect(ctx.destination);
      const off = s === 'file' ? Number($m('off').value) : 0;
      node.start(t, off < buf.duration - 1 ? off : 0); node.stop(t + 10.1);
      listening = { ctx, src: node };
      node.onended = () => { if (listening && listening.src === node) stopListen(); };
      $m('listen').textContent = 'Stop';
    });
    paint();
    return {
      get() {
        const s = src(), volume = Number($m('vol').value);
        stopListen();
        if (!s) return null;
        if (s === 'file') return fileBuf ? { buffer: fileBuf, volume, offset: Number($m('off').value) } : null;
        return { ready: renderTrack(s), volume, offset: 0 };
      },
    };
  }

  global.Reel = { W, H, DURATION, SCENES, paint, countUp,
    SHAPES, TRANS_MS, END_MS, composeImage, slidesDuration, paintSlides, customInk, mime, run,
    loadMusic, musicPicker, TRACKS, renderTrack,
    cardParts, cardSchedule, cardSlide };
})(typeof window !== 'undefined' ? window : globalThis);
