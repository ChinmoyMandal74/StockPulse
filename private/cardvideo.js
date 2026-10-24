// THE CARD VIDEOS (2026-10-23, admin only): promo cards as 9:16 videos for
// Instagram Reels and YouTube Shorts. The owner, after the Earnings track
// record video: "suggest some such similar videos based on existing cards in
// promo", then "Lets do all except 1": the Guidance summary (market, sector,
// industry, theme), Month by month (market, sector, theme and one stock),
// Evolution, Who added and who cut, Insider activity, Drawdowns, the Signal
// mix and Article tone for one stock.
//
// THE MODEL IS THE CARD'S OWN. Cards.videoFrame(tpl, ctx) builds the card and
// hands back the figures it drew, already worded (the vidCap hook in each
// template), so a video and its card cannot disagree and this file does no
// arithmetic on the data: it lays out and eases.
//
// paint(g, M, t) is a PURE function of the time and the model, as the Reel's
// is: any frame can be drawn in any order. The ground, glyph, end card and
// recorder are reel.js's (Reel.kit, Reel.endCard, Reel.run).
//
// THE SAFE AREA, as the Reel's: everything to be read sits inside x 64..940
// and y 250..1560; the platforms lay their own interface over the rest.
//
// THE WORDS: what was filed, reported or measured; never buy, sell or hold,
// never a ranking by how much, never a forecast. Green and red only for price
// moves (Month by month, Drawdowns, a market value), and the guidance labels'
// own colours by the owner's exception.
(function (global) {
  'use strict';
  const K = global.Reel && global.Reel.kit;
  const W = 1080, H = 1920;
  const L = 64, R = 940, CW = R - L;
  const SANS = 'Geist, "Geist Fallback", system-ui, sans-serif';
  const MONO = '"Geist Mono", ui-monospace, monospace';
  const FADE_IN = 380, FADE_OUT = 300, END_MS = 3400;
  const { clamp, prog, easeOut, easeInOut, font, fitFont, wrap, rrect, glyph, countUp } = K || {};

  // ---- shared pieces ----------------------------------------------------------
  function brand(g, M, chip) {
    const I = M.ink;
    glyph(g, L, 252, 44, I.accent, 3);
    font(g, 700, 30, SANS); g.fillStyle = I.text; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('Tickr Lab', L + 56, 275);
    if (chip) {
      font(g, 500, 22, MONO);
      let txt = chip; while (g.measureText(txt).width > 520 && txt.length > 4) txt = txt.slice(0, -2) + '…';
      const w = g.measureText(txt).width + 36;
      g.strokeStyle = I.grid; g.lineWidth = 2; rrect(g, R - w, 255, w, 42, 21); g.stroke();
      g.fillStyle = I.axis; g.textAlign = 'center'; g.fillText(txt, R - w / 2, 277);
    }
    g.textAlign = 'left';
  }
  function disclaimer(g, M) {
    g.globalAlpha = 0.85; font(g, 500, 22, MONO); g.fillStyle = M.ink.axis; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText('Mechanical readings — not investment advice', L, 1548);
    g.globalAlpha = 1;
  }
  function label(g, M, text, y, a) {
    g.globalAlpha = a; font(g, 600, 26, MONO); g.fillStyle = M.ink.accent; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    let s = String(text || '').toUpperCase(); while (g.measureText(s).width > CW && s.length > 4) s = s.slice(0, -2) + '…';
    g.fillText(s, L, y); g.globalAlpha = 1;
  }
  // Text cut to a width with an ellipsis, in the current font.
  function fit(g, text, width) { let s = String(text == null ? '' : text); if (g.measureText(s).width <= width) return s; while (s.length > 2 && g.measureText(s + '…').width > width) s = s.slice(0, -1); return s.trimEnd() + '…'; }
  // Wrapped to at most `max` lines; a cut block ends with an ellipsis, never mid-word silently.
  function lines(g, text, width, max) {
    const all = wrap(g, text, width);
    if (all.length <= max) return all;
    const out = all.slice(0, max);
    out[max - 1] = fit(g, out[max - 1] + ' ' + all[max], width - 1);
    if (!/…$/.test(out[max - 1])) out[max - 1] = fit(g, out[max - 1] + '…', width);
    return out;
  }
  // The opening every video shares: a kicker, the name in two lines at most, a line under it.
  function opener(g, M, t, A, kick, title, sub) {
    const I = M.ink;
    label(g, M, kick, 520, A * easeOut(prog(t, 0, 400)));
    const p = easeOut(prog(t, 150, 600));
    g.globalAlpha = A * p; fitFont(g, title, 800, 96, 56, SANS, CW); g.fillStyle = I.text; g.textBaseline = 'alphabetic';
    const tl = lines(g, title, CW, 2);
    tl.forEach((ln, i) => g.fillText(ln, L, 640 + i * 104 + (1 - p) * 30));
    if (sub) {
      const p2 = easeOut(prog(t, 700, 600));
      g.globalAlpha = A * p2; font(g, 600, 44, SANS); g.fillStyle = I.dim;
      lines(g, sub, CW, 3).forEach((ln, i) => g.fillText(ln, L, 640 + tl.length * 104 + 40 + i * 58));
    }
    g.globalAlpha = 1;
  }
  // A colour that may be missing: the axis ink, faint.
  const solid = (c) => !!c && !/color-mix|var\(/.test(c);
  function fillOr(g, I, c, a, A) { if (solid(c)) { g.fillStyle = c; g.globalAlpha = A * a; } else { g.fillStyle = I.axis; g.globalAlpha = A * a * 0.35; } }
  // A pill: text on a filled colour.
  function pill(g, x, y, text, color, A) {
    font(g, 700, 26, SANS); const w = g.measureText(text).width + 34;
    g.globalAlpha = A; g.fillStyle = color || '#475569'; rrect(g, x, y - 32, w, 44, 22); g.fill();
    g.fillStyle = '#ffffff'; g.textBaseline = 'middle'; g.fillText(text, x + 17, y - 10); g.textBaseline = 'alphabetic';
    return w;
  }

  // ---- 1. the Guidance summary ------------------------------------------------------
  const GD = {
    scenes: [['open', 3400], ['bar', 6000], ['rows', 6800], ['names', 5200]],
    chip: (M) => M.kick,
    open(g, M, t, A) { opener(g, M, t, A, M.kick, M.title, M.sub); },
    bar(g, M, t, A) {
      const I = M.ink;
      label(g, M, 'What the companies said', 450, A * easeOut(prog(t, 0, 400)));
      font(g, 800, 120, SANS); g.globalAlpha = A; g.fillStyle = I.text; g.textBaseline = 'alphabetic';
      g.fillText(countUp(String(M.gave), easeOut(prog(t, 200, 1200))), L, 600);
      font(g, 600, 38, SANS); g.fillStyle = I.dim; g.fillText('of ' + M.n + ' reported gave guidance', L, 660);
      const total = M.counts.reduce((a, c) => a + c.n, 0) || 1, k = easeInOut(prog(t, 900, 2400));
      let x = L; const y = 730, h = 70;
      g.globalAlpha = A * 0.5; g.fillStyle = I.grid; rrect(g, L, y, CW, h, 14); g.fill();
      g.save(); rrect(g, L, y, CW * k, h, 14); g.clip();
      for (const c of M.counts) { const w = CW * c.n / total; fillOr(g, I, c.color, 1, A); g.fillRect(x, y, w - 3, h); x += w; }
      g.restore();
      M.counts.forEach((c, i) => {
        const p = easeOut(prog(t, 1400 + i * 260, 400)); if (p <= 0) return;
        const yy = 900 + i * 76;
        fillOr(g, I, c.color, p, A); rrect(g, L, yy - 30, 34, 34, 8); g.fill();
        g.globalAlpha = A * p; font(g, 600, 38, SANS); g.fillStyle = I.text; g.fillText(c.word, L + 56, yy);
        font(g, 700, 38, MONO); g.textAlign = 'right'; g.fillText(countUp(String(c.n), p), R, yy); g.textAlign = 'left';
      });
      g.globalAlpha = 1;
    },
    rows(g, M, t, A) {
      const I = M.ink;
      if (M.groups && M.groups.length) {
        label(g, M, 'By ' + M.groupWord, 450, A * easeOut(prog(t, 0, 400)));
        font(g, 500, 26, MONO); g.globalAlpha = A * 0.9; g.fillStyle = I.axis;
        g.textAlign = 'right'; g.fillText('raised · reaffirmed · lowered', R, 450); g.textAlign = 'left';
        M.groups.forEach((r, i) => {
          const p = easeOut(prog(t, 300 + i * 220, 450)); if (p <= 0) return;
          const y = 540 + i * 112;
          g.globalAlpha = A * p; font(g, 600, 34, SANS); g.fillStyle = I.text; g.textBaseline = 'alphabetic';
          g.fillText(fit(g, r.k, 520), L + (1 - p) * 30, y);
          font(g, 500, 26, MONO); g.fillStyle = I.dim; g.fillText(r.gave + ' of ' + r.n + ' gave guidance', L, y + 38);
          const parts = [[r.raised, M.raisedColor], [r.reaffirmed, '#475569'], [r.lowered, M.loweredColor]];
          let x = R;
          for (let j = parts.length - 1; j >= 0; j--) {
            const [n, c] = parts[j];
            font(g, 800, 40, MONO); const s = String(n); const w = Math.max(64, g.measureText(s).width + 26);
            x -= w;
            g.globalAlpha = A * p * (n ? 1 : 0.35); g.fillStyle = n ? c || I.axis : I.grid; rrect(g, x, y - 36, w - 10, 54, 12); g.fill();
            g.fillStyle = n ? '#ffffff' : I.axis; g.textAlign = 'center'; g.fillText(s, x + (w - 10) / 2, y + 4); g.textAlign = 'left';
          }
        });
      } else {
        label(g, M, 'Company by company, largest first', 450, A * easeOut(prog(t, 0, 400)));
        (M.cos || []).slice(0, 9).forEach((c, i) => {
          const p = easeOut(prog(t, 300 + i * 260, 450)); if (p <= 0) return;
          const y = 560 + i * 104;
          g.globalAlpha = A * p; font(g, 700, 36, MONO); g.fillStyle = I.text; g.textBaseline = 'alphabetic'; g.fillText(c.sym, L, y);
          font(g, 500, 26, SANS); g.fillStyle = I.dim; g.fillText(fit(g, c.name, 380), L, y + 36);
          if (c.color) { font(g, 700, 26, SANS); const w = g.measureText(c.state).width + 34; pill(g, R - w, y + 4, c.state, c.color, A * p); }
          else { font(g, 500, 28, SANS); g.fillStyle = I.axis; g.textAlign = 'right'; g.fillText(c.state, R, y); g.textAlign = 'left'; }
        });
      }
      g.globalAlpha = 1;
    },
    names(g, M, t, A) {
      const I = M.ink;
      const block = (title, color, list, y0, t0) => {
        const p = easeOut(prog(t, t0, 400));
        g.globalAlpha = A * p; pill(g, L, y0, title, color, A * p);
        if (!list.length) { font(g, 500, 32, SANS); g.fillStyle = I.dim; g.globalAlpha = A * p; g.fillText('None so far', L, y0 + 70); return; }
        font(g, 700, 40, MONO); g.textBaseline = 'alphabetic';
        let x = L, y = y0 + 80;
        const shown = list.slice(0, 18), k = prog(t, t0 + 300, 1800) * shown.length;
        shown.forEach((s, i) => {
          const w = g.measureText(s).width + 34;
          if (x + w > R) { x = L; y += 62; }
          if (i < k) { g.globalAlpha = A * clamp(k - i, 0, 1); g.fillStyle = I.text; g.fillText(s, x, y); }
          x += w;
        });
        if (list.length > shown.length && k >= shown.length) { font(g, 500, 30, SANS); g.fillStyle = I.dim; g.globalAlpha = A; g.fillText('and ' + (list.length - shown.length) + ' more', L, y + 60); }
      };
      if (M.groups && M.groups.length) {
        label(g, M, 'Largest first', 450, A * easeOut(prog(t, 0, 400)));
        block('Raised', M.raisedColor, M.raised || [], 560, 200);
        block('Lowered', M.loweredColor, M.lowered || [], 1060, 1800);
      } else {
        label(g, M, M.qName + ' guidance', 450, A * easeOut(prog(t, 0, 400)));
        font(g, 800, 120, SANS); g.globalAlpha = A; g.fillStyle = I.text; g.fillText(M.gave + ' of ' + M.n, L, 640);
        font(g, 600, 40, SANS); g.fillStyle = I.dim; wrap(g, 'reported companies gave guidance, as of ' + M.asOf, CW).forEach((ln, i) => g.fillText(ln, L, 710 + i * 54));
      }
      g.globalAlpha = 1;
    },
  };

  // ---- 2. Month by month ----------------------------------------------------------------
  const MO = {
    scenes: [['open', 3000], ['grid', 11000], ['year', 3600]],
    chip: (M) => M.kick,
    open(g, M, t, A) { opener(g, M, t, A, 'Month by month', M.name, M.rel ? 'against the S&P 500, month by month' : 'month by month'); },
    grid(g, M, t, A) { MO.drawGrid(g, M, A, prog(t, 300, 9400)); },
    year(g, M, t, A) {
      const I = M.ink;
      MO.drawGrid(g, M, A * 0.35, 1);
      const yi = M.years.length - 1, v = M.yearTot[yi];
      const p = easeOut(prog(t, 100, 600));
      g.globalAlpha = A * p; label(g, M, String(M.years[yi]) + (M.lastYm && M.lastYm.slice(0, 4) === String(M.years[yi]) ? ' so far' : ''), 1180, A * p);
      if (v != null) {
        font(g, 800, 130, MONO); g.fillStyle = v > 0 ? I.up : v < 0 ? I.down : I.text; g.globalAlpha = A * p; g.textBaseline = 'alphabetic';
        g.fillText(countUp((v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%', easeOut(prog(t, 200, 1200))), L, 1330);
      }
      g.globalAlpha = 1;
    },
    // The grid fills in time order, oldest month first; k is 0..1 of the way.
    drawGrid(g, M, A, k) {
      const I = M.ink, ny = M.years.length;
      const yw = 96, tw = 118, cw = (CW - yw - tw) / 12, rh = 112, top = 520;
      g.textBaseline = 'middle';
      font(g, 500, 20, MONO); g.fillStyle = I.axis; g.globalAlpha = A;
      M.months.forEach((m, i) => { g.textAlign = 'center'; g.fillText(m.slice(0, 1), L + yw + i * cw + cw / 2, top - 30); });
      g.fillText('Year', R - tw / 2, top - 30);
      const cells = [];
      for (let y = 0; y < ny; y++) for (let i = 0; i < 12; i++) if (M.cells[y][i] != null) cells.push([y, i]);
      const shown = k * cells.length;
      let reached = null;
      cells.forEach(([y, i], n) => {
        const p = clamp(shown - n, 0, 1); if (p <= 0) return;
        reached = [y, i];
        const v = M.cells[y][i], x = L + yw + i * cw, yy = top + y * rh;
        const a = 0.18 + 0.62 * Math.min(Math.abs(v) / 10, 1);
        g.globalAlpha = A * p * a; g.fillStyle = v > 0 ? I.up : v < 0 ? I.down : I.flat; rrect(g, x + 2, yy + 2, cw - 4, rh - 4, 6); g.fill();
        g.globalAlpha = A * p; font(g, 600, 17, MONO); g.fillStyle = I.text; g.textAlign = 'center';
        g.fillText((v > 0 ? '+' : v < 0 ? '−' : '') + (Math.abs(v) >= 10 ? Math.round(Math.abs(v)) : Math.abs(v).toFixed(1)), x + cw / 2, yy + rh / 2);
      });
      for (let y = 0; y < ny; y++) {
        const yy = top + y * rh;
        g.globalAlpha = A; font(g, 600, 26, MONO); g.fillStyle = I.dim; g.textAlign = 'left'; g.fillText(String(M.years[y]), L, yy + rh / 2);
        // A year's total once its last month on file is in.
        const lastIdx = cells.reduce((m, [yy2], n) => (yy2 === y ? n : m), -1);
        const v = M.yearTot[y];
        if (v != null && lastIdx >= 0 && shown >= lastIdx + 1) {
          g.globalAlpha = A; font(g, 700, 24, MONO); g.fillStyle = v > 0 ? I.up : v < 0 ? I.down : I.text; g.textAlign = 'right';
          g.fillText((v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%', R, yy + rh / 2);
        }
      }
      if (reached && k < 1) {
        const [y, i] = reached;
        g.globalAlpha = A; font(g, 800, 110, MONO); g.fillStyle = I.text; g.textAlign = 'right'; g.textBaseline = 'alphabetic';
        g.fillText(M.months[i] + ' ' + M.years[y], R, top + ny * rh + 170);
      }
      g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.globalAlpha = 1;
    },
  };

  // ---- 3. Evolution ----------------------------------------------------------------------
  function line(g, vals, x0, y0, w, h, k, color, A) {
    const pts = vals.map((v, i) => [i, v]).filter((p) => p[1] != null);
    if (pts.length < 2) return null;
    let lo = Infinity, hi = -Infinity; for (const [, v] of pts) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (lo > 0) lo = 0; const pad = (hi - lo) * 0.06 || 1; hi += pad;
    const X = (i) => x0 + (i / (vals.length - 1)) * w, Y = (v) => y0 + h - ((v - lo) / (hi - lo)) * h;
    const n = Math.max(2, Math.round(pts.length * k));
    g.globalAlpha = A; g.strokeStyle = color; g.lineWidth = 6; g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath(); pts.slice(0, n).forEach(([i, v], j) => (j ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)))); g.stroke();
    const [li, lv] = pts[n - 1];
    g.fillStyle = color; g.beginPath(); g.arc(X(li), Y(lv), 11, 0, Math.PI * 2); g.fill();
    return [X(li), Y(lv)];
  }
  const EV = {
    scenes: [['open', 3200], ['biz', 5600], ['value', 5600], ['figs', 5400]],
    chip: (M) => M.from + ' to ' + M.to,
    open(g, M, t, A) { opener(g, M, t, A, M.kick, M.name, 'What the business did, and what the market paid for it'); },
    biz(g, M, t, A) {
      const I = M.ink, c = '#60a5fa';
      label(g, M, M.mLabel + ', trailing twelve months', 450, A * easeOut(prog(t, 0, 400)));
      line(g, M.series, L, 560, CW, 620, easeInOut(prog(t, 300, 3800)), c, A);
      const p = easeOut(prog(t, 3600, 600));
      g.globalAlpha = A * p; font(g, 800, 92, MONO); g.fillStyle = I.text; g.fillText(M.measureNow, L, 1330);
      font(g, 500, 32, SANS); g.fillStyle = I.dim; g.fillText('latest twelve months filed', L, 1385);
      g.globalAlpha = 1;
    },
    value(g, M, t, A) {
      const I = M.ink, c = '#a78bfa';
      label(g, M, 'Market value', 450, A * easeOut(prog(t, 0, 400)));
      line(g, M.caps, L, 560, CW, 620, easeInOut(prog(t, 300, 3800)), c, A);
      const p = easeOut(prog(t, 3600, 600));
      g.globalAlpha = A * p; font(g, 800, 92, MONO); g.fillStyle = I.text; g.fillText(M.capNow, L, 1330);
      font(g, 500, 32, SANS); g.fillStyle = I.dim; g.fillText('at the latest price', L, 1385);
      g.globalAlpha = 1;
    },
    figs(g, M, t, A) {
      const I = M.ink;
      label(g, M, M.from + ' → ' + M.to, 450, A * easeOut(prog(t, 0, 400)));
      M.figures.forEach((f, i) => {
        const p = easeOut(prog(t, 250 + i * 550, 500)); if (p <= 0) return;
        const y = 580 + i * 220;
        g.globalAlpha = A * p; font(g, 500, 34, SANS); g.fillStyle = I.dim; g.textBaseline = 'alphabetic'; g.fillText(f.label, L + (1 - p) * 30, y);
        fitFont(g, f.from + '  →  ' + f.to, 800, 60, 36, MONO, CW); g.fillStyle = I.text; g.fillText(f.from + '  →  ' + f.to, L + (1 - p) * 30, y + 76);
        font(g, 600, 32, MONO); g.fillStyle = f.dir === 'pos' ? I.up : f.dir === 'neg' ? I.down : I.dim; g.fillText(f.change, L, y + 126);
      });
      g.globalAlpha = 1;
    },
  };

  // ---- 4. Who added, who cut ---------------------------------------------------------------
  const IF = {
    scenes: [['open', 3200], ['bars', 6000], ['figs', 4200], ['lists', 6200]],
    chip: (M) => '13F managers · ' + M.span,
    open(g, M, t, A) { opener(g, M, t, A, M.sym + ' · 13F managers', M.name, 'who added, who cut'); },
    bars(g, M, t, A) {
      const I = M.ink, qs = M.quarters;
      label(g, M, 'Shares held by managers, quarter by quarter', 450, A * easeOut(prog(t, 0, 400)));
      if (qs.length < 2) return;
      const n = qs.length, gap = 14, bw = (CW - gap * (n - 1)) / n, mid = 900, room = 330;
      const max = Math.max(1, ...qs.map((q) => Math.abs(q.change)));
      g.globalAlpha = A; g.strokeStyle = I.axis; g.lineWidth = 2; g.beginPath(); g.moveTo(L, mid); g.lineTo(R, mid); g.stroke();
      qs.forEach((q, i) => {
        const p = easeOut(prog(t, 400 + i * 260, 600)); if (p <= 0) return;
        const x = L + i * (bw + gap), h = Math.max(4, Math.abs(q.change) / max * room) * p;
        g.globalAlpha = A * 0.9; g.fillStyle = q.change >= 0 ? M.up : M.dn;
        rrect(g, x, q.change >= 0 ? mid - h : mid, bw, h, 6); g.fill();
        g.globalAlpha = A * p; font(g, 600, 24, MONO); g.fillStyle = I.text; g.textAlign = 'center';
        g.fillText(q.text, x + bw / 2, q.change >= 0 ? mid - h - 16 : mid + h + 34);
        font(g, 500, 22, MONO); g.fillStyle = I.axis; g.fillText(q.q, x + bw / 2, mid + room + 90);
      });
      g.textAlign = 'left'; g.globalAlpha = 1;
    },
    figs(g, M, t, A) {
      const I = M.ink;
      label(g, M, 'Institutional holders', 450, A * easeOut(prog(t, 0, 400)));
      [['Managers holding', M.managers], ['Shares held, ' + M.span, M.held], ['Last quarter', M.lastQ], ['Worth', M.worth]].forEach(([k, v], i) => {
        const p = easeOut(prog(t, 250 + i * 450, 500)); if (p <= 0) return;
        const y = 580 + i * 200;
        g.globalAlpha = A * p; font(g, 500, 34, SANS); g.fillStyle = I.dim; g.fillText(k, L + (1 - p) * 30, y);
        font(g, 800, 76, MONO); g.fillStyle = I.text; g.fillText(v, L + (1 - p) * 30, y + 88);
      });
      g.globalAlpha = 1;
    },
    lists(g, M, t, A) {
      const I = M.ink;
      const col = (title, list, y0, t0, color) => {
        label(g, M, title, y0, A * easeOut(prog(t, t0, 400)));
        if (!list.length) { font(g, 500, 30, SANS); g.globalAlpha = A; g.fillStyle = I.dim; g.fillText('None on the quarter', L, y0 + 60); return; }
        list.forEach((m, i) => {
          const p = easeOut(prog(t, t0 + 200 + i * 220, 450)); if (p <= 0) return;
          const y = y0 + 70 + i * 74;
          g.globalAlpha = A * p; g.fillStyle = color; rrect(g, L, y - 30, 8, 38, 4); g.fill();
          font(g, 600, 30, SANS); g.fillStyle = I.text; g.fillText(fit(g, m.name + (m.tag ? ' (' + m.tag + ')' : ''), 600), L + 24 + (1 - p) * 30, y);
          font(g, 700, 30, MONO); g.textAlign = 'right'; g.fillText(m.v, R, y); g.textAlign = 'left';
        });
      };
      col('Added the most, ' + M.quarter, M.buyers, 450, 0, M.up);
      col('Cut the most', M.sellers, 960, 1300, M.dn);
      g.globalAlpha = 1;
    },
  };

  // ---- 5. Insider activity -------------------------------------------------------------------
  const IN = {
    scenes: [['open', 3200], ['figs', 5000], ['people', 7600]],
    chip: (M) => M.sym + ' · last ' + M.span,
    open(g, M, t, A) { opener(g, M, t, A, M.sym + ' · last ' + M.span, M.name, 'what its insiders did'); },
    figs(g, M, t, A) {
      const I = M.ink;
      label(g, M, 'Open-market trades, last ' + M.span, 450, A * easeOut(prog(t, 0, 400)));
      const rows = [['Bought', M.bought, M.boughtN ? M.boughtP + (M.boughtP === 1 ? ' person, ' : ' people, ') + M.boughtN + (M.boughtN === 1 ? ' trade' : ' trades') : 'no purchases', M.a],
        ['Sold', M.sold, M.soldN ? M.soldP + (M.soldP === 1 ? ' person, ' : ' people, ') + M.soldN + (M.soldN === 1 ? ' trade' : ' trades') : 'no sales', M.bc],
        ['Net', M.net, M.netWord, I.dim]].concat(M.planned ? [['Sold under a plan', M.planned, 'of the dollars sold', I.dim]] : []);
      rows.forEach(([k, v, x, c], i) => {
        const p = easeOut(prog(t, 250 + i * 500, 500)); if (p <= 0) return;
        const y = 580 + i * 210;
        g.globalAlpha = A * p; g.fillStyle = c; rrect(g, L, y - 34, 10, 140, 5); g.fill();
        font(g, 500, 34, SANS); g.fillStyle = I.dim; g.fillText(k, L + 32, y);
        font(g, 800, 72, MONO); g.fillStyle = I.text; g.fillText(v, L + 32, y + 80);
        font(g, 500, 28, SANS); g.fillStyle = I.dim; g.fillText(x, L + 32, y + 124);
      });
      g.globalAlpha = 1;
    },
    people(g, M, t, A) {
      const I = M.ink;
      label(g, M, 'Who traded', 450, A * easeOut(prog(t, 0, 400)));
      font(g, 600, 24, MONO); g.globalAlpha = A; g.fillStyle = M.a; g.textAlign = 'right'; g.fillText('BOUGHT', R - 200, 450); g.fillStyle = M.bc; g.fillText('SOLD', R, 450); g.textAlign = 'left';
      M.people.forEach((p0, i) => {
        const p = easeOut(prog(t, 300 + i * 450, 500)); if (p <= 0) return;
        const y = 560 + i * 132;
        g.globalAlpha = A * p; font(g, 600, 32, SANS); g.fillStyle = I.text; g.fillText(fit(g, p0.name, 560), L, y);
        if (p0.role) { font(g, 500, 22, SANS); g.fillStyle = I.dim; g.fillText(fit(g, p0.role, 560), L, y + 32); }
        const k = easeOut(prog(t, 500 + i * 450, 900)), bw = 560;
        g.globalAlpha = A * p * 0.25; g.fillStyle = I.grid; rrect(g, L, y + 48, bw, 22, 6); g.fill();
        if (p0.b > 0) { g.globalAlpha = A * p; g.fillStyle = M.a; rrect(g, L, y + 48, Math.max(6, bw * p0.b * k), 10, 4); g.fill(); }
        if (p0.s > 0) { g.globalAlpha = A * p; g.fillStyle = M.bc; rrect(g, L, y + 60, Math.max(6, bw * p0.s * k), 10, 4); g.fill(); }
        g.globalAlpha = A * p; font(g, 600, 26, MONO); g.textAlign = 'right';
        g.fillStyle = M.a; g.fillText(p0.bt || '—', R - 200, y + 20); g.fillStyle = M.bc; g.fillText(p0.st || '—', R, y + 20); g.textAlign = 'left';
      });
      g.globalAlpha = 1;
    },
  };

  // ---- 6. Drawdowns -----------------------------------------------------------------------------
  const DD = {
    scenes: [['open', 3200], ['chart', 8200], ['falls', 5400], ['now', 3200]],
    chip: (M) => M.from + ' to ' + M.to,
    open(g, M, t, A) { opener(g, M, t, A, M.sym + ' · ' + M.from + ' to ' + M.to, M.name, 'below its own high'); },
    drawChart(g, M, A, k, marks) {
      const I = M.ink, u = M.under, n = u.length;
      const x0 = L, y0 = 540, w = CW, h = 640, lo = Math.min(-1, M.worst * 1.08);
      const X = (i) => x0 + (i / (n - 1)) * w, Y = (v) => y0 + (v / lo) * h;
      g.globalAlpha = A; g.strokeStyle = I.axis; g.lineWidth = 2; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + w, y0); g.stroke();
      font(g, 500, 22, MONO); g.fillStyle = I.axis; g.textAlign = 'left'; g.fillText('at its high', x0, y0 - 14);
      for (const lev of [-10, -20, -30, -40, -50, -60, -70, -80]) {
        if (lev < lo) break;
        g.globalAlpha = A * 0.35; g.strokeStyle = I.grid; g.beginPath(); g.moveTo(x0, Y(lev)); g.lineTo(x0 + w, Y(lev)); g.stroke();
        g.globalAlpha = A * 0.8; g.fillStyle = I.axis; g.textAlign = 'right'; g.fillText(lev + '%', x0 + w, Y(lev) - 8);
      }
      const m = Math.max(2, Math.round(n * k));
      g.globalAlpha = A * 0.55; g.fillStyle = I.down;
      g.beginPath(); g.moveTo(X(0), y0); for (let i = 0; i < m; i++) g.lineTo(X(i), Y(u[i])); g.lineTo(X(m - 1), y0); g.closePath(); g.fill();
      g.globalAlpha = A; g.strokeStyle = I.down; g.lineWidth = 3; g.beginPath(); for (let i = 0; i < m; i++) (i ? g.lineTo(X(i), Y(u[i])) : g.moveTo(X(i), Y(u[i]))); g.stroke();
      // The years along the foot, spaced so they never collide.
      let lastX = -999; g.fillStyle = I.axis; g.textAlign = 'center'; font(g, 500, 22, MONO);
      for (let i = 0; i < n; i++) { const yv = M.dates[i].slice(0, 4); if (i && yv === M.dates[i - 1].slice(0, 4)) continue; const x = X(i); if (x - lastX < 110) continue; lastX = x; g.globalAlpha = A * 0.9; g.fillText(yv, x, y0 + h + 60); }
      if (marks) M.episodes.forEach((e, j) => {
        if (e.ti >= m) return; const x = X(e.ti), y = Y(u[e.ti]);
        g.globalAlpha = A; g.fillStyle = I.text; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill();
        font(g, 700, 26, MONO); g.textAlign = x > x0 + w * 0.7 ? 'right' : 'left'; g.fillText((j + 1) + '', x + (g.textAlign === 'right' ? -16 : 16), y + 8);
      });
      g.textAlign = 'left'; g.globalAlpha = 1;
    },
    chart(g, M, t, A) {
      label(g, M, 'How far below its highest close', 450, A * easeOut(prog(t, 0, 400)));
      DD.drawChart(g, M, A, easeInOut(prog(t, 300, 6200)), prog(t, 6400, 300) > 0);
      const I = M.ink, p = easeOut(prog(t, 6600, 600));
      g.globalAlpha = A * p; font(g, 800, 76, MONO); g.fillStyle = I.down; g.fillText(M.worst.toFixed(1) + '%', L, 1390);
      font(g, 500, 32, SANS); g.fillStyle = I.dim; g.fillText('the deepest fall in the window', L, 1440);
      g.globalAlpha = 1;
    },
    falls(g, M, t, A) {
      const I = M.ink;
      label(g, M, 'The deepest falls', 450, A * easeOut(prog(t, 0, 400)));
      M.episodes.forEach((e, i) => {
        const p = easeOut(prog(t, 300 + i * 700, 500)); if (p <= 0) return;
        const y = 600 + i * 270;
        g.globalAlpha = A * p; font(g, 700, 30, MONO); g.fillStyle = I.dim; g.fillText((i + 1) + '', L, y);
        font(g, 800, 84, MONO); g.fillStyle = I.down; g.fillText(e.depth.toFixed(1) + '%', L + 50 + (1 - p) * 30, y + 8);
        font(g, 500, 30, SANS); g.fillStyle = I.text; g.fillText(e.peak + ' to ' + e.trough, L + 50, y + 62);
        g.fillStyle = I.dim; g.fillText(e.back == null ? 'not yet back at its high' : 'back at its high ' + Math.round(e.back) + ' days after the low', L + 50, y + 104);
      });
      if (!M.episodes.length) { font(g, 500, 34, SANS); g.globalAlpha = A; g.fillStyle = I.dim; g.fillText('No fall of ' + M.min + '% or more in the window.', L, 600); }
      g.globalAlpha = 1;
    },
    now(g, M, t, A) {
      const I = M.ink, p = easeOut(prog(t, 100, 600));
      label(g, M, 'Now', 520, A * p);
      g.globalAlpha = A * p; font(g, 800, 150, MONO); g.fillStyle = M.now < -0.05 ? I.down : I.text; g.textBaseline = 'alphabetic';
      g.fillText(M.now < -0.05 ? M.now.toFixed(1) + '%' : 'At its high', L, 720);
      font(g, 600, 40, SANS); g.fillStyle = I.dim;
      wrap(g, M.now < -0.05 ? 'below its highest close, which was on ' + M.nowSince : 'its latest close is its highest in the window', CW).forEach((ln, i) => g.fillText(ln, L, 800 + i * 56));
      g.globalAlpha = 1;
    },
  };

  // ---- 7. The Signal mix -------------------------------------------------------------------------
  const SG = {
    scenes: [['open', 3000], ['ladder', 6400], ['rules', 5600]],
    chip: (M) => M.label,
    open(g, M, t, A) { opener(g, M, t, A, 'The Signal · ' + M.label, 'How ' + M.n.toLocaleString('en-US') + ' stocks read tonight', 'Six readings, one set of rules'); },
    ladder(g, M, t, A) {
      const I = M.ink;
      label(g, M, 'Balanced rules', 450, A * easeOut(prog(t, 0, 400)));
      const max = Math.max(1, ...M.ladder.map((l) => l.n));
      M.ladder.forEach((l, i) => {
        const p = easeOut(prog(t, 250 + i * 160, 450)); if (p <= 0) return;
        const y = 560 + i * 150;
        g.globalAlpha = A * p; font(g, 700, 42, SANS); g.fillStyle = l.color; g.textBaseline = 'alphabetic'; g.fillText(l.word, L, y);
        const k = easeOut(prog(t, 900 + i * 160, 1100));
        g.globalAlpha = A * 0.4; g.fillStyle = I.grid; rrect(g, L, y + 24, CW - 150, 30, 15); g.fill();
        g.globalAlpha = A * p; g.fillStyle = l.color; rrect(g, L, y + 24, Math.max(30, (CW - 150) * l.n / max * k), 30, 15); g.fill();
        font(g, 700, 36, MONO); g.fillStyle = I.text; g.textAlign = 'right'; g.fillText(countUp(String(l.n), k), R, y + 50); g.textAlign = 'left';
      });
      g.globalAlpha = 1;
    },
    rules(g, M, t, A) {
      const I = M.ink;
      label(g, M, 'The rules that fired most', 450, A * easeOut(prog(t, 0, 400)));
      M.rules.forEach((r, i) => {
        const p = easeOut(prog(t, 300 + i * 500, 500)); if (p <= 0) return;
        const y = 580 + i * 170;
        g.globalAlpha = A * p; font(g, 800, 52, MONO); g.fillStyle = r.color; g.fillText('×' + r.n, L, y);
        font(g, 600, 34, SANS); g.fillStyle = I.text; lines(g, r.flag, CW - 180, 2).forEach((ln, j) => g.fillText(ln, L + 180, y - 8 + j * 42));
      });
      const p = easeOut(prog(t, 3000, 600));
      g.globalAlpha = A * p; font(g, 500, 30, SANS); g.fillStyle = I.dim;
      wrap(g, 'A reading of strength, not an instruction. Every reading names the one rule that fired first.', CW).forEach((ln, i) => g.fillText(ln, L, 1440 + i * 42));
      g.globalAlpha = 1;
    },
  };

  // ---- 8. Article tone, one stock ---------------------------------------------------------------
  const TN = {
    scenes: [['open', 3000], ['week', 4600], ['items', 8800]],
    chip: (M) => M.sym + ' · article tone',
    open(g, M, t, A) { opener(g, M, t, A, M.sym + ' · article tone', M.name, 'how the week’s articles read'); },
    week(g, M, t, A) {
      const I = M.ink, Wk = M.week;
      label(g, M, 'Last 7 days', 450, A * easeOut(prog(t, 0, 400)));
      if (!Wk) { font(g, 500, 36, SANS); g.globalAlpha = A; g.fillStyle = I.dim; g.fillText('No articles read in the last 7 days.', L, 600); g.globalAlpha = 1; return; }
      const rows = [['Average tone', Wk.avg, Wk.word, Wk.color || M.neu], ['Articles read', String(Wk.count), 'about the company', M.neu], ['Positive', String(Wk.pos), '', M.pos], ['Negative', String(Wk.neg), '', M.neg]];
      rows.forEach(([k, v, x, c], i) => {
        const p = easeOut(prog(t, 250 + i * 450, 500)); if (p <= 0) return;
        const y = 580 + i * 200;
        g.globalAlpha = A * p; g.fillStyle = c; rrect(g, L, y - 34, 10, 120, 5); g.fill();
        font(g, 500, 34, SANS); g.fillStyle = I.dim; g.fillText(k + (x ? ' · ' + x : ''), L + 32, y);
        font(g, 800, 76, MONO); g.fillStyle = I.text; g.fillText(v, L + 32, y + 84);
      });
      g.globalAlpha = 1;
    },
    items(g, M, t, A) {
      const I = M.ink;
      label(g, M, 'The latest articles', 450, A * easeOut(prog(t, 0, 400)));
      let y = 530;
      M.items.forEach((it, i) => {
        const p = easeOut(prog(t, 300 + i * 1700, 600)); if (p <= 0) return;
        g.globalAlpha = A * p;
        const pw = pill(g, L, y + 40, it.label, it.color, A * p);
        font(g, 700, 36, SANS); g.fillStyle = I.text;
        const hl = lines(g, it.head, CW, 3);
        hl.forEach((ln, j) => g.fillText(ln, L + (1 - p) * 30, y + 100 + j * 46));
        font(g, 500, 24, MONO); g.fillStyle = I.axis; g.fillText(it.meta, L, y + 100 + hl.length * 46 + 6);
        y += 100 + hl.length * 46 + 70;
        void pw;
      });
      g.globalAlpha = 1;
    },
  };

  // ---- the registry -------------------------------------------------------------------------------
  const BY_KIND = { gdsum: GD, months: MO, evolution: EV, instflow: IF, insiders: IN, drawdown: DD, advboard: SG, tonestock: TN };
  // The studio's templates and the kind of video each draws.
  const TPL_KIND = { gdsum: 'gdsum', secgdsum: 'gdsum', indgdsum: 'gdsum', thmgdsum: 'gdsum',
    mktmonths: 'months', secmonths: 'months', thmmonths: 'months', months: 'months',
    evolution: 'evolution', instflow: 'instflow', insiders: 'insiders', drawdown: 'drawdown', advboard: 'advboard', tonestock: 'tonestock' };
  const has = (tpl) => !!TPL_KIND[tpl];
  const def = (M) => (M && BY_KIND[M.kind]) || null;
  function plan(M) {
    const D = def(M); if (!D) return null;
    let t = 0; const out = [];
    for (const [id, d] of D.scenes) { out.push({ id, t0: t, t1: t + d }); t += d; }
    out.push({ id: 'end', t0: t, t1: t + END_MS });
    return out;
  }
  function duration(M) { const p = plan(M); return p ? p[p.length - 1].t1 : 0; }
  function paint(g, M, t) {
    const D = def(M), P = plan(M);
    if (!D || !P) return;
    const total = P[P.length - 1].t1;
    t = clamp(t, 0, total);
    g.save();
    K.groundOf(g, M.ink, t, W, H);
    for (let i = 0; i < P.length; i++) {
      const s = P[i], last = i === P.length - 1;
      if (t < s.t0 || (!last && t >= s.t1)) continue;
      const local = t - s.t0;
      const A = Math.min(prog(local, 0, FADE_IN), last ? 1 : 1 - prog(t, s.t1 - FADE_OUT, FADE_OUT));
      if (s.id === 'end') { global.Reel.endCard(g, M.ink, local, A, W, H, M.date); continue; }
      g.globalAlpha = 1; brand(g, M, D.chip(M));
      D[s.id](g, M, local, A);
    }
    disclaimer(g, M);
    g.restore();
  }

  global.CardVideo = { W, H, has, plan, duration, paint, TPL_KIND };
})(typeof window !== 'undefined' ? window : globalThis);
