// The bar-derived row, defined once — barmath.js's shape, for the Advice
// engine's inputs rather than its score.
//
// Everything here comes from a symbol's own daily bars and nothing else: no
// database, no API, no universe, no fundamentals. That is exactly what makes a
// long backtest possible — `fundamentals_history` begins 2026-08-30, while the
// bar archive reaches 2003, so a row built from this alone can be replayed over
// twenty years with nothing imputed.
//
// WHY IT EXISTS: there were two implementations. `btRowAt` in server.js fed the
// advice backtest, and `action-backtest.js` built its own row inline for the
// 18-year study — and CLAUDE.md asserted they were the same builder. They had
// drifted in two ways that change verdicts:
//
//   * the 52-week high. This one uses the intraday HIGHS, the study used
//     CLOSES. A closing high is never above an intraday one, so the study
//     reported every stock as nearer its high than the app does — and
//     `pctFromHigh` feeds `nearHigh` (Strong Buy), `shallowEnough` (a plain
//     Buy) and `deepHole`.
//   * `volTrend` was absent from the study's row entirely, so the
//     `distribution` Avoid rule could never fire in eighteen years of it.
//
// Three callers now share this: server.js, action-backtest.js and the tech
// history builder. A fourth copy was the alternative.
'use strict';

const BarMath = require('./barmath.js');

// Wilder's RSI for a whole series, oldest-first and index-aligned with the
// arrays this module's other function takes. BarMath.rsiSeriesAt is the app's
// own implementation and wants newest-first, so the flip happens here once
// rather than at every call site.
function rsiSeries(closes) {
  const newestFirst = [];
  for (let i = closes.length - 1; i >= 0; i--) newestFirst.push({ close: Number(closes[i]) });
  return BarMath.rsiSeriesAt(newestFirst, 14).slice().reverse();
}

// One row, as of session `i`. `highs` and `vols` may be omitted — a caller with
// closes alone still gets the trend and return fields, and the ones that need
// the other two come back null rather than silently wrong.
//
// Returns null when the session has no usable close, which is the caller's
// signal to skip rather than to evaluate a hole.
function rowAt(closes, highs, vols, i) {
  const c = closes[i];
  if (!(c > 0)) return null;
  const hasHi = Array.isArray(highs) && highs.length === closes.length;
  const hasVol = Array.isArray(vols) && vols.length === closes.length;
  const sma = (n) => {
    if (i + 1 < n) return null;
    let t = 0;
    for (let k = i - n + 1; k <= i; k++) t += closes[k];
    return t / n;
  };
  const s200 = sma(200), s50 = sma(50);
  let hi = 0, lo = Infinity;
  for (let k = Math.max(0, i - 251); k <= i; k++) {
    const h = hasHi ? highs[k] : closes[k];
    if (h > hi) hi = h;
    if (closes[k] < lo) lo = closes[k];
  }
  let vsum = 0, vn = 0;
  if (hasVol) {
    for (let k = Math.max(0, i - 20); k < i; k++) { if (vols[k] > 0) { vsum += vols[k]; vn++; } }
  }
  const avgVol = vn ? vsum / vn : null;
  const vNow = hasVol ? vols[i] : 0;
  const back = (n) => (i >= n && closes[i - n] > 0 ? (c / closes[i - n] - 1) * 100 : null);
  return {
    price: c,
    vs200ma: s200 > 0 ? (c / s200 - 1) * 100 : null,
    vs50ma: s50 > 0 ? (c / s50 - 1) * 100 : null,
    oneMonthPct: back(21), threeMonthPct: back(63), sixMonthPct: back(126),
    oneYearPct: back(252), oneWeekPct: back(5), todayPct: back(1),
    pctFromHigh: hi > 0 ? (c / hi - 1) * 100 : null,
    pctFromLow: lo < Infinity && lo > 0 ? (c / lo - 1) * 100 : null,
    range52Pos: hi > lo ? ((c - lo) / (hi - lo)) * 100 : null,
    above200: s200 > 0 ? c > s200 : null,
    historyDays: i + 1,
    volX: avgVol > 0 && vNow > 0 ? vNow / avgVol : null,
    volTrend: avgVol > 0 && vNow > 0 ? (vNow / avgVol - 1) * 100 : null,
  };
}

// How many sessions a row needs before the engine can read it properly: the
// 52-week window. Below this the 200-day average is not a 200-day average and
// `thinHistory` is the honest answer.
const MIN_SESSIONS = 252;

module.exports = { rowAt, rsiSeries, MIN_SESSIONS };
