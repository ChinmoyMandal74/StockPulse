// How one stock has behaved around its own earnings.
//
// PURE: no database, no network, no universe — the news.js / secfacts.js /
// insider.js shape. It takes a close series and the stored earnings events and
// returns the aggregate the stock page draws. That is what makes the
// statistics testable without a server, which matters here more than usual
// because every trap in this file is a statistical one.
//
// WHAT IT IS AND IS NOT. This describes what happened to ONE stock over a few
// dozen quarters. It is not evidence that earnings are tradable: the research
// log has taken eight framings and found seven flat, and post-earnings drift
// is explicitly untested here (docs/backlog.md entry 1). Every number it
// returns carries its own `n` so the page can say how thin it is, and the page
// is expected to say so rather than printing a median of eight as a fact.
'use strict';

// Sessions either side of the report that the chart covers.
//
// +42 IS DELIBERATE AND IS NOT ROUND. A quarter is about 63 trading days, so a
// longer window would run into the NEXT report and start measuring that
// instead — the trap that would quietly turn "drift after earnings" into
// "whatever the following quarter did".
const PRE = 10;
const POST = 42;
// The drift horizon quoted beside the chart: one month after the reaction.
const DRIFT = 21;
// At most this many paths are drawn. The spaghetti exists to show dispersion
// and sample size; past a couple of dozen it shows neither any better and only
// costs payload.
const MAX_PATHS = 24;
// A side of the beat/miss split is withheld below this many observations.
//
// IT IS NOT A ROUND NUMBER PICKED FOR TIDINESS — the split is DEGENERATE on
// real data and would otherwise be the most misleading thing on the card.
// Measured 2026-09-28: NVDA has 24 beats against 2 misses, AAPL 24 against 1.
// Companies beat the consensus nearly every quarter, so "the median move after
// a miss" is routinely a median of one, printed in the same type as a median
// of twenty-four. Withheld, with the count still shown, so the reader learns
// the useful fact — that misses are rare — instead of a fabricated one.
const MIN_SPLIT = 4;

const num = (v) => {
  // Reject the empty BEFORE coercing: Number(null) is 0 and finite, which here
  // would invent a flat quarter and drag every median toward zero. The sixth
  // place this project has needed that sentence.
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function median(xs) {
  const a = xs.filter((x) => x != null).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function quantile(xs, q) {
  const a = xs.filter((x) => x != null).sort((p, q2) => p - q2);
  if (!a.length) return null;
  const i = (a.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (i - lo);
}
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

// `bars` oldest-first [{ d, close }]; `events` the rows readEarnings returns.
function build(bars, events, opts = {}) {
  const pre = opts.pre == null ? PRE : opts.pre;
  const post = opts.post == null ? POST : opts.post;
  const drift = opts.drift == null ? DRIFT : opts.drift;

  const rows = (bars || [])
    .map((b) => ({ d: String(b.d || b.datetime || ''), close: num(b.close) }))
    .filter((b) => b.d && b.close != null && b.close > 0)
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  const out = {
    n: 0, window: { pre, post }, drift, paths: [], median: null, q1: null, q3: null,
    next: null, driftStat: null, base: null, from: null, to: null,
    skipped: { noBar: 0, shortWindow: 0 }, unclassified: 0,
  };
  if (rows.length < pre + post + 2) return out;

  // Index by date once; a linear scan per event would be 26 walks of the series.
  const at = new Map();
  rows.forEach((b, i) => at.set(b.d, i));
  // The report may land on a non-trading day, so fall back to the last session
  // on or before it.
  const dates = rows.map((b) => b.d);
  function idxFor(d) {
    if (at.has(d)) return at.get(d);
    let lo = 0; let hi = dates.length - 1; let ans = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (dates[m] <= d) { ans = m; lo = m + 1; } else { hi = m - 1; }
    }
    return ans;
  }

  const evs = (events || [])
    .map((e) => ({ date: String(e.date || ''), sp: num(e.surprisePrc),
      est: num(e.epsEstimate), time: e.time || null }))
    .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const nextMoves = [];   // t -> t+1, the reaction
  const driftMoves = [];  // t+1 -> t+1+drift, EXCLUDING the reaction
  const paths = [];
  for (const e of evs) {
    const i = idxFor(e.date);
    if (i < 0) { out.skipped.noBar++; continue; }
    const base = rows[i].close;

    // THE REACTION IS t -> t+1, because ~99% of these are reported AFTER the
    // close: the session the report lands on does not contain the market's
    // answer to it. Using t-1 -> t here is the error that would make the whole
    // card describe the wrong day.
    if (i + 1 < rows.length) {
      nextMoves.push({ v: (rows[i + 1].close / base - 1) * 100, sp: e.sp, est: e.est });
    }
    // Measured FROM the reaction, so the jump is not counted twice — the same
    // separation the PEAD writeup insists on.
    if (i + 1 + drift < rows.length && i + 1 < rows.length) {
      driftMoves.push((rows[i + 1 + drift].close / rows[i + 1].close - 1) * 100);
    }
    if (i - pre >= 0 && i + post < rows.length) {
      const path = [];
      for (let k = -pre; k <= post; k++) path.push(r1((rows[i + k].close / base - 1) * 100));
      paths.push({ date: e.date, beat: e.est == null || e.sp == null ? null : e.sp > 0, path });
    } else out.skipped.shortWindow++;
  }

  // Newest first, then trimmed: if anything has to go it should be the oldest
  // quarter, not an arbitrary one.
  paths.sort((a, b) => (a.date < b.date ? 1 : -1));
  out.paths = paths.slice(0, MAX_PATHS);
  out.n = out.paths.length;
  if (out.n) {
    out.from = out.paths[out.paths.length - 1].date;
    out.to = out.paths[0].date;
    const len = pre + post + 1;
    const col = (k) => out.paths.map((p) => p.path[k]);
    out.median = Array.from({ length: len }, (_, k) => r1(median(col(k))));
    out.q1 = Array.from({ length: len }, (_, k) => r1(quantile(col(k), 0.25)));
    out.q3 = Array.from({ length: len }, (_, k) => r1(quantile(col(k), 0.75)));
  }

  if (nextMoves.length) {
    // CLASSIFIED BY THE SIGN OF THE SURPRISE, never its size. The archive holds
    // a -262% and two mega-caps at +214% — artefacts of a near-zero estimate —
    // so the magnitude is not usable, while the sign is.
    const beats = nextMoves.filter((x) => x.est != null && x.sp != null && x.sp > 0);
    const misses = nextMoves.filter((x) => x.est != null && x.sp != null && x.sp < 0);
    out.unclassified = nextMoves.length - beats.length - misses.length;
    const vs = nextMoves.map((x) => x.v);
    // A side is COUNTED always and MEDIANED only when there is enough of it:
    // `n` with a null median is what lets the page say "3 misses, too few to
    // summarise" rather than printing one quarter as a typical outcome.
    const side = (xs) => (xs.length
      ? { n: xs.length, median: xs.length >= MIN_SPLIT ? r2(median(xs.map((x) => x.v))) : null }
      : null);
    out.next = {
      n: nextMoves.length,
      median: r2(median(vs)),
      // THE SPREAD IS HALF THE ANSWER. "How does it behave around earnings" is
      // as much about how BIG the move is as which way it goes, and a median
      // of -0.2% on a stock that routinely swings eight points either way
      // describes almost nothing on its own. Quartiles rather than a standard
      // deviation, for the reason the fundamentals card uses medians: one
      // quarter should not set the number.
      p25: r2(quantile(vs, 0.25)),
      p75: r2(quantile(vs, 0.75)),
      // HOW BIG THE EVENT IS, regardless of direction — the single number that
      // answers "does this stock move on earnings at all". A median of -0.22%
      // makes NVDA look inert; its median ABSOLUTE reaction is 2.34%, and the
      // two facts together are the honest description: it moves, but not
      // reliably in one direction.
      absMedian: r2(median(vs.map(Math.abs))),
      up: nextMoves.filter((x) => x.v > 0).length,
      beat: side(beats),
      miss: side(misses),
      minSplit: MIN_SPLIT,
    };
  }
  if (driftMoves.length) {
    out.driftStat = { n: driftMoves.length, median: r2(median(driftMoves)) };
  }

  // THE BASE RATE, without which a hit rate says nothing: a stock that rises on
  // most days hands a flattering number to any signal that knows nothing. This
  // is the same stock's ordinary session over the same span, so the comparison
  // needs no universe and no second source.
  const daily = [];
  for (let i = 1; i < rows.length; i++) daily.push((rows[i].close / rows[i - 1].close - 1) * 100);
  if (daily.length) {
    out.base = {
      n: daily.length,
      median: r2(median(daily)),
      upPct: r1((daily.filter((v) => v > 0).length / daily.length) * 100),
    };
  }
  return out;
}

module.exports = { build, PRE, POST, DRIFT, MAX_PATHS, MIN_SPLIT, median, quantile };
