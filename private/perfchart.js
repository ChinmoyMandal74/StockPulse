// Growth and profitability: revenue and net income as bars, net margin as a
// line, period by period. Asked for by the owner from a broker's chart, in
// the knowledge that this app has refused a second y-axis before.
//
// WHY A SECOND AXIS IS TOLERABLE HERE AND WAS NOT ON THE PRICE CHART. The
// objection is that two independent scales can be slid until any two series
// appear to track. These are not independent: the line IS the second bar
// divided by the first. So nothing can be made to "track" that the bars do
// not already say, and four rules keep the rest honest:
//
//   1. THE BARS ARE ZERO-BASED, always. A bar is read as a quantity.
//   2. THE LINE KEEPS ITS OWN RANGE and the host says so -- a line is read
//      as a shape -- EXCEPT where a margin is negative. Then both axes share
//      ONE zero line, or a loss-making quarter would be drawn above the zero
//      its own bar hangs below.
//   3. EVERY MARGIN IS PRINTED under its period, so the line can be checked
//      against a number rather than against an axis.
//   4. The margin axis is drawn in the line's colour, the money axis is not.
//
// Pure: no DOM, no fetch, no requires. Loaded with a <script> tag by
// stock.html and promo.html and require()d by server.js; cards.js reads it
// off the global lazily, the way it reads PeerTrend.
//
// Input, oldest first, as the server's perfOf() shapes it:
//   { quarterly: [{ d, fp, rev, ni, dv }], annual: [...] }
(function (global) {
  'use strict';

  const MODES = [['quarterly', 'Quarterly'], ['annual', 'Annual']];
  const ok = (v) => v != null && isFinite(v);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // 1, 2, 2.5 or 5 times a power of ten, at or above x.
  function niceCeil(x) {
    if (!(x > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(x)));
    const f = x / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  // ONE UNIT DOWN AN AXIS, the statements card's rule: $1.2B above $985.0M
  // is a comparison the eye has to make twice.
  function unitFor(hi) {
    const a = Math.abs(hi);
    return a >= 1e12 ? [1e12, 'T'] : a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e3 ? [1e3, 'K'] : [1, ''];
  }
  function fmtMoney(v, unit) {
    if (!ok(v)) return '—';
    if (v === 0) return '$0';
    const [d, u] = unit || unitFor(v);
    const a = Math.abs(v) / d;
    return (v < 0 ? '−' : '') + '$' + a.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : 2) + u;
  }
  const fmtPct = (v) => (ok(v) ? (v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%' : '—');

  function build(data, modeKey, count) {
    const mode = modeKey === 'annual' ? 'annual' : 'quarterly';
    const n = Math.max(2, Math.min(12, Number(count) || 5));
    // A period with no revenue has no margin and nothing to measure the
    // other bar against, so it is not a column at all.
    const rows = ((data && data[mode]) || []).filter((r) => r && r.d && ok(r.rev) && r.rev > 0).slice(-n);
    const periods = rows.map((r) => {
      // Rejected before it is coerced: Number(null) is 0, and a missing net
      // income drawn as a zero bar is a claim nobody filed.
      const ni = ok(r.ni) ? Number(r.ni) : null;
      const m = Number(String(r.d).slice(5, 7));
      return { d: r.d, top: mode === 'annual' ? 'FY' : (r.fp || ''), bot: (MON[m - 1] || '') + ' ’' + String(r.d).slice(2, 4),
        rev: Number(r.rev), ni, pm: ni == null ? null : ni / Number(r.rev) * 100, dv: !!r.dv };
    });
    const model = { mode, periods, n: periods.length, usable: periods.length >= 2 && periods.some((p) => p.ni != null) };
    if (!model.usable) return model;

    // ---- the money axis: zero-based, whatever the data ----------------------
    const K = 4;                                            // intervals above zero
    const maxM = Math.max(...periods.map((p) => Math.max(p.rev, p.ni || 0)));
    const minM = Math.min(0, ...periods.map((p) => (p.ni == null ? 0 : p.ni)));
    const step = niceCeil(maxM / K);
    const hi = step * K;
    const below = minM < 0 ? Math.ceil(-minM / step - 1e-9) : 0;   // whole steps under zero
    const lo = -below * step;
    const unit = unitFor(hi);
    const yM = (v) => (hi - v) / (hi - lo);
    const moneyTicks = [];
    for (let k = -below; k <= K; k++) moneyTicks.push({ v: k * step, y: yM(k * step), label: fmtMoney(k * step, unit) });

    // ---- the margin axis ------------------------------------------------------
    const pms = periods.map((p) => p.pm).filter(ok);
    const pMin = Math.min(...pms), pMax = Math.max(...pms);
    let yP, pmTicks, aligned = false;
    if (pMin < 0) {
      // SHARED ZERO. The margin scale is the money scale times a constant, so
      // zero is one line for both and a loss sits below it on both. A
      // negative margin means a negative net income, so lo is below zero.
      aligned = true;
      // Rounded UP to a constant that puts round percentages on the gridlines.
      const c = niceCeil(Math.max(pMax > 0 ? pMax / hi : 0, pMin / lo) * step) / step;
      yP = (v) => yM(v / c);
      pmTicks = moneyTicks.map((t) => ({ y: t.y, label: fmtPct(t.v * c) }));
    } else {
      // ITS OWN RANGE, on round numbers that land on the bars' gridlines.
      const ticksN = moneyTicks.length - 1;
      let st = niceCeil(Math.max(pMax - pMin, 0.5) / (ticksN - 0.6));
      let a = Math.max(0, Math.floor(pMin / st) * st);
      while (a + st * ticksN < pMax + st * 0.15) { st = niceCeil(st * 1.01); a = Math.max(0, Math.floor(pMin / st) * st); }
      const b = a + st * ticksN;
      yP = (v) => (b - v) / (b - a);
      pmTicks = moneyTicks.map((t, i) => ({ y: t.y, label: fmtPct(a + st * i) }));
      model.pmFrom = a;
    }
    const last = periods[periods.length - 1];
    return Object.assign(model, { hi, lo, unit, yM, yP, moneyTicks, pmTicks, aligned,
      last, anyDerived: periods.some((p) => p.dv), anyLoss: periods.some((p) => p.ni != null && p.ni < 0) });
  }

  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // One SVG at its TRUE pixel size, so text inside it is safe.
  //   pc-grid pc-zero pc-rev pc-ni pc-dv pc-line pc-dot pc-axp pc-axm pc-x pc-x2 pc-mv
  // o: { w, h, left, right, fs, colors: { rev, ni, pm } }  -- colours are
  // emitted inline when given (a card resolves them per ground) and left to
  // the host's stylesheet when not.
  function svg(model, o) {
    if (!model || !model.usable) return '';
    const w = o.w, h = o.h, fs = o.fs || 12, col = o.colors || {};
    const x0 = o.left, x1 = w - o.right, y0 = fs * 0.9, y1 = h - fs * 5.2;
    const n = model.n, band = (x1 - x0) / n;
    const Y = (f) => y0 + f * (y1 - y0);
    const bw = Math.min(band * 0.27, fs * 4.6), gap = Math.max(2, bw * 0.12);
    const fillOf = (k) => (col[k] ? ' fill="' + col[k] + '"' : '');
    const strokeOf = (k) => (col[k] ? ' stroke="' + col[k] + '"' : '');
    let out = '<svg class="pc-svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img">';

    model.moneyTicks.forEach((t, i) => {
      const y = Y(t.y).toFixed(1);
      out += '<line class="' + (t.v === 0 ? 'pc-zero' : 'pc-grid') + '" x1="' + x0 + '" x2="' + x1 + '" y1="' + y + '" y2="' + y + '"/>'
        + '<text class="pc-axm" x="' + (x1 + 8) + '" y="' + (Y(t.y) + fs * 0.34).toFixed(1) + '" font-size="' + fs + '">' + esc(t.label) + '</text>'
        + '<text class="pc-axp" x="' + (x0 - 8) + '" y="' + (Y(t.y) + fs * 0.34).toFixed(1) + '" text-anchor="end" font-size="' + fs + '"' + fillOf('pm') + '>'
        + esc(model.pmTicks[i].label) + '</text>';
    });

    const zeroY = Y(model.yM(0));
    const bar = (cls, key, x, v, p, name) => {
      const yv = Y(model.yM(v));
      const top = Math.min(yv, zeroY), ht = Math.max(1.5, Math.abs(yv - zeroY));
      return '<rect class="' + cls + (p.dv ? ' pc-dv' : '') + '" x="' + x.toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + bw.toFixed(1)
        + '" height="' + ht.toFixed(1) + '" rx="' + Math.min(3, bw / 6).toFixed(1) + '"' + fillOf(key) + (p.dv ? strokeOf(key) : '') + '>'
        + '<title>' + esc(name + ' · ' + (p.top ? p.top + ' · ' : '') + 'to ' + p.d + ' · ' + fmtMoney(v)
          + (p.dv ? ' · computed from the cumulative filings' : '')) + '</title></rect>';
    };
    let d = '', pen = false, dots = '';
    model.periods.forEach((p, i) => {
      const cx = x0 + band * (i + 0.5);
      out += bar('pc-rev', 'rev', cx - gap / 2 - bw, p.rev, p, 'Revenue');
      if (p.ni != null) out += bar('pc-ni', 'ni', cx + gap / 2, p.ni, p, 'Net income');
      out += '<text class="pc-x" x="' + cx.toFixed(1) + '" y="' + (y1 + fs * 1.55).toFixed(1) + '" text-anchor="middle" font-size="' + fs + '">' + esc(p.top || p.bot) + '</text>'
        + (p.top ? '<text class="pc-x2" x="' + cx.toFixed(1) + '" y="' + (y1 + fs * 2.8).toFixed(1) + '" text-anchor="middle" font-size="' + (fs * 0.88).toFixed(1) + '">' + esc(p.bot) + '</text>' : '')
        + '<text class="pc-mv" x="' + cx.toFixed(1) + '" y="' + (y1 + fs * 4.45).toFixed(1) + '" text-anchor="middle" font-size="' + fs + '"' + fillOf('pm') + '>' + esc(fmtPct(p.pm)) + '</text>';
      if (p.pm == null) { pen = false; return; }          // a gap breaks the line
      const py = Y(model.yP(p.pm));
      d += (pen ? 'L' : 'M') + cx.toFixed(1) + ' ' + py.toFixed(1);
      pen = true;
      dots += '<circle class="pc-dot" cx="' + cx.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="' + (o.dot || fs * 0.36).toFixed(1) + '"' + strokeOf('pm') + '>'
        + '<title>' + esc('Net margin · to ' + p.d + ' · ' + fmtPct(p.pm)) + '</title></circle>';
    });
    // The line goes over the bars, and its dots over the line.
    out += '<path class="pc-line" d="' + d + '"' + strokeOf('pm') + '/>' + dots;
    return out + '</svg>';
  }

  global.PerfChart = { MODES, build, svg, fmtMoney, fmtPct };
})(typeof window !== 'undefined' ? window : globalThis);
