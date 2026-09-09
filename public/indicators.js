// Tunable short-horizon indicators, defined once.
//
// Loaded as a plain <script> by /lab and required() by server.js and the offline
// grid, the same arrangement screens.js and signal-stats.js have. Three surfaces
// compute these — a chart pane, a live statistics panel, and a cross-sectional
// grid built against the local SQLite copy — and a second implementation of
// "vol-normalised 10-day return" would have drifted from the first within a week.
//
// Series are OLDEST-FIRST here, unlike momentum.js which works newest-first
// because that is the shape the API returns. Charts and rolling windows both
// read forward, and flipping once at the boundary is cheaper than reasoning
// about a reversed index in every loop below.
//
// Every indicator returns an array the same length as its input, with `null`
// wherever there is not yet enough history. A null must break a line rather
// than be drawn as zero — the same rule the moving averages follow.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Indicators = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

  // Annualised realised volatility of log returns, as a percentage — the same
  // definition and the same 252 as momentum.js, so an indicator built here is
  // in the same units as the risk-adjusted factors already in the score.
  // Verified equal to Momentum.realisedVol on the same window.
  function realisedVolSeries(closes, window) {
    const n = closes.length;
    const out = new Array(n).fill(null);
    const r = new Array(n).fill(null);
    for (let i = 1; i < n; i++) {
      const a = num(closes[i]), b = num(closes[i - 1]);
      if (a > 0 && b > 0) r[i] = Math.log(a / b);
    }
    let sum = 0, sumsq = 0, count = 0;
    for (let i = 1; i < n; i++) {
      if (r[i] != null) { sum += r[i]; sumsq += r[i] * r[i]; count++; }
      const drop = i - window;
      if (drop >= 1 && r[drop] != null) { sum -= r[drop]; sumsq -= r[drop] * r[drop]; count--; }
      // The FULL window is required, which is where this deliberately differs
      // from momentum.js. That function scores one date from whatever history
      // it has; this one draws a line, and a line whose early points were
      // computed over 20 returns and whose later ones use 126 is not the same
      // measurement along its length. Blank until it can be done properly —
      // callers fetch run-up for exactly this reason.
      if (count < Math.max(20, window)) continue;
      const varc = (sumsq - sum * sum / count) / (count - 1);
      if (varc > 0) out[i] = Math.sqrt(varc * 252) * 100;
    }
    return out;
  }

  // Percentage return over `lookback` sessions, ending `skip` sessions ago.
  // `skip` is the 12-1 trick at a short horizon: the most recent few days are
  // where reversal lives, so leaving them out is the standard way to ask for
  // continuation without buying the bounce.
  function windowReturn(closes, lookback, skip) {
    const n = closes.length;
    const out = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      const end = i - skip, start = i - skip - lookback;
      if (start < 0) continue;
      const a = num(closes[end]), b = num(closes[start]);
      if (a == null || b == null || b === 0) continue;
      out[i] = (a - b) / b * 100;
    }
    return out;
  }

  // Exponential smoothing. span 1 is a no-op, which is the default: smoothing is
  // something to reach for deliberately, not to have applied silently.
  function ema(values, span) {
    if (!(span > 1)) return values.slice();
    const k = 2 / (span + 1);
    const out = new Array(values.length).fill(null);
    let prev = null;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v == null) { continue; }
      prev = prev == null ? v : v * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  const DEFAULTS = { lookback: 10, skip: 0, volWindow: 60, smooth: 1 };

  const BOUNDS = {
    lookback: { min: 2, max: 40, label: 'Lookback', unit: ' sessions',
      help: 'How far back the return is measured. Below about five days you are measuring noise; above twenty you are measuring the medium term the score already covers.' },
    skip: { min: 0, max: 10, label: 'Skip', unit: ' sessions',
      help: 'Sessions left out at the recent end. This is what 12-1 momentum does with its final month — the most recent days are where reversal lives.' },
    volWindow: { min: 20, max: 126, label: 'Vol window', unit: ' sessions',
      help: 'The window the volatility is measured over. Shorter reacts faster and is noisier; 126 is what the momentum score uses.' },
    smooth: { min: 1, max: 15, label: 'Smoothing', unit: '-day EMA',
      help: 'Exponential smoothing of the finished indicator. 1 is off.' },
  };

  function clean(p) {
    const out = {};
    for (const k of Object.keys(DEFAULTS)) {
      const b = BOUNDS[k];
      const v = Math.round(Number(p && p[k]));
      out[k] = Number.isFinite(v) ? Math.min(b.max, Math.max(b.min, v)) : DEFAULTS[k];
    }
    return out;
  }

  // The indicator itself: a short-horizon return divided by the stock's own
  // volatility, so a 4% week in a utility and in CRWV are comparable numbers.
  // Dimensionless, which is the property that lets one threshold mean the same
  // thing across the universe — the same reasoning behind the risk-adjusted
  // factors in the momentum score.
  function velocity(closes, params) {
    const p = clean(params);
    const ret = windowReturn(closes, p.lookback, p.skip);
    const vol = realisedVolSeries(closes, p.volWindow);
    const raw = closes.map((_, i) =>
      (ret[i] == null || vol[i] == null || !(vol[i] > 0) ? null : ret[i] / vol[i]));
    return ema(raw, p.smooth);
  }

  // How many leading values are null for a given parameter set, so a caller can
  // ask for enough run-up rather than discovering a blank chart.
  function warmup(p) {
    const c = clean(p);
    return Math.max(c.lookback + c.skip, c.volWindow) + 1;
  }

  const INDICATORS = [{
    id: 'velocity',
    label: 'Risk-adjusted velocity',
    blurb: 'A short-horizon return divided by the stock’s own volatility. ' +
      'The missing short end of the ladder already in the momentum score, which ' +
      'risk-adjusts at 3, 6 and 12 months and at nothing below that.',
    compute: velocity,
    params: Object.keys(DEFAULTS),
  }];

  const byId = (id) => INDICATORS.find((x) => x.id === id) || INDICATORS[0];

  return { INDICATORS, byId, DEFAULTS, BOUNDS, clean, warmup,
    velocity, realisedVolSeries, windowReturn, ema };
});
