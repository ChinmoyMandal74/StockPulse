// A company against its peers on one measure, quarter by quarter.
//
// TWO READINGS OF ONE SERIES, and this file is where both are defined so the
// stock page and the promo card cannot draw them differently:
//
//   value  the figures themselves, one line per company. The default, at the
//          owner's instruction: the peers are picked to be close in size, so
//          the lines share a scale without one flattening the rest.
//   rank   a bump chart -- 1st at the top -- which stays readable when the
//          sizes are NOT close, and shows overtaking at a glance.
//
// Pure: no DOM, no fetch, no requires. Loaded with a <script> tag by
// stock.html and promo.html and require()d by server.js, the way rowcard.js
// and filters.js are; cards.js reads it off the global lazily, as it does
// ActionRules.
//
// The input is what /api/peer-trend returns:
//   { quarters: ['2021-12-31', ...],
//     companies: [{ symbol, name, self }],
//     series: { rev: { SYM: [v | null, ...] }, ni: {...}, pm: {...}, cap: {...} } }
(function (global) {
  'use strict';

  // [key, label, unit]. Revenue leads because it is the one figure every
  // filer reports and none can be negative.
  const METRICS = [
    ['rev', 'Revenue', 'money'],
    ['ni', 'Net income', 'money'],
    ['pm', 'Profit margin', 'pct'],
    ['cap', 'Market value', 'money'],
    // Market value over trailing earnings. Positive only: a multiple off a
    // loss is arithmetic, not cheapness, so a loss-making quarter is a gap
    // in that company's line and it is left out of that quarter's ranking.
    ['pe', 'P/E', 'mult'],
  ];
  // THE LINES CARD'S CATALOGUE: everything here that has a HISTORY -- a price
  // in the bar archive, or a figure in the filings. A fourth element carries
  // flags: `pin` caps a runaway point the way a multiple is capped, `lower`
  // is the mid-sentence form where lower-casing the label would be wrong.
  // The peer chart keeps its own five; this list is handed to build() by the
  // one card that wants it.
  const LINE_METRICS = [
    ['px', 'Share price', 'ret'],
    ['rev', 'Revenue', 'money'],
    ['gp', 'Gross profit', 'money'],
    ['oi', 'Operating income', 'money'],
    ['ni', 'Net income', 'money'],
    ['fcf', 'Free cash flow', 'money'],
    ['gm', 'Gross margin', 'pct'],
    ['om', 'Operating margin', 'pct'],
    ['pm', 'Profit margin', 'pct'],
    ['fm', 'Free cash flow margin', 'pct'],
    ['rg', 'Revenue growth', 'ret', { pin: 1 }],
    ['cap', 'Market value', 'money'],
    ['pe', 'P/E', 'mult'],
    ['ps', 'P/S', 'mult'],
  ];
  const VIEWS = [['value', 'Value'], ['rank', 'Rank'], ['share', 'Share of the group']];
  // SHARE OF THE GROUP (2026-10-13, the owner, of the peer card: "what do you
  // think of making this in a stacked area chart", then "build the third
  // option"). A 100% stacked area: each band is one company's share of the
  // group's combined figure, so the picture is who is taking share from whom.
  //
  // IT IS A THIRD VIEW AND NOT A REPLACEMENT, because a stack hides what the
  // lines show: only the bottom band has a flat baseline, so no other
  // company's own rise or fall can be read off it, and crossings vanish.
  //
  // ONLY WHERE ADDING UP MEANS SOMETHING: revenue and market value. Net
  // income can be negative, and a margin, a multiple or a rank is not a
  // quantity that sums. Asked for on any other measure, build() answers
  // with the value view and says so in `shareRefused`.
  //
  // ONLY QUARTERS WHERE EVERY COMPANY HAS A FIGURE. A company missing from a
  // quarter would read as a share of nothing and hand its slice to the
  // others. The chart is the unbroken run of complete quarters ending at
  // the newest, and `dropped` says how many earlier ones were left off.
  //
  // THE GROUP IS THESE COMPANIES, NOT THE INDUSTRY, and every surface says so.
  const SHARE_METRICS = new Set(['rev', 'cap']);
  const SHARE_MIN_QUARTERS = 4;
  // Bands are identities, not directions: never green or red. The company
  // itself takes the accent; the peers take these in turn.
  const SHARE_SELF = '#7c9cff';
  const SHARE_INKS = ['#fb923c', '#a78bfa', '#38bdf8', '#f472b6', '#cbd5e1', '#818cf8', '#fdba74', '#94a3b8'];
  const fmtShare = (s) => (ok(s) ? (s > 0 && s < 0.5 ? '<1' : String(Math.round(s))) + '%' : '\u2014');
  const viewsFor = (metricKey) => VIEWS.filter(([k]) => k !== 'share' || SHARE_METRICS.has(metricKey));
  const metricOf = (k, cat) => (cat || METRICS).find((m) => m[0] === k) || (cat || METRICS)[0];

  const ok = (v) => v != null && isFinite(v);

  function fmt(unit, v) {
    if (!ok(v)) return '—';
    const a = Math.abs(v), s = v < 0 ? '−' : '';
    // A RETURN takes its sign both ways; a level (a margin) only when negative.
    if (unit === 'ret') return (v > 0 ? '+' : s) + (a >= 1000 ? Math.round(a).toLocaleString('en-US') : a.toFixed(1)) + '%';
    if (unit === 'pct') return s + a.toFixed(1) + '%';
    if (unit === 'mult') return s + (a >= 1000 ? Math.round(a).toLocaleString('en-US') : a.toFixed(1)) + '×';
    if (a >= 1e12) return s + '$' + (a / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(0) + 'M';
    return s + '$' + a.toFixed(0);
  }
  function qLabel(d) {
    const m = Number(String(d).slice(5, 7));
    return 'Q' + Math.ceil(m / 3) + " '" + String(d).slice(2, 4);
  }

  // The model both hosts draw from. Every y is 0 at the top and 1 at the
  // bottom of the plot, so a renderer only has to scale it.
  function build(data, metricKey, viewKey, catalogue, opt) {
    const [mk, mLabel, unit, mf] = metricOf(metricKey, catalogue);
    const view = viewKey === 'rank' ? 'rank' : 'value';
    const quarters = (data && data.quarters) || [];
    const src = ((data && data.series) || {})[mk] || {};
    // A company with no figure in ANY quarter is not on the chart at all: it
    // has no line to draw and must not hold a rank open below the others.
    const companies = ((data && data.companies) || [])
      .map((c) => Object.assign({}, c, { vals: (src[c.symbol] || []).map((v) => (ok(v) ? Number(v) : null)) }))
      .filter((c) => c.vals.some(ok));
    const n = quarters.length, N = companies.length;
    const wantShare = viewKey === 'share';

    // ---- rank, quarter by quarter -------------------------------------------
    // Only the companies WITH a figure that quarter are ranked. A missing one
    // is a gap in its line, never last place: "did not report" and "smallest"
    // are different facts, and drawing them the same is how a chart lies.
    const ranks = companies.map(() => new Array(n).fill(null));
    for (let i = 0; i < n; i++) {
      companies.map((c, k) => [k, c.vals[i]]).filter((x) => ok(x[1]))
        .sort((a, b) => b[1] - a[1])
        .forEach((x, r) => { ranks[x[0]][i] = r + 1; });
    }

    // ---- share of the group -----------------------------------------------------
    if (wantShare && SHARE_METRICS.has(mk) && N >= 2) {
      const full = (i) => companies.every((c) => ok(c.vals[i]) && c.vals[i] > 0);
      let end = n - 1;
      while (end >= 0 && !full(end)) end--;
      let start = end;
      while (start > 0 && full(start - 1)) start--;
      if (end >= 0 && end - start + 1 >= SHARE_MIN_QUARTERS) {
        const m = end - start + 1;
        const share = companies.map((c) => Array.from({ length: m }, (_, j) => {
          const i = start + j; let sum = 0;
          for (const o of companies) sum += o.vals[i];
          return c.vals[i] / sum * 100;
        }));
        // The company itself at the foot, where the baseline is flat and its
        // own share can be read; the peers above it, largest today first.
        const order = companies.map((_, k) => k).sort((a, b) => (companies[b].self ? 1 : 0) - (companies[a].self ? 1 : 0)
          || share[b][m - 1] - share[a][m - 1] || (companies[a].symbol < companies[b].symbol ? -1 : 1));
        const cum = new Array(m).fill(0);
        let ink = 0;
        const bands = order.map((k) => {
          const c = companies[k];
          const pts = Array.from({ length: m }, (_, j) => {
            const yb = 1 - cum[j] / 100; cum[j] += share[k][j];
            return { i: j, v: c.vals[start + j], rank: ranks[k][start + j], share: share[k][j], y: 1 - cum[j] / 100, yb };
          });
          return { symbol: c.symbol, name: c.name || c.symbol, self: !!c.self, band: true, color: c.self ? SHARE_SELF : SHARE_INKS[ink++ % SHARE_INKS.length], pts, last: pts[m - 1] };
        });
        return { metric: mk, label: mLabel, unit, view: 'share', log: false, zero: null, quarters: quarters.slice(start, end + 1), lines: bands,
          ticks: [{ y: 0, label: '100%' }, { y: 0.5, label: '50%' }, { y: 1, label: '0%' }], n: m, N,
          lower: /^P\//.test(mLabel) ? mLabel : mLabel.toLowerCase(), ceil: null, pinned: 0, gaps: 0,
          // Quarters left off the start because some company had no figure yet.
          dropped: start, shareRefused: false };
      }
    }
    // Asked for a share and not given one: the measure does not add up, or
    // too few quarters have every company. The value view is drawn instead.
    const shareRefused = wantShare;

    // ---- the value scale -----------------------------------------------------
    const all = [];
    companies.forEach((c) => c.vals.forEach((v) => { if (ok(v)) all.push(v); }));
    // A RUNAWAY MULTIPLE IS PINNED, the Evolution card's rule: a quarter whose
    // earnings were a rounding error prints a P/E in the thousands, and one of
    // those would flatten seven companies' ordinary quarters into the floor.
    // Past 2.5 times the 90th percentile of everything on the chart, a point
    // is DRAWN at 1.25 times it. Its rank, its label and its tooltip keep the
    // true figure.
    let ceil = null;
    if ((unit === 'mult' || (mf && mf.pin)) && view === 'value' && all.length >= 8) {
      const srt = all.slice().sort((a, b) => a - b);
      const p90 = srt[Math.min(srt.length - 1, Math.floor(srt.length * 0.9))];
      if (srt[srt.length - 1] > p90 * 2.5) ceil = p90 * 1.25;
    }
    const drawn = (v) => (ceil != null && v > ceil ? ceil : v);
    let lo = all.length ? Math.min(...all) : 0, hi = all.length ? Math.max(...all.map(drawn)) : 1;
    // LOG only where every figure is positive AND the range is wide enough to
    // need it, the price chart's own rule. Net income and margins cross zero,
    // where a log scale does not exist.
    const log = view === 'value' && lo > 0 && hi / lo > 4;
    if (hi - lo < 1e-12) { lo -= Math.abs(lo) * 0.05 || 0.5; hi += Math.abs(hi) * 0.05 || 0.5; }
    const yv = (v) => (log ? (Math.log(hi) - Math.log(v)) / (Math.log(hi) - Math.log(lo)) : (hi - v) / (hi - lo));
    const yr = (r) => (N > 1 ? (r - 1) / (N - 1) : 0.5);
    const zero = view === 'value' && !log && lo < 0 && hi > 0 ? yv(0) : null;

    const lines = companies.map((c, k) => {
      const pts = c.vals.map((v, i) => (ok(v)
        ? { i, v, rank: ranks[k][i], y: view === 'rank' ? yr(ranks[k][i]) : yv(drawn(v)), pinned: ceil != null && v > ceil } : null));
      let last = null;
      for (let i = n - 1; i >= 0 && !last; i--) if (pts[i]) last = pts[i];
      return { symbol: c.symbol, name: c.name || c.symbol, self: !!c.self, pts, last };
    });

    let ticks = view === 'rank'
      ? Array.from({ length: N }, (_, r) => ({ y: yr(r + 1), label: String(r + 1) }))
      : [{ y: 0, label: fmt(unit, hi) }]
        .concat(zero != null && zero > 0.12 && zero < 0.88 ? [{ y: zero, label: unit === 'pct' || unit === 'ret' ? '0%' : '$0' }] : [])
        .concat([{ y: 1, label: fmt(unit, lo) }]);
    // EVENLY SPACED GRIDLINES for a host that asks (the Lines card, a poster
    // with room for them). Spaced in the DRAWN scale, so on a log axis the
    // labels are the values at equal distances rather than equal steps.
    if (opt && opt.grid && view === 'value') {
      const inv = (y) => (log ? Math.exp(Math.log(hi) - y * (Math.log(hi) - Math.log(lo))) : hi - y * (hi - lo));
      const g = opt.grid;
      // A percentage axis spanning twenty points or more is labelled in whole
      // numbers: '+14.2%' on a gridline claims a precision a gridline does not have.
      const whole = (unit === 'pct' || unit === 'ret') && !log && hi - lo >= 20;
      const ax = (v) => (whole ? (Math.round(v) === 0 ? '0%' : (unit === 'ret' && v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v)).toLocaleString('en-US') + '%') : fmt(unit, v));
      ticks = Array.from({ length: g + 1 }, (_, k) => ({ y: k / g, label: ax(inv(k / g)) }));
      if (zero != null && ticks.every((t) => Math.abs(t.y - zero) > 0.07)) {
        ticks.push({ y: zero, label: unit === 'pct' || unit === 'ret' ? '0%' : '$0' });
      }
    }

    return { metric: mk, label: mLabel, unit, view, log, zero, quarters, lines, ticks, n, N,
      // 'revenue', 'market value' -- but an initialism keeps its capitals.
      lower: /^P\//.test(mLabel) ? mLabel : mLabel.toLowerCase(),
      ceil, pinned: lines.reduce((t, l) => t + l.pts.filter((p) => p && p.pinned).length, 0), shareRefused, dropped: 0,
      // How many quarter-cells have no figure, so a host can say so.
      gaps: lines.reduce((t, l) => t + l.pts.filter((p) => !p).length, 0) };
  }

  // WHAT THE MEASURE IS, in words, defined once so the page and the card
  // cannot describe the same chart two ways. Plain text; the host escapes it.
  function measureNote(model, data) {
    const basis = (data && data.capBasis) || {};
    const syms = model.lines.map((l) => l.symbol);
    const filed = syms.filter((s) => basis[s] === 'filed').length;
    // KEPT SHORT: it is the first sentence of a note on a card that cannot scroll.
    const shares = filed === syms.length && syms.length ? 'the share count filed each quarter, adjusted for splits'
      : filed === 0 ? 'today’s share count, which reads a past buyback low'
        : 'the filed share count for ' + filed + ' of ' + syms.length + ' companies and today’s for the rest';
    if (model.metric === 'cap') return 'Market value is each quarter’s close times ' + shares + '. ';
    if (model.metric === 'ps') {
      return 'P/S is market value over trailing revenue, on ' + shares + '. '
        + (model.pinned ? model.pinned + (model.pinned === 1 ? ' point above ' : ' points above ') + fmt('mult', model.ceil)
          + (model.pinned === 1 ? ' is' : ' are') + ' drawn at the top of the scale. ' : '');
    }
    if (model.metric === 'pe') {
      return 'P/E is market value over trailing earnings, on ' + shares + '. A loss has no multiple, so the line breaks there. '
        + (model.pinned ? model.pinned + (model.pinned === 1 ? ' point above ' : ' points above ') + fmt('mult', model.ceil)
          + (model.pinned === 1 ? ' is' : ' are') + ' drawn at the top of the scale. ' : '');
    }
    return 'Each point is the trailing twelve months to the latest quarter that company had ended by that date, from its own filings. ';
  }

  // What the share view is, in words, defined once for both hosts.
  function shareNote(model) {
    if (model.view !== 'share') {
      return model.shareRefused ? 'Share of the group is drawn for revenue and market value, and only where at least ' + SHARE_MIN_QUARTERS + ' quarters in a row have a figure for every company; this is the value view instead. ' : '';
    }
    return 'Each band is one company\u2019s share of these ' + model.N + ' companies\u2019 combined ' + model.lower + ', not of the industry. '
      + (model.dropped ? 'It starts at the first quarter all ' + model.N + ' have a figure. ' : '')
      + 'A band can narrow while the company grows, if the others grew faster. ';
  }

  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // One SVG at its true pixel size -- never stretched, so text and dots are
  // safe inside it. The host supplies the size and styles the classes:
  //   pt-grid  pt-zero  pt-peer  pt-self  pt-dot  pt-ax  pt-lab
  // o: { w, h, left, right, fs, nameMax }
  // HOW MUCH ROOM THE WORDS NEED, so a host can give the rest to the plot.
  // The card used to reserve a fixed 318px for the names at the right and
  // 80px for the axis at the left: enough for the longest label there could
  // be, which on most cards left a blank strip down the right-hand side and,
  // with a six-figure axis label, still clipped the dollar sign on the left
  // (the owner, 2026-10-10: "this chart has a lot of space on the right").
  //
  // An ESTIMATE, since nothing here can measure text: characters times a
  // width per character for each face, a little generous, so the worst case
  // is a few spare pixels rather than a clipped name. The host passes its
  // old fixed values as ceilings.
  //   o: { fs, nameMax, stack, maxLeft, maxRight }
  function fit(model, o) {
    const fs = o.fs || 12, max = o.nameMax || 18;
    const SANS = 0.6, MONO = 0.62;
    let right = 0;
    for (const l of model.lines) {
      if (!l.last) continue;
      const nm = l.name.length > max ? max : l.name.length;
      const rank = model.view === 'rank' ? ('#' + l.last.rank + '  ').length : 0;
      const figW = (model.view === 'share' ? fmtShare(l.last.share) : fmt(model.unit, l.last.v)).length * fs * MONO;
      const nameW = (rank + nm) * fs * SANS;
      right = Math.max(right, o.stack ? Math.max(nameW, figW) : nameW + 8 + figW);
    }
    let left = 0;
    for (const t of model.ticks || []) left = Math.max(left, String(t.label).length * fs * MONO);
    // 12 is the gap svg() leaves before a name, 8 the one before an axis label.
    return { left: Math.min(o.maxLeft || 1e9, Math.ceil(left + 8 + 6)), right: Math.min(o.maxRight || 1e9, Math.ceil(right + 12 + 10)) };
  }

  function svg(model, o) {
    const w = o.w, h = o.h, fs = o.fs || 12;
    const x0 = o.left, x1 = w - o.right, y0 = fs, y1 = h - fs * 2.4;
    const n = model.n;
    if (!model.lines.length || n < 2) return '';
    const X = (i) => x0 + (i / (n - 1)) * (x1 - x0);
    const Y = (y) => y0 + y * (y1 - y0);
    const unit = model.unit;
    let out = '<svg class="pt-svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img">';

    // gridlines and the left axis
    for (const t of model.ticks) {
      out += '<line class="pt-grid" x1="' + x0 + '" x2="' + x1 + '" y1="' + Y(t.y).toFixed(1) + '" y2="' + Y(t.y).toFixed(1) + '"/>'
        + '<text class="pt-ax" x="' + (x0 - 8) + '" y="' + (Y(t.y) + fs * 0.34).toFixed(1) + '" text-anchor="end" font-size="' + fs + '">' + esc(t.label) + '</text>';
    }
    if (model.zero != null) {
      out += '<line class="pt-zero" x1="' + x0 + '" x2="' + x1 + '" y1="' + Y(model.zero).toFixed(1) + '" y2="' + Y(model.zero).toFixed(1) + '"/>';
    }
    // the quarters along the foot: about six labels, always the newest
    // A whole number of YEARS between labels where there is room for it, so the
    // axis reads Q3, Q3, Q3 rather than a different quarter each time.
    let step = Math.max(1, Math.ceil(n / (o.xLabels || 6)));
    if (step >= 3) step = Math.ceil(step / 4) * 4;
    for (let i = n - 1; i >= 0; i -= step) {
      out += '<text class="pt-ax" x="' + X(i).toFixed(1) + '" y="' + (h - fs * 0.5).toFixed(1) + '" text-anchor="'
        + 'middle' + '" font-size="' + fs + '">' + esc((o.xLabel || qLabel)(model.quarters[i])) + '</text>';
    }

    // ---- share of the group: bands, not lines ---------------------------------
    if (model.view === 'share') {
      for (const l of model.lines) {
        let top = '', foot = '';
        for (const p of l.pts) top += (top ? 'L' : 'M') + X(p.i).toFixed(1) + ' ' + Y(p.y).toFixed(1);
        for (let j = l.pts.length - 1; j >= 0; j--) foot += 'L' + X(l.pts[j].i).toFixed(1) + ' ' + Y(l.pts[j].yb).toFixed(1);
        const col = (o.colors && o.colors[l.symbol]) || l.color;
        // Inline, because this markup also travels through the PNG export.
        out += '<path class="pt-band" style="fill:' + col + ';fill-opacity:' + (l.self ? '0.95' : '0.78') + ';stroke:#0b0e14;stroke-width:1" d="' + top + foot + 'Z">'
          + '<title>' + esc(l.name + ' \u00b7 ' + fmtShare(l.last.share) + ' of the group in ' + qLabel(model.quarters[l.last.i]) + ' \u00b7 ' + fmt(unit, l.last.v)) + '</title></path>';
      }
      // The names beside the middle of each band's right-hand edge, spread so
      // none overprints, the same way the lines' names are.
      const labsS = model.lines.map((l) => ({ l, y: Y((l.last.y + l.last.yb) / 2) })).sort((a, b) => a.y - b.y);
      const gapS = fs * 1.45;
      for (let i = 1; i < labsS.length; i++) if (labsS[i].y < labsS[i - 1].y + gapS) labsS[i].y = labsS[i - 1].y + gapS;
      const overS = labsS.length ? labsS[labsS.length - 1].y - y1 : 0;
      if (overS > 0) {
        labsS[labsS.length - 1].y -= overS;
        for (let i = labsS.length - 2; i >= 0; i--) if (labsS[i].y > labsS[i + 1].y - gapS) labsS[i].y = labsS[i + 1].y - gapS;
      }
      const maxS = o.nameMax || 18;
      for (const { l, y } of labsS) {
        const nm = l.name.length > maxS ? l.name.slice(0, maxS - 1).trimEnd() + '\u2026' : l.name;
        const col = (o.colors && o.colors[l.symbol]) || l.color;
        out += '<text class="pt-lab ' + (l.self ? 'pt-self' : 'pt-peer') + '" style="fill:' + col + '" x="' + (x1 + 12) + '" y="' + (y + fs * 0.34).toFixed(1) + '" font-size="' + fs + '">'
          + esc(nm) + '<tspan class="pt-fig" style="fill:' + col + '" dx="8">' + esc(fmtShare(l.last.share)) + '</tspan></text>';
      }
      return out + '</svg>';
    }

    // the lines: peers first, the company itself last so it is never crossed out
    const order = model.lines.filter((l) => !l.self).concat(model.lines.filter((l) => l.self));
    for (const l of order) {
      let d = '', pen = false;
      for (const p of l.pts) {
        if (!p) { pen = false; continue; }      // a gap breaks the line, never joins across it
        d += (pen ? 'L' : 'M') + X(p.i).toFixed(1) + ' ' + Y(p.y).toFixed(1);
        pen = true;
      }
      // A COLOUR PER LINE where the host hands one over (the Lines card, which
      // has no company of its own to single out). Inline, because that markup
      // also travels through the PNG export.
      const col = o.colors && o.colors[l.symbol];
      const cls = col ? 'pt-col' : l.self ? 'pt-self' : 'pt-peer';
      const sty = col ? ' style="stroke:' + col + '"' : '';
      out += '<path class="' + cls + '"' + sty + ' d="' + d + '"><title>' + esc(l.name) + '</title></path>';
      // Dots on every line in the rank view, where a place is a discrete
      // thing; in the value view only on the company, or seven lines of dots
      // bury the lines themselves.
      if (model.view === 'rank' || l.self) {
        for (const p of l.pts) {
          if (!p) continue;
          out += '<circle class="pt-dot ' + cls + '" cx="' + X(p.i).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="' + (l.self ? o.dot || 4 : (o.dot || 4) * 0.72).toFixed(1) + '">'
            + '<title>' + esc(l.name + ' · ' + qLabel(model.quarters[p.i]) + ' · ' + fmt(unit, p.v) + ' · #' + p.rank + ' of ' + model.N) + '</title></circle>';
        }
      }
    }

    // ---- the names, at the right-hand end -------------------------------------
    // Each sits beside its own last point, then they are spread so no two
    // overprint: sorted by height, pushed down to a minimum gap, and the whole
    // stack pulled back up if it ran past the foot.
    const labs = model.lines.filter((l) => l.last).map((l) => ({ l, y: Y(l.last.y) })).sort((a, b) => a.y - b.y);
    // STACKED (the Lines card): the figure sits UNDER the name rather than
    // beside it, which halves the width a label needs and gives it to the
    // plot. Each label is then two lines tall, so the gap doubles.
    const gap = o.stack ? fs * 2.5 : fs * 1.45;
    for (let i = 1; i < labs.length; i++) if (labs[i].y < labs[i - 1].y + gap) labs[i].y = labs[i - 1].y + gap;
    const over = labs.length ? labs[labs.length - 1].y - y1 : 0;
    if (over > 0) {
      labs[labs.length - 1].y -= over;
      for (let i = labs.length - 2; i >= 0; i--) if (labs[i].y > labs[i + 1].y - gap) labs[i].y = labs[i + 1].y - gap;
    }
    const max = o.nameMax || 18;
    for (const { l, y } of labs) {
      const nm = l.name.length > max ? l.name.slice(0, max - 1).trimEnd() + '…' : l.name;
      const fig = model.view === 'rank' ? '#' + l.last.rank + '  ' : '';
      const col = o.colors && o.colors[l.symbol];
      out += '<text class="pt-lab ' + (col ? 'pt-col' : l.self ? 'pt-self' : 'pt-peer') + '"' + (col ? ' style="fill:' + col + '"' : '')
        + ' x="' + (x1 + 12) + '" y="' + (y + fs * (o.stack ? -0.18 : 0.34)).toFixed(1) + '" font-size="' + fs + '">'
        + esc(fig + nm) + '<tspan class="pt-fig"' + (col ? ' style="fill:' + col + '"' : '')
        + (o.stack ? ' x="' + (x1 + 12) + '" dy="' + (fs * 1.12).toFixed(1) + '"' : ' dx="8"') + '>' + esc(fmt(unit, l.last.v)) + '</tspan></text>';
    }
    return out + '</svg>';
  }

  global.PeerTrend = { METRICS, LINE_METRICS, VIEWS, SHARE_METRICS, viewsFor, build, svg, fit, fmt, fmtShare, qLabel, measureNote, shareNote };
})(typeof window !== 'undefined' ? window : globalThis);
