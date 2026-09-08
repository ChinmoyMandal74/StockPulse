// Momentum scored from a bar series, and nothing else.
//
// Extracted so the live refresh, the backfill and any later analysis all score
// the same way. Everything here is a pure function of the bars — no database, no
// API, no universe — which is what makes a stored momentum history a *cache*
// rather than a record: if the model changes, bump MODEL_VERSION, throw the rows
// away and recompute. Nothing is lost, so nothing has to be preserved.
//
// `values` is newest-first, [{ high, close }], the same shape the app holds.

'use strict';

// Bumped whenever the scoring changes in a way that makes old rows incomparable.
// Stored beside every row so a mixed table can never be read as one series.
//   1 — cross-sectional percentiles (never stored)
//   2 — absolute logistic curves, Sep 2026
const MODEL_VERSION = 2;

// A year of bars plus the month 12-1 skips, plus the bar it measures against.
const MIN_BARS = 274;

const FACTORS = ['mom121', 'ret6m', 'ret3m', 'fromHigh', 'trend', 'consistency', 'revers1m', 'rsi'];
const WEIGHTS = { mom121: 20, ret6m: 18, ret3m: 17, fromHigh: 10, trend: 10, consistency: 10, revers1m: 8, rsi: 7 };

// Centres are medians measured across the archive at six dates from 2011 to
// 2026; scales are roughly the interquartile spread. See CLAUDE.md.
const CURVES = {
  mom121: [0.70, 1.30], ret6m: [0.55, 0.90], ret3m: [0.25, 0.45],
  fromHigh: [-12, 14], consistency: [58, 15], revers1m: [1.0, 10],
};

const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };

function curve(v, centre, scale) {
  if (v == null || !isFinite(v)) return null;
  return 0.5 + 0.5 * Math.tanh((v - centre) / scale);
}

function pctChange(v, daysAgo) {
  if (v.length <= daysAgo) return null;
  const a = num(v[0].close), b = num(v[daysAgo].close);
  return a == null || b == null || b === 0 ? null : ((a - b) / b) * 100;
}

function windowReturn(v, fromDaysAgo, toDaysAgo) {
  if (v.length <= fromDaysAgo) return null;
  const a = num(v[toDaysAgo].close), b = num(v[fromDaysAgo].close);
  return a == null || b == null || b === 0 ? null : ((a - b) / b) * 100;
}

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

function pctFromHigh(v, lookback = 252) {
  const latest = num(v[0].close);
  let high = -Infinity;
  for (let i = 0; i < Math.min(v.length, lookback); i++) {
    const h = num(v[i].high);
    if (h != null && h > high) high = h;
  }
  return latest == null || !isFinite(high) || high === 0 ? null : ((latest - high) / high) * 100;
}

function positiveMonths(v, months = 12, span = 21) {
  if (v.length < months * span + 1) return null;
  let up = 0;
  for (let k = 0; k < months; k++) {
    const a = num(v[k * span].close), b = num(v[(k + 1) * span].close);
    if (a == null || b == null || b === 0) return null;
    if (a > b) up++;
  }
  return (up / months) * 100;
}

function smaAt(v, period, off) {
  if (v.length < off + period) return null;
  let t = 0;
  for (let i = off; i < off + period; i++) {
    const c = num(v[i].close);
    if (c == null) return null;
    t += c;
  }
  return t / period;
}

function maCross(v, shortP = 50, longP = 200) {
  if (v.length < longP + 1) return null;
  const s = smaAt(v, shortP, 0), l = smaAt(v, longP, 0);
  if (s == null || l == null) return null;
  const bullish = s - l >= 0;
  let daysSince = null;
  for (let d = 1; d <= v.length - longP; d++) {
    const a = smaAt(v, shortP, d), b = smaAt(v, longP, d);
    if (a == null || b == null) break;
    if ((a - b >= 0) !== bullish) { daysSince = d; break; }
  }
  return { bullish, daysSince, ma200: l };
}

// Wilder's RSI. Exponential, so it converges slowly — computed over everything
// available and read at the newest end.
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

// Non-monotonic on purpose: the sweet spot is strong-but-not-stretched, so this
// peaks at 70-75 and falls away above 85 as well as below 30.
function rsiScore(r) {
  if (r == null || !isFinite(r)) return null;
  if (r < 30) return 0.15;
  if (r < 50) return 0.15 + ((r - 30) / 20) * (0.55 - 0.15);
  if (r < 70) return 0.55 + ((r - 50) / 20) * (1.0 - 0.55);
  if (r <= 75) return 1.0;
  if (r < 85) return 1.0 - ((r - 75) / 10) * (1.0 - 0.5);
  return 0.4;
}

// A category, not a ranking: which side of the 200-day, and whether the 50-day
// crossed it recently enough to still be news.
function trendSub(above200, bullish, daysSinceCross) {
  const bull = above200 == null ? bullish : above200;
  if (bull == null) return null;
  const fresh = daysSinceCross != null && daysSinceCross <= 20;
  if (bull) return fresh ? 1.0 : 0.75;
  return fresh ? 0.0 : 0.25;
}

const riskAdj = (ret, vol) => (ret == null || vol == null || vol <= 0 ? null : ret / vol);

// The eight sub-scores, each 0-1, for one date. Null when the series is short.
function subScores(v) {
  if (!Array.isArray(v) || v.length < MIN_BARS) return null;
  const vol = realisedVol(v);
  const mc = maCross(v);
  const latest = num(v[0].close);
  const above200 = mc && mc.ma200 ? latest > mc.ma200 : null;
  const oneMonth = pctChange(v, 21);
  return {
    mom121: curve(riskAdj(windowReturn(v, 252, 21), vol), ...CURVES.mom121),
    ret6m: curve(riskAdj(pctChange(v, 126), vol), ...CURVES.ret6m),
    ret3m: curve(riskAdj(pctChange(v, 63), vol), ...CURVES.ret3m),
    fromHigh: curve(pctFromHigh(v), ...CURVES.fromHigh),
    trend: trendSub(above200, mc ? mc.bullish : null, mc ? mc.daysSince : null),
    consistency: curve(positiveMonths(v), ...CURVES.consistency),
    // Inverted: at a one-month horizon the strongest recent movers are the
    // likeliest to give some back, so leading this factor is a caution.
    revers1m: oneMonth == null ? null : 1 - curve(oneMonth, ...CURVES.revers1m),
    rsi: rsiScore(rsi(v)),
  };
}

// Weighted, renormalised over whichever factors have a value — a missing one
// dilutes nobody. `weights` lets a caller replay history under a different
// weighting, which is the point of storing the sub-scores rather than the score.
function composite(subs, weights = WEIGHTS) {
  if (!subs) return null;
  let w = 0, acc = 0;
  for (const k of FACTORS) {
    const sub = subs[k];
    if (sub == null) continue;
    const wt = weights[k] != null ? weights[k] : WEIGHTS[k];
    if (!(wt > 0)) continue;
    w += wt;
    acc += wt * sub;
  }
  return w ? (acc / w) : null;
}

// One date: { score 0-100, rating 1-10, subs }. Null when unscoreable.
function scoreBars(v, weights) {
  const subs = subScores(v);
  if (!subs) return null;
  const s01 = composite(subs, weights);
  if (s01 == null) return null;
  return {
    score: Math.round(s01 * 1000) / 10,
    rating: Math.max(1, Math.min(10, Math.round(s01 * 9 + 1))),
    subs,
  };
}

module.exports = {
  MODEL_VERSION, MIN_BARS, FACTORS, WEIGHTS, CURVES,
  subScores, composite, scoreBars,
  // exported for the tests and for anything that needs one factor alone
  curve, pctChange, windowReturn, realisedVol, pctFromHigh, positiveMonths,
  smaAt, maCross, rsi, rsiScore, trendSub, riskAdj,
};
