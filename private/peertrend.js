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
  const VIEWS = [['value', 'Value'], ['rank', 'Rank']];
  const metricOf = (k) => METRICS.find((m) => m[0] === k) || METRICS[0];

  const ok = (v) => v != null && isFinite(v);

  function fmt(unit, v) {
    if (!ok(v)) return '—';
    const a = Math.abs(v), s = v < 0 ? '−' : '';
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
  function build(data, metricKey, viewKey) {
    const [mk, mLabel, unit] = metricOf(metricKey);
    const view = viewKey === 'rank' ? 'rank' : 'value';
    const quarters = (data && data.quarters) || [];
    const src = ((data && data.series) || {})[mk] || {};
    // A company with no figure in ANY quarter is not on the chart at all: it
    // has no line to draw and must not hold a rank open below the others.
    const companies = ((data && data.companies) || [])
      .map((c) => Object.assign({}, c, { vals: (src[c.symbol] || []).map((v) => (ok(v) ? Number(v) : null)) }))
      .filter((c) => c.vals.some(ok));
    const n = quarters.length, N = companies.length;

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
    if (unit === 'mult' && view === 'value' && all.length >= 8) {
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

    const ticks = view === 'rank'
      ? Array.from({ length: N }, (_, r) => ({ y: yr(r + 1), label: String(r + 1) }))
      : [{ y: 0, label: fmt(unit, hi) }]
        .concat(zero != null && zero > 0.12 && zero < 0.88 ? [{ y: zero, label: unit === 'pct' ? '0%' : '$0' }] : [])
        .concat([{ y: 1, label: fmt(unit, lo) }]);

    return { metric: mk, label: mLabel, unit, view, log, zero, quarters, lines, ticks, n, N,
      // 'revenue', 'market value' -- but an initialism keeps its capitals.
      lower: mk === 'pe' ? mLabel : mLabel.toLowerCase(),
      ceil, pinned: lines.reduce((t, l) => t + l.pts.filter((p) => p && p.pinned).length, 0),
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
    if (model.metric === 'pe') {
      return 'P/E is market value over trailing earnings, on ' + shares + '. A loss has no multiple, so the line breaks there. '
        + (model.pinned ? model.pinned + (model.pinned === 1 ? ' point above ' : ' points above ') + fmt('mult', model.ceil)
          + (model.pinned === 1 ? ' is' : ' are') + ' drawn at the top of the scale. ' : '');
    }
    return 'Each point is the trailing twelve months to the latest quarter that company had ended by that date, from its own filings. ';
  }

  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // One SVG at its true pixel size -- never stretched, so text and dots are
  // safe inside it. The host supplies the size and styles the classes:
  //   pt-grid  pt-zero  pt-peer  pt-self  pt-dot  pt-ax  pt-lab
  // o: { w, h, left, right, fs, nameMax }
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
        + 'middle' + '" font-size="' + fs + '">' + esc(qLabel(model.quarters[i])) + '</text>';
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
      const cls = l.self ? 'pt-self' : 'pt-peer';
      out += '<path class="' + cls + '" d="' + d + '"><title>' + esc(l.name) + '</title></path>';
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
    const gap = fs * 1.45;
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
      out += '<text class="pt-lab ' + (l.self ? 'pt-self' : 'pt-peer') + '" x="' + (x1 + 12) + '" y="' + (y + fs * 0.34).toFixed(1) + '" font-size="' + fs + '">'
        + esc(fig + nm) + '<tspan class="pt-fig" dx="8">' + esc(fmt(unit, l.last.v)) + '</tspan></text>';
    }
    return out + '</svg>';
  }

  global.PeerTrend = { METRICS, VIEWS, build, svg, fmt, qLabel, measureNote };
})(typeof window !== 'undefined' ? window : globalThis);
