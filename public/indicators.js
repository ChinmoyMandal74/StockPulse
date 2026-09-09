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
//
// An indicator is handed the whole bundle — `{ closes, score, dates }` — and
// takes what it needs. That is why `compute` does not simply take closes: the
// slope indicator reads the momentum score, which is different data with a
// different start date, and threading two signatures through three surfaces
// would have been worse than one bundle everywhere.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Indicators = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // `Number(null)` is 0 and `Number('')` is 0, both of which are finite — so the
  // obvious one-liner turned every missing value into a real zero. It never
  // showed while the only input was closes, which are never null; the moment the
  // score series arrived, with 273 blank sessions before a symbol is scoreable
  // at all, slopes were being fitted from a fabricated 0 up to the first real
  // reading. Reject the empties before coercing, not after.
  const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

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

  // Least-squares slope over a rolling window, in units per session.
  //
  // This is the honest version of a two-point difference. `score[t] − score[t−10]`
  // reads exactly two observations and throws the eight between them away, so
  // one noisy endpoint moves the whole answer. A fitted slope uses every point
  // in the window, which is the entire reason to prefer it.
  //
  // The window must be complete: a slope fitted through a gap is a different
  // measurement wearing the same name, and momentum_history has no score at all
  // until a symbol has MIN_BARS of run-up behind it.
  function rollingSlope(values, window, skip) {
    const n = values.length;
    const out = new Array(n).fill(null);
    if (!(window >= 2)) return out;
    // x is fixed 0..window-1 for every fit, so its moments are constants.
    const xbar = (window - 1) / 2;
    let sxx = 0;
    for (let k = 0; k < window; k++) sxx += (k - xbar) * (k - xbar);
    if (!(sxx > 0)) return out;

    for (let i = 0; i < n; i++) {
      const end = i - skip, start = end - window + 1;
      if (start < 0) continue;
      let sxy = 0, ok = true;
      for (let k = 0; k < window; k++) {
        const y = num(values[start + k]);
        if (y == null) { ok = false; break; }
        sxy += (k - xbar) * y;
      }
      if (ok) out[i] = sxy / sxx;
    }
    return out;
  }

  // Wilder's RSI at every date. Oldest-first here, where momentum.js works
  // newest-first — verified equal to Momentum.rsiSeriesAt, which is itself
  // checked against the screener's own RSI column to four decimals.
  //
  // Wilder is recursive from a seed, so this is one forward pass: a simple
  // average of the first `period` changes, then smoothed. The first value lands
  // at index `period`; before that there is nothing to seed from.
  function rsiSeries(closes, period) {
    const n = closes.length;
    const out = new Array(n).fill(null);
    if (n < period + 1 || period < 2) return out;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
      const a = num(closes[i]), b = num(closes[i - 1]);
      if (a == null || b == null) return out;
      const d = a - b;
      if (d >= 0) gains += d; else losses -= d;
    }
    let ag = gains / period, al = losses / period;
    out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    for (let i = period + 1; i < n; i++) {
      const a = num(closes[i]), b = num(closes[i - 1]);
      if (a == null || b == null) continue;
      const d = a - b;
      ag = (ag * (period - 1) + Math.max(d, 0)) / period;
      al = (al * (period - 1) + Math.max(-d, 0)) / period;
      out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
    return out;
  }

  // Shift a series back by `skip` sessions, so an indicator can be read as it
  // stood a few days ago without every indicator implementing the same offset.
  function lag(values, skip) {
    if (!(skip > 0)) return values.slice();
    const out = new Array(values.length).fill(null);
    for (let i = skip; i < values.length; i++) out[i] = values[i - skip];
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

  // Every knob any indicator can offer. Each indicator names the ones it uses,
  // so the page renders its sliders from this without knowing anything else.
  const BOUNDS = {
    lookback: { min: 2, max: 40, label: 'Lookback', unit: ' sessions',
      help: 'How far back the return is measured. Below about five days you are measuring noise; above twenty you are measuring the medium term the score already covers.' },
    window: { min: 5, max: 60, label: 'Fit window', unit: ' sessions',
      help: 'How many sessions the slope is fitted through. Every one of them counts toward the answer, which is the difference from a two-point delta.' },
    skip: { min: 0, max: 10, label: 'Skip', unit: ' sessions',
      help: 'Sessions left out at the recent end. This is what 12-1 momentum does with its final month — the most recent days are where reversal lives.' },
    volWindow: { min: 20, max: 126, label: 'Vol window', unit: ' sessions',
      help: 'The window the volatility is measured over. Shorter reacts faster and is noisier; 126 is what the momentum score uses.' },
    period: { min: 2, max: 50, label: 'Period', unit: ' sessions',
      help: 'Wilder’s RSI period. 14 is the convention and what the screener’s own RSI column uses; shorter reacts faster and swings wider.' },
    smooth: { min: 1, max: 15, label: 'Smoothing', unit: '-day EMA',
      help: 'Exponential smoothing of the finished indicator. 1 is off.' },
  };

  const INDICATORS = [
    {
      id: 'velocity',
      label: 'Risk-adjusted velocity',
      needs: 'closes',
      blurb: 'A short-horizon return divided by the stock’s own volatility. ' +
        'The missing short end of the ladder already in the momentum score, which ' +
        'risk-adjusts at 3, 6 and 12 months and at nothing below that.',
      params: ['lookback', 'skip', 'volWindow', 'smooth'],
      defaults: { lookback: 10, skip: 0, volWindow: 60, smooth: 1 },
      compute(series, p) {
        const ret = windowReturn(series.closes, p.lookback, p.skip);
        const vol = realisedVolSeries(series.closes, p.volWindow);
        const raw = series.closes.map((_, i) =>
          (ret[i] == null || vol[i] == null || !(vol[i] > 0) ? null : ret[i] / vol[i]));
        return ema(raw, p.smooth);
      },
      warmup: (p) => Math.max(p.lookback + p.skip, p.volWindow) + 1,
    },
    {
      id: 'scoreSlope',
      label: 'Momentum score slope',
      needs: 'score',
      blurb: 'The least-squares slope of the momentum score, in points per session. ' +
        'The honest version of Mom. Delta, which reads two observations and discards ' +
        'everything between them. No volatility normaliser is needed and that is not an ' +
        'oversight: the score has been on a fixed absolute scale since September, so a ' +
        'slope of 0.4 points a session means the same thing for every stock — which it ' +
        'would not while the score was a percentile.',
      params: ['window', 'skip', 'smooth'],
      defaults: { window: 20, skip: 0, smooth: 1 },
      compute(series, p) {
        if (!series.score) return series.closes.map(() => null);
        return ema(rollingSlope(series.score, p.window, p.skip), p.smooth);
      },
      warmup: (p) => p.window + p.skip + 1,
    },
  ];

  INDICATORS.push({
    id: 'rsi',
    label: 'RSI',
    needs: 'closes',
    blurb: 'Wilder’s RSI, the plain reading — not the sub-score the momentum model ' +
      'derives from it. Worth looking at with the deciles rather than the correlation: ' +
      'the hypothesis about RSI is that both ends matter and the middle does not, and a ' +
      'correlation measures a straight line, so a U would cancel itself out and report zero.',
    params: ['period', 'skip', 'smooth'],
    defaults: { period: 14, skip: 0, smooth: 1 },
    compute(series, p) {
      return ema(lag(rsiSeries(series.closes, p.period), p.skip), p.smooth);
    },
    warmup: (p) => p.period + p.skip + 1,
  });

  const byId = (id) => INDICATORS.find((x) => x.id === id) || INDICATORS[0];

  // Clamped to the bounds of whichever indicator is asking, and anything it does
  // not use is dropped — a stale `volWindow` left over from switching indicator
  // must not travel into a grid lookup and match the wrong row.
  function clean(p, indicatorId) {
    const ind = byId(indicatorId);
    const out = {};
    for (const k of ind.params) {
      const b = BOUNDS[k];
      const v = Math.round(Number(p && p[k]));
      out[k] = Number.isFinite(v) ? Math.min(b.max, Math.max(b.min, v)) : ind.defaults[k];
    }
    return out;
  }

  // How many leading values are null, so a caller can ask for enough run-up
  // rather than discovering a blank chart.
  function warmup(p, indicatorId) {
    const ind = byId(indicatorId);
    return ind.warmup(clean(p, indicatorId));
  }

  function compute(series, p, indicatorId) {
    const ind = byId(indicatorId);
    return ind.compute(series, clean(p, indicatorId));
  }

  return { INDICATORS, byId, BOUNDS, clean, warmup, compute,
    realisedVolSeries, windowReturn, rollingSlope, rsiSeries, lag, ema };
});
