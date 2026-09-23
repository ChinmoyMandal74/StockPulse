// Bar maths: indicators computed from a daily series and nothing else.
//
// No database, no API, no universe — which is what lets the live refresh, the
// technical row builder and the offline studies all compute the same numbers
// the same way. `values` is newest-first, [{ high, close }], the shape the app
// holds everywhere.
//
// This is what is left of momentum.js after the momentum score and the Overall
// composite were removed on 2026-09-23. The file held two unrelated things: the
// eight-factor score, which is gone, and these, which the advice engine and the
// Cushion column depend on. Splitting them out is why the removal could not
// simply delete the file.
//
//   rsiSeriesAt  -> techrow.js, and through it the advice verdicts, tech_history
//                   and both backtests. Its output is load-bearing for stored
//                   data, so it was checked byte-identical across the move.
//   realisedVol  -> the Cushion column: drop / (realisedVol / sqrt(12)).
//
// The model that used to live beside these is recoverable at the git tag
// `momentum-scoring`; docs/momentum-scoring.md says what it was and why.

'use strict';

const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };

// Annualised realised volatility, in percent, over the last `lookback`
// sessions. Log returns, sample variance, 252 trading days.
function realisedVol(v, lookback = 126) {
  const n = Math.min(v.length - 1, lookback);
  if (n < 20) return null;
  const r = [];
  for (let i = 0; i < n; i++) {
    const a = num(v[i].close), b = num(v[i + 1].close);
    if (a > 0 && b > 0) r.push(Math.log(a / b));
  }
  if (r.length < 20) return null;
  const mean = r.reduce((t, x) => t + x, 0) / r.length;
  const varc = r.reduce((t, x) => t + (x - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(varc * 252) * 100;
}

// Wilder's RSI at every date, returned newest-first to match `values`. One
// forward pass: Wilder is recursive from a seed at the oldest bar, so the same
// seed and the same increments give the same number at every step.
function rsiSeriesAt(v, period = 14) {
  const n = v.length;
  const out = new Array(n).fill(null);
  if (n < period + 1) return out;
  const c = v.map((x) => num(x.close)).reverse();      // oldest first
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = c[i] - c[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let ag = gains / period, al = losses / period;
  const put = (oldIdx, val) => { out[n - 1 - oldIdx] = val; };
  put(period, al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  for (let i = period + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
    put(i, al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  }
  return out;
}

// The newest reading alone. Kept as its own function rather than
// `rsiSeriesAt(v)[0]` because it is the hot path — every row of every refresh —
// and it agrees with the series by construction, which the tests pin.
function rsi(v, period = 14) {
  if (v.length < period + 1) return null;
  const c = v.map((x) => num(x.close)).reverse();
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = c[i] - c[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let ag = gains / period, al = losses / period;
  for (let i = period + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}

module.exports = { realisedVol, rsiSeriesAt, rsi };
