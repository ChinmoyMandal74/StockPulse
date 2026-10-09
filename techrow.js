// The bar-derived row, defined once — barmath.js's shape, for the Signal
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
//     `pctFromHigh` feeds `nearHigh` (Very Strong), `shallowEnough` (a plain
//     Buy) and `deepHole`.
//   * `volTrend` was absent from the study's row entirely, so the
//     `distribution` Avoid rule could never fire in eighteen years of it.
//
// Three callers now share this: server.js, action-backtest.js and the tech
// history builder. A fourth copy was the alternative.
'use strict';

const BarMath = require('./barmath.js');

// A SUB-CENT CLOSE IS NOT A PRICE TO DIVIDE BY. The same floor and the same
// value as `MIN_CLOSE` beside `pctChange` in server.js, which guards the
// screener's returns and the 5Y anchor; this module is the offline half and
// had only `> 0`, the test that floor replaced.
//
// It is needed for a REAL history, not a corrupt one. APLD traded as a
// sub-penny shell — $0.0085 in October 2020, 1,304 sub-cent bars — before
// its 2021 pivot, and is ~$50 now. Nothing there is wrong and its chart must
// keep drawing; but a five-year return of +291,000% off a shell price is
// arithmetically correct and analytically meaningless, and it dominates any
// average it enters. The next reverse-merger shell does the same, so removing
// a ticker cannot fix this.
//
// THE FLOOR IS ON THE ARITHMETIC, NEVER ON THE PRICE — `price` below is
// returned untouched. Only the fields that divide by a close refuse.
const MIN_CLOSE = 0.01;

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
  // Both ends have to be a price: a sub-cent ANCHOR inflates the return and a
  // sub-cent CURRENT close collapses it, and each is as meaningless.
  const priced = c >= MIN_CLOSE;
  const back = (n) => (i >= n && priced && closes[i - n] >= MIN_CLOSE
    ? (c / closes[i - n] - 1) * 100 : null);
  return {
    price: c,
    vs200ma: priced && s200 >= MIN_CLOSE ? (c / s200 - 1) * 100 : null,
    vs50ma: priced && s50 >= MIN_CLOSE ? (c / s50 - 1) * 100 : null,
    oneMonthPct: back(21), threeMonthPct: back(63), sixMonthPct: back(126),
    oneYearPct: back(252), oneWeekPct: back(5), todayPct: back(1),
    pctFromHigh: priced && hi >= MIN_CLOSE ? (c / hi - 1) * 100 : null,
    pctFromLow: priced && lo < Infinity && lo >= MIN_CLOSE ? (c / lo - 1) * 100 : null,
    // A POSITION IN A RANGE IS NOT A RETURN — it is bounded 0..100 whatever
    // the prices are, so a sub-cent low cannot inflate it and it keeps its
    // own test. The 52-week window is still real information on a shell.
    range52Pos: hi > lo ? ((c - lo) / (hi - lo)) * 100 : null,
    // Above or below its own average is a COMPARISON, not a division, and
    // stays true at any price.
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

module.exports = { rowAt, rsiSeries, MIN_SESSIONS, MIN_CLOSE };
