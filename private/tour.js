// THE TOUR (2026-10-23, admin only): Tickr Lab in one minute, a 16:9 video
// for YouTube. The owner: "Can you help me create a longer promo video that
// might go up to a minute that you can post on YouTube", then chose "Tour of
// Tickr Lab" and "Regular video 16:9".
//
// Two halves, as the Reel (reel.js):
//   model(data) turns what the page fetched into everything the video shows,
//     already worded and formatted. All the arithmetic and wording is here.
//   paint(g, M, t) draws the frame at t milliseconds onto a 1920x1080
//     context: a PURE function of the time and the model, so any frame can be
//     drawn in any order and a recording is the same every time.
// The ground, the glyph, the end card, the recorder and the music come from
// reel.js (Reel.kit, Reel.endCard, Reel.run, Reel.musicPicker): one
// implementation each.
//
// THE WORDS. Descriptive only, as everywhere on the site: the Signal is a
// reading of strength, never an instruction; no buy, sell or hold, no
// "winners", no targets. Every count shown is read from the site the day the
// video is made, never written in here.
(function (global) {
  'use strict';
  const K = global.Reel && global.Reel.kit;
  const W = 1920, H = 1080;
  const L = 120, R = 1800, CW = R - L;
  const SANS = 'Geist, "Geist Fallback", system-ui, sans-serif';
  const MONO = '"Geist Mono", ui-monospace, monospace';
  const SCENES = [
    { id: 'open', t0: 0, t1: 6000 },
    { id: 'screener', t0: 6000, t1: 16000 },
    { id: 'signal', t0: 16000, t1: 26000 },
    { id: 'stock', t0: 26000, t1: 37000 },
    { id: 'earnings', t0: 37000, t1: 47000 },
    { id: 'filings', t0: 47000, t1: 54000 },
    { id: 'end', t0: 54000, t1: 60000 },
  ];
  const DURATION = 60000, FADE_IN = 450, FADE_OUT = 350;

  // ---- the model -----------------------------------------------------------
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const pct = (v, d) => { const n = num(v); return n == null ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(d == null ? 1 : d) + '%'; };
  const big = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
  const DAYS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayStr = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? DAYS[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1] : ''; };
  // One price: dollars to two places, thousands separated.
  const price = (v) => { const n = num(v); return n == null ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const money = (v) => { const n = num(v); if (n == null) return '—'; const a = Math.abs(n); const s = a >= 1e12 ? (a / 1e12).toFixed(2) + 'T' : a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a.toFixed(0); return (n < 0 ? '−$' : '$') + s; };
  const isFund = (r) => r && (r.instrumentType === 'ETF' || /fund/i.test(r.instrumentType || ''));

  // data: { stocks (the screener's rows), about (/api/about-stats), sym,
  //   closes (oldest first), glance (Glance.build's cards), column (the
  //   stored release column's rows by symbol), ink, ladder ([{word, color}],
  //   strongest first), canon (ActionRules.canon), fields (ReleaseView.fields),
  //   changeHex (ReleaseView.CHANGE_HEX), changeKey }
  function model(data) {
    const D = data || {};
    const canon = D.canon || ((w) => w);
    const rows = (D.stocks || []).filter((r) => r && r.symbol && !r.error && !isFund(r));
    const ladder = (D.ladder || []).map((l) => Object.assign({}, l, { n: 0 }));
    const colorOf = (w) => { const l = ladder.find((x) => x.word === w); return l ? l.color : null; };
    let scored = 0;
    for (const r of rows) { const w = r.action ? canon(r.action) : null; const l = w && ladder.find((x) => x.word === w); if (l) { l.n++; scored++; } }
    const byCap = rows.filter((r) => num(r.marketCap) > 0).sort((a, b) => num(b.marketCap) - num(a.marketCap));
    const nameOf = (r) => r.shortName || r.name || r.symbol;
    const table = byCap.slice(0, 8).map((r) => {
      const w = r.action ? canon(r.action) : null;
      return { sym: r.symbol, name: nameOf(r), today: pct(r.todayPct, 2), todayN: num(r.todayPct), m1: pct(r.oneMonthPct), m1N: num(r.oneMonthPct),
        y1: pct(r.oneYearPct), y1N: num(r.oneYearPct), v200: pct(r.vs200ma), v200N: num(r.vs200ma),
        fpe: num(r.forwardPe) > 0 ? num(r.forwardPe).toFixed(1) : '—', word: w || 'Not scored', color: w ? colorOf(w) : null };
    });
    // The featured stock: the one asked for, else the largest.
    const st = rows.find((r) => r.symbol === D.sym) || byCap[0] || null;
    const stW = st && st.action ? canon(st.action) : null;
    const closes = (D.closes || []).map(num).filter((v) => v != null && v > 0);
    const move = closes.length > 1 ? (closes[closes.length - 1] / closes[0] - 1) * 100 : null;
    // The Owners card is left out: its sentence reads 'institutions hold N%', a
    // share of ownership, but a marketing video carries no 'hold' at all.
    const pick = ['earn', 'growth', 'value', 'balance', 'shortpos', 'vol', 'long', 'short'];
    const cards = (D.glance || []).filter((c) => c && c.text && c.id !== 'signal' && c.id !== 'owners')
      .sort((a, b) => (pick.indexOf(a.id) < 0 ? 99 : pick.indexOf(a.id)) - (pick.indexOf(b.id) < 0 ? 99 : pick.indexOf(b.id))).slice(0, 4)
      .map((c) => ({ title: c.title, head: c.key && c.key.v ? String(c.key.v) : '', sub: c.key && c.key.k ? String(c.key.k) : '', text: String(c.text) }));
    // The newest results releases among the largest companies, one a company.
    const col = D.column || {};
    const fields = D.fields || ((r) => r);
    const rel = byCap.filter((r) => col[r.symbol] && col[r.symbol].filed).slice(0, 40)
      .map((r) => ({ r, f: fields(col[r.symbol]) }))
      .sort((a, b) => (String(b.f.erFiled) > String(a.f.erFiled) ? 1 : String(b.f.erFiled) < String(a.f.erFiled) ? -1 : num(b.r.marketCap) - num(a.r.marketCap)))
      .slice(0, 12)
      // Those stating a change in their outlook first, so the video shows one;
      // otherwise newest first, as sorted.
      .map((x, i) => ({ x, i, c: x.f.erGuideChange ? 0 : 1 })).sort((a, b) => a.c - b.c || a.i - b.i).map((o) => o.x)
      .slice(0, 4)
      .map(({ r, f }) => {
        const k = D.changeKey ? D.changeKey(f.erGuideChange) : null;
        return { sym: r.symbol, name: nameOf(r), period: f.erPeriodLabel || '', filed: dayStr(f.erFiled),
          rev: f.erRevenue != null ? money(f.erRevenue) : '—', revYoY: f.erRevYoY != null ? pct(f.erRevYoY) : null, revUp: f.erRevYoY == null ? null : f.erRevYoY >= 0,
          eps: f.erEps != null ? (f.erEps < 0 ? '−$' : '$') + Math.abs(f.erEps).toFixed(2) : '—', epsYoY: f.erEpsYoY != null ? pct(f.erEpsYoY) : null, epsUp: f.erEpsYoY == null ? null : f.erEpsYoY >= 0,
          change: f.erGuideChange || null, changeColor: k && D.changeHex ? D.changeHex[k] : null };
      });
    const A = D.about || {};
    return {
      ink: D.ink, date: dayStr(D.date) || D.date || '',
      symbols: num(A.symbols) || rows.length, columns: num(A.columns), screens: num(A.screens),
      table, ladder, scored,
      example: st ? { sym: st.symbol, name: nameOf(st), word: stW, color: stW ? colorOf(stW) : null, flag: stW ? (st.actionFlag || '') : '' } : null,
      stock: st ? { sym: st.symbol, name: nameOf(st), kick: [st.sector, st.industry].filter(Boolean).join(' · '), price: price(st.price),
        today: pct(st.todayPct, 2), todayUp: num(st.todayPct) == null ? null : num(st.todayPct) >= 0,
        closes, move: move == null ? null : pct(move), moveUp: move == null ? null : move >= 0, cards } : null,
      releases: rel, released: Object.keys(col).length,
    };
  }

  // ---- shared pieces -------------------------------------------------------
  const { clamp, prog, easeOut, easeInOut, font, fitFont, wrap, rrect, glyph, countUp } = K || {};
  function brand(g, M) {
    const I = M.ink;
    glyph(g, L, 58, 40, I.accent, 3);
    font(g, 700, 28, SANS); g.fillStyle = I.text; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('Tickr Lab', L + 52, 79);
    if (M.date) {
      const txt = 'Readings to the close of ' + M.date;
      font(g, 500, 21, MONO);
      const w = g.measureText(txt).width + 36;
      g.strokeStyle = M.ink.grid; g.lineWidth = 2; rrect(g, R - w, 58, w, 42, 21); g.stroke();
      g.fillStyle = I.axis; g.textAlign = 'center'; g.fillText(txt, R - w / 2, 80);
      g.textAlign = 'left';
    }
  }
  function disclaimer(g, M) {
    g.globalAlpha = 0.85; font(g, 500, 21, MONO); g.fillStyle = M.ink.axis; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText('Mechanical readings — not investment advice', L, 1032);
    g.globalAlpha = 1;
  }
  // A scene's kicker (accent, mono, capitals) and its title.
  function heading(g, M, t, A, kick, title) {
    const p = easeOut(prog(t, 0, 500));
    g.globalAlpha = A * p; font(g, 600, 24, MONO); g.fillStyle = M.ink.accent; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText(kick.toUpperCase(), L, 196);
    const p2 = easeOut(prog(t, 120, 600));
    g.globalAlpha = A * p2; fitFont(g, title, 750, 64, 40, SANS, CW); g.fillStyle = M.ink.text;
    g.fillText(title, L, 268 + (1 - p2) * 18);
    g.globalAlpha = 1;
  }
  const upDown = (I, n) => (n == null ? I.dim : n > 0 ? I.up : n < 0 ? I.down : I.flat);
  // Text typed out over `dur` from `start`: the visible part at time t.
  const typed = (s, t, start, dur) => String(s).slice(0, Math.round(String(s).length * prog(t, start, dur)));

  // ---- 1. the opening ------------------------------------------------------
  function sceneOpen(g, M, t, A) {
    const I = M.ink;
    const lines = ['Every stock on the screen.', 'Measured the same way.', 'After every close.'];
    font(g, 800, 96, SANS); g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    let at = 300;
    lines.forEach((ln, i) => {
      const s = typed(ln, t, at, ln.length * 38);
      g.globalAlpha = A; g.fillStyle = i === 2 ? I.accent : I.text;
      g.fillText(s, L, 380 + i * 124);
      // The cursor, on the line being typed.
      const done = prog(t, at, ln.length * 38) >= 1;
      if (!done && t >= at && Math.floor(t / 400) % 2 === 0) { const w = g.measureText(s).width; g.fillRect(L + w + 8, 380 + i * 124 - 78, 8, 88); }
      at += ln.length * 38 + 260;
    });
    const p = easeOut(prog(t, at + 200, 700));
    if (p > 0) {
      const parts = [big(M.symbols) + ' US-listed stocks'];
      if (M.columns) parts.push(big(M.columns) + ' columns');
      parts.push('one mechanical Signal');
      g.globalAlpha = A * p; font(g, 500, 34, MONO); g.fillStyle = I.dim;
      g.fillText(parts.join('  ·  '), L, 820 + (1 - p) * 20);
    }
    g.globalAlpha = 1;
  }

  // ---- 2. the screener -----------------------------------------------------
  const COLS = [
    { k: 'sym', h: 'Symbol', x: 0, w: 150 },
    { k: 'name', h: 'Company', x: 150, w: 430 },
    { k: 'today', h: 'Today', x: 580, w: 150, n: 'todayN', right: true },
    { k: 'm1', h: '1 month', x: 730, w: 170, n: 'm1N', right: true },
    { k: 'y1', h: '1 year', x: 900, w: 180, n: 'y1N', right: true },
    { k: 'v200', h: 'vs 200-day', x: 1080, w: 190, n: 'v200N', right: true },
    { k: 'fpe', h: 'Fwd P/E', x: 1270, w: 140, right: true },
    { k: 'word', h: 'Signal', x: 1450, w: 230 },
  ];
  function sceneScreener(g, M, t, A) {
    const I = M.ink;
    heading(g, M, t, A, 'The screener', 'Every reading, one row per stock.');
    const top = 330, RH = 62;
    // Header row.
    const ph = easeOut(prog(t, 400, 400));
    g.globalAlpha = A * ph; font(g, 600, 20, MONO); g.fillStyle = I.axis; g.textBaseline = 'middle';
    for (const c of COLS) { g.textAlign = c.right ? 'right' : 'left'; g.fillText(c.h.toUpperCase(), L + c.x + (c.right ? c.w : 0), top + 24); }
    g.strokeStyle = I.grid; g.lineWidth = 2; g.beginPath(); g.moveTo(L, top + 50); g.lineTo(R, top + 50); g.stroke();
    // The rows, sliding in one after another, figures counting up.
    M.table.forEach((row, i) => {
      const t0 = 650 + i * 140;
      const p = easeOut(prog(t, t0, 450));
      if (p <= 0) return;
      const y = top + 50 + i * RH + RH / 2;
      const k = easeOut(prog(t, t0 + 150, 900));
      g.globalAlpha = A * p;
      // A highlight sweeps down the rows once they are all in.
      const sweep = prog(t, 3200, 2600) * (M.table.length + 1) - 0.5;
      if (Math.abs(sweep - i) < 0.5) { g.fillStyle = I.grid; rrect(g, L - 16, y - RH / 2 + 4, CW + 32, RH - 8, 10); g.fill(); }
      for (const c of COLS) {
        let v = row[c.k];
        g.textAlign = c.right ? 'right' : 'left';
        if (c.k === 'sym') { font(g, 700, 28, MONO); g.fillStyle = I.text; }
        else if (c.k === 'name') { font(g, 500, 26, SANS); g.fillStyle = I.dim; while (g.measureText(v).width > c.w - 20 && v.length > 3) v = v.slice(0, -2).trimEnd() + '…'; }
        else if (c.k === 'word') { font(g, 700, 26, SANS); g.fillStyle = row.color || I.dim; }
        else { font(g, 500, 26, MONO); g.fillStyle = c.n ? upDown(I, row[c.n]) : I.text; v = countUp(v, k); }
        g.fillText(v, L + c.x + (c.right ? c.w : 0) + (1 - p) * 40, y);
      }
      g.strokeStyle = I.grid; g.lineWidth = 1; g.beginPath(); g.moveTo(L, y + RH / 2); g.lineTo(R, y + RH / 2); g.stroke();
    });
    // The line under the table.
    const pc = easeOut(prog(t, 6400, 700));
    if (pc > 0) {
      g.globalAlpha = A * pc; font(g, 500, 32, SANS); g.fillStyle = I.text; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      const msg = 'Sort, filter and save screens' + (M.columns ? ' across ' + big(M.columns) + ' columns' : '') + ', for every stock on the list.';
      g.fillText(msg, L, 960);
    }
    g.globalAlpha = 1;
  }

  // ---- 3. the Signal -------------------------------------------------------
  function sceneSignal(g, M, t, A) {
    const I = M.ink;
    heading(g, M, t, A, 'The Signal', 'Six readings. The rule that fired, named.');
    const top = 340, RH = 92, barX = L + 480, barW = 500;
    const max = Math.max(1, ...M.ladder.map((l) => l.n));
    M.ladder.forEach((l, i) => {
      const p = easeOut(prog(t, 500 + i * 110, 450));
      const y = top + i * RH + RH / 2;
      g.globalAlpha = A * p; font(g, 700, 38, SANS); g.fillStyle = l.color; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(l.word, L, y);
      const k = easeOut(prog(t, 1300 + i * 110, 1100));
      g.fillStyle = I.grid; rrect(g, barX, y - 16, barW, 32, 16); g.fill();
      g.fillStyle = l.color; rrect(g, barX, y - 16, Math.max(32, barW * (l.n / max) * k), 32, 16); g.fill();
      font(g, 600, 28, MONO); g.fillStyle = I.dim; g.textAlign = 'left';
      g.fillText(countUp(big(l.n), k) + ' stocks', barX + barW + 24, y);
    });
    // One stock, its reading and its rule, typed.
    const E = M.example;
    const pe = easeOut(prog(t, 3600, 600));
    if (E && pe > 0) {
      const x = 1330, w = R - x, y0 = 340;
      g.globalAlpha = A * pe;
      g.strokeStyle = I.grid; g.lineWidth = 2; rrect(g, x, y0, w, 470, 22); g.stroke();
      font(g, 600, 22, MONO); g.fillStyle = I.axis; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      g.fillText('FOR EXAMPLE', x + 36, y0 + 56);
      fitFont(g, E.sym, 800, 72, 40, MONO, w - 72); g.fillStyle = I.text; g.fillText(E.sym, x + 36, y0 + 140);
      font(g, 800, 46, SANS); g.fillStyle = E.color || I.dim; g.fillText(E.word || 'Not scored', x + 36, y0 + 210);
      font(g, 600, 22, MONO); g.fillStyle = I.accent; g.fillText('THE RULE THAT FIRED', x + 36, y0 + 278);
      font(g, 500, 30, SANS); g.fillStyle = I.text;
      const rule = E.word ? E.flag : 'Not enough stored history for the rules to reach a reading.';
      const lines = wrap(g, rule, w - 72).slice(0, 4);
      let left = Math.round(lines.join(' ').length * prog(t, 4300, 1800));
      lines.forEach((ln, i) => { g.fillText(ln.slice(0, Math.max(0, left)), x + 36, y0 + 326 + i * 40); left -= ln.length + 1; });
    }
    const pn = easeOut(prog(t, 6600, 600));
    if (pn > 0) {
      g.globalAlpha = A * pn; font(g, 500, 28, SANS); g.fillStyle = I.dim; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      g.fillText('Balanced rules, the same for every stock. A reading of strength, not an instruction.', L, 960);
    }
    g.globalAlpha = 1;
  }

  // ---- 4. one stock --------------------------------------------------------
  function sceneStock(g, M, t, A) {
    const I = M.ink, S = M.stock;
    if (!S) { heading(g, M, t, A, 'One stock, in full', 'Every stock has its own page.'); return; }
    heading(g, M, t, A, S.kick || 'One stock, in full', S.name + ' (' + S.sym + ')');
    // The price line and the year, left.
    const cx = L, cy = 340, cw = 1000, ch = 440;
    const p0 = easeOut(prog(t, 400, 500));
    g.globalAlpha = A * p0; font(g, 700, 52, MONO); g.fillStyle = I.text; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText(S.price, cx, cy + 40);
    const pw = g.measureText(S.price).width;
    font(g, 600, 30, MONO); g.fillStyle = S.todayUp == null ? I.dim : S.todayUp ? I.up : I.down;
    g.fillText(S.today + ' today', cx + pw + 24, cy + 40);
    const c = S.closes;
    if (c.length > 1) {
      let lo = Infinity, hi = -Infinity; for (const v of c) { if (v < lo) lo = v; if (v > hi) hi = v; }
      const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
      const X = (i) => cx + (i / (c.length - 1)) * cw, Y = (v) => cy + 80 + ch - ((v - lo) / (hi - lo)) * ch;
      // The first close, dashed across.
      g.globalAlpha = A * p0 * 0.6; g.setLineDash([8, 10]); g.strokeStyle = I.axis; g.lineWidth = 2;
      g.beginPath(); g.moveTo(cx, Y(c[0])); g.lineTo(cx + cw, Y(c[0])); g.stroke(); g.setLineDash([]);
      const k = easeInOut(prog(t, 700, 3200));
      const n = Math.max(2, Math.round(c.length * k));
      const col = S.moveUp == null ? I.accent : S.moveUp ? I.up : I.down;
      g.globalAlpha = A; g.strokeStyle = col; g.lineWidth = 4; g.lineJoin = 'round';
      g.beginPath(); for (let i = 0; i < n; i++) { if (i) g.lineTo(X(i), Y(c[i])); else g.moveTo(X(i), Y(c[i])); } g.stroke();
      g.fillStyle = col; g.beginPath(); g.arc(X(n - 1), Y(c[n - 1]), 8, 0, Math.PI * 2); g.fill();
      font(g, 600, 26, MONO); g.fillStyle = I.axis; g.textAlign = 'left';
      g.fillText('A YEAR OF CLOSES', cx, cy + ch + 140);
      if (S.move) { g.fillStyle = col; g.textAlign = 'right'; font(g, 700, 34, MONO); g.fillText(countUp(S.move, k) + ' over the year', cx + cw, cy + ch + 140); }
    } else {
      font(g, 500, 30, SANS); g.fillStyle = I.dim; g.fillText('No stored price history for this stock yet.', cx, cy + 200);
    }
    // At a glance, right: four topic cards, each against its industry.
    const x = 1210, w = R - x;
    font(g, 600, 22, MONO); g.globalAlpha = A * easeOut(prog(t, 1600, 400)); g.fillStyle = I.accent; g.textAlign = 'left';
    g.fillText('AT A GLANCE', x, cy + 6);
    S.cards.forEach((cd, i) => {
      const p = easeOut(prog(t, 1900 + i * 650, 500));
      if (p <= 0) return;
      const y = cy + 30 + i * 150;  // 140 tall, 10 apart
      g.globalAlpha = A * p;
      g.strokeStyle = I.grid; g.lineWidth = 2; rrect(g, x + (1 - p) * 30, y, w, 140, 16); g.stroke();
      font(g, 600, 21, MONO); g.fillStyle = I.axis; g.textBaseline = 'alphabetic';
      g.fillText(String(cd.title).toUpperCase(), x + 24, y + 36);
      if (cd.head) { fitFont(g, cd.head, 700, 30, 22, SANS, w - 48); g.fillStyle = I.text; g.fillText(cd.head, x + 24, y + 70); }
      font(g, 500, 20, SANS); g.fillStyle = I.dim;
      const ln = wrap(g, cd.text, w - 48).slice(0, cd.head ? 2 : 3);
      const more = wrap(g, cd.text, w - 48).length > ln.length;
      ln.forEach((t2, j) => {
        let line = t2;
        if (more && j === ln.length - 1) { while (g.measureText(line + '…').width > w - 48 && line.length > 3) line = line.slice(0, -1); line = line.trimEnd() + '…'; }
        g.fillText(line, x + 24, y + (cd.head ? 98 : 70) + j * 24);
      });
    });
    g.globalAlpha = 1;
  }

  // ---- 5. results, read by AI ---------------------------------------------
  function sceneEarnings(g, M, t, A) {
    const I = M.ink;
    heading(g, M, t, A, 'Results, read by AI', 'Every results release, read the day it is filed.');
    const n = M.releases.length;
    if (!n) { font(g, 500, 32, SANS); g.fillStyle = I.dim; g.globalAlpha = A; g.fillText('The newest releases appear here.', L, 420); g.globalAlpha = 1; return; }
    const gap = 32, w = (CW - gap * 3) / 4, y = 330, h = 500;
    M.releases.forEach((r, i) => {
      const p = easeOut(prog(t, 600 + i * 380, 520));
      if (p <= 0) return;
      const x = L + i * (w + gap), yy = y + (1 - p) * 40;
      g.globalAlpha = A * p;
      g.fillStyle = I.grid; rrect(g, x, yy, w, h, 22); g.fill();
      g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      font(g, 700, 44, MONO); g.fillStyle = I.text; g.fillText(r.sym, x + 30, yy + 70);
      font(g, 500, 22, SANS); g.fillStyle = I.dim;
      let nm = r.name; while (g.measureText(nm).width > w - 60 && nm.length > 3) nm = nm.slice(0, -2).trimEnd() + '…';
      g.fillText(nm, x + 30, yy + 104);
      font(g, 500, 20, MONO); g.fillStyle = I.axis;
      let per = r.period; while (g.measureText(per).width > w - 60 && per.length > 3) per = per.slice(0, -2).trimEnd() + '…';
      g.fillText(per, x + 30, yy + 140);
      const k = easeOut(prog(t, 900 + i * 380, 900));
      font(g, 600, 20, MONO); g.fillStyle = I.axis; g.fillText('REVENUE', x + 30, yy + 196);
      font(g, 700, 40, MONO); g.fillStyle = I.text; g.fillText(countUp(r.rev, k), x + 30, yy + 242);
      if (r.revYoY) { font(g, 600, 24, MONO); g.fillStyle = r.revUp ? I.up : I.down; g.fillText(r.revYoY + ' on a year ago', x + 30, yy + 276); }
      font(g, 600, 20, MONO); g.fillStyle = I.axis; g.fillText('EPS', x + 30, yy + 330);
      font(g, 700, 40, MONO); g.fillStyle = I.text; g.fillText(countUp(r.eps, k), x + 30, yy + 376);
      if (r.epsYoY) { font(g, 600, 24, MONO); g.fillStyle = r.epsUp ? I.up : I.down; g.fillText(r.epsYoY + ' on a year ago', x + 30, yy + 410); }
      // The company's own stated change in its outlook, as the site colours it.
      const pg = easeOut(prog(t, 2400 + i * 300, 400));
      if (r.change && pg > 0) {
        const txt = 'Guidance ' + r.change.toLowerCase();
        font(g, 700, 22, SANS); const tw = g.measureText(txt).width + 36;
        g.globalAlpha = A * p * pg; g.fillStyle = r.changeColor || I.accent; rrect(g, x + 30, yy + 434, tw, 44, 22); g.fill();
        g.fillStyle = '#ffffff'; g.textBaseline = 'middle'; g.fillText(txt, x + 48, yy + 457); g.textBaseline = 'alphabetic';
      }
    });
    const pc = easeOut(prog(t, 4600, 700));
    if (pc > 0) {
      g.globalAlpha = A * pc; font(g, 500, 30, SANS); g.fillStyle = I.text; g.textAlign = 'left';
      g.fillText('Every figure is checked against the release text, then against the 10-Q.', L, 905);
      font(g, 500, 26, MONO); g.fillStyle = I.dim;
      g.fillText(big(M.released) + ' companies with their latest results read', L, 950);
    }
    g.globalAlpha = 1;
  }

  // ---- 6. the filings ------------------------------------------------------
  const SOURCES = [
    ['8-K filings', 'Read the next morning', 'SEC'],
    ['Insider trades', 'Forms 3, 4 and 5', 'SEC'],
    ['Institutional holders', 'Form 13F, every quarter', 'SEC'],
    ['Fund holders', 'Form N-PORT', 'SEC'],
    ['Short interest', 'Twice a month', 'FINRA'],
    ['Options open interest', 'Calls and puts', 'OCC'],
  ];
  function sceneFilings(g, M, t, A) {
    const I = M.ink;
    heading(g, M, t, A, 'Behind every number', 'The filings, too.');
    const cols = 3, gap = 32, w = (CW - gap * (cols - 1)) / cols, h = 200, top = 340;
    SOURCES.forEach((s, i) => {
      const p = easeOut(prog(t, 500 + i * 260, 480));
      if (p <= 0) return;
      const x = L + (i % cols) * (w + gap), y = top + Math.floor(i / cols) * (h + gap) + (1 - p) * 30;
      g.globalAlpha = A * p;
      g.strokeStyle = I.grid; g.lineWidth = 2; rrect(g, x, y, w, h, 20); g.stroke();
      g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      font(g, 700, 40, SANS); g.fillStyle = I.text; g.fillText(s[0], x + 34, y + 84);
      font(g, 500, 26, SANS); g.fillStyle = I.dim; g.fillText(s[1], x + 34, y + 130);
      font(g, 600, 20, MONO); g.fillStyle = I.accent; g.fillText(s[2], x + 34, y + 172);
    });
    const pc = easeOut(prog(t, 3200, 700));
    if (pc > 0) {
      g.globalAlpha = A * pc; font(g, 500, 30, SANS); g.fillStyle = I.text;
      g.fillText('Taken from the source, dated, and kept as history.', L, 900);
    }
    g.globalAlpha = 1;
  }

  function sceneEnd(g, M, t, A) { global.Reel.endCard(g, M.ink, t, A, W, H, M.date); }

  const PAINT = { open: sceneOpen, screener: sceneScreener, signal: sceneSignal, stock: sceneStock, earnings: sceneEarnings, filings: sceneFilings, end: sceneEnd };
  function paint(g, M, t) {
    t = clamp(t, 0, DURATION);
    g.save();
    K.groundOf(g, M.ink, t, W, H);
    for (let i = 0; i < SCENES.length; i++) {
      const s = SCENES[i], last = i === SCENES.length - 1;
      if (t < s.t0 || (!last && t >= s.t1)) continue;
      const local = t - s.t0;
      const A = Math.min(prog(local, 0, FADE_IN), last ? 1 : 1 - prog(t, s.t1 - FADE_OUT, FADE_OUT));
      if (s.id !== 'end' && s.id !== 'open') { g.globalAlpha = A; brand(g, M); g.globalAlpha = 1; }
      PAINT[s.id](g, M, local, A);
    }
    disclaimer(g, M);
    g.restore();
  }
  // Where each chapter starts, for the YouTube description. YouTube shows
  // chapters only when the first is at 0:00, there are three or more, and each
  // runs ten seconds or longer, so the short scenes ride with a neighbour.
  const CHAPTERS = [[0, 'The screener'], [16000, 'The Signal'], [26000, 'One stock, in full'], [37000, 'Results, read by AI'], [47000, 'The filings']]
    .map(([ms, name]) => { const sec = Math.round(ms / 1000); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') + ' ' + name; });

  global.Tour = { W, H, DURATION, SCENES, CHAPTERS, model, paint };
})(typeof window !== 'undefined' ? window : globalThis);
