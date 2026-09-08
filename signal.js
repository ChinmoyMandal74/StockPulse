// Does a momentum move predict the next move in price?
//
// Pure functions over pairs of numbers — no database, no API, no framework, for
// the same reason momentum.js is: this is the arithmetic that decides whether a
// chart says "signal" or "noise", so it has to be checkable on its own.
//
// The honesty lives here rather than in the page. Three things make a weak
// relationship look stronger than it is, and each has an answer below:
//
//   - A trend line through a round cloud. `fit` reports r and r2 beside the
//     slope so the line can be drawn as faintly as it deserves.
//   - Overlapping windows. Consecutive days share 9 of their 10 forward days,
//     so 2,235 points carry nowhere near 2,235 observations' worth of evidence.
//     `effectiveN` says how many they really carry and `thin` takes a
//     non-overlapping sample.
//   - A hit rate with no baseline. A stock that rises 55% of fortnights gives a
//     55% hit rate to a signal that knows nothing, so `quadrants` returns the
//     base rate next to it and the lift between them.

'use strict';

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

function mean(xs) {
  return xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null;
}

// Pearson correlation. Null when either side has no spread — a constant
// correlates with nothing, and 0/0 would otherwise come back NaN.
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    sxy += a * b; sxx += a * a; syy += b * b;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

// Least squares, plus the r that says how much to trust the line.
function fit(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const r = pearson(xs, ys);
  return { slope, intercept: my - slope * mx, r, r2: r == null ? null : r * r };
}

// How many independent observations a series of overlapping windows is worth.
// A 10-day forward return sampled daily repeats 9 of its 10 days, so the honest
// count is roughly one per window length. Rounded down, floored at 1.
function effectiveN(n, overlap) {
  if (!(n > 0)) return 0;
  return Math.max(1, Math.floor(n / Math.max(1, overlap)));
}

// Every `step`th row, so no two forward windows share a day.
function thin(rows, step) {
  const s = Math.max(1, Math.round(step));
  return rows.filter((_, i) => i % s === 0);
}

// Equal-count buckets along x, each carrying the mean of y inside it. Deciles by
// default. Equal-count rather than equal-width: the delta distribution is dense
// near zero and thin at the tails, so equal-width buckets put almost everything
// in the middle three and leave the ends too sparse to mean anything.
function buckets(pairs, count = 10) {
  if (pairs.length < count * 2) count = Math.max(2, Math.floor(pairs.length / 2));
  const sorted = [...pairs].sort((a, b) => a.x - b.x);
  const per = Math.floor(sorted.length / count);
  if (!per) return [];
  const out = [];
  for (let b = 0; b < count; b++) {
    // The last bucket takes the remainder, so no rows are silently dropped.
    const slice = b === count - 1 ? sorted.slice(b * per) : sorted.slice(b * per, (b + 1) * per);
    if (!slice.length) continue;
    out.push({
      i: b + 1,
      n: slice.length,
      xFrom: slice[0].x,
      xTo: slice[slice.length - 1].x,
      xMean: mean(slice.map((p) => p.x)),
      yMean: mean(slice.map((p) => p.y)),
    });
  }
  return out;
}

function median(xs) {
  if (!xs.length) return null;
  const a = [...xs].sort((m, n) => m - n);
  const h = Math.floor(a.length / 2);
  return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
}

// The four corners of the scatter, and — the part that matters — the base rate
// beside the hit rate. "Delta rose, price then rose" is only interesting if it
// beats how often the price rose anyway.
//
// `xSplit` is where "high" begins, and it is not always zero. A delta straddles
// zero so zero is its natural divider, but a momentum score runs 0-100 and is
// never negative: splitting it at zero put every row on the high side, which
// made the hit rate identical to the base rate and the lift exactly 0.0 for
// every horizon. A level has to be split at its median.
function quadrants(pairs, xSplit = 0) {
  let upUp = 0, upDown = 0, downUp = 0, downDown = 0;
  for (const p of pairs) {
    const xUp = p.x >= xSplit, yUp = p.y >= 0;
    if (xUp && yUp) upUp++;
    else if (xUp) upDown++;
    else if (yUp) downUp++;
    else downDown++;
  }
  const n = pairs.length;
  const nUp = upUp + upDown;
  const nDown = downUp + downDown;
  const baseRate = n ? (upUp + downUp) / n : null;
  const hitRate = nUp ? upUp / nUp : null;
  const missRate = nDown ? downDown / nDown : null;
  return {
    upUp, upDown, downUp, downDown, n, nUp, nDown, xSplit,
    baseRate,                                   // how often it rose at all
    hitRate,                                    // rose, given the delta rose
    missRate,                                   // fell, given the delta fell
    lift: hitRate == null || baseRate == null ? null : hitRate - baseRate,
  };
}

// One verdict sentence, so the conclusion does not depend on reading a scatter
// correctly. Deliberately conservative: with overlapping windows and a few
// hundred real observations, |r| below 0.1 is not worth a second look.
function verdict(r, eff, lift) {
  if (r == null) return 'Not enough data to say anything.';
  const a = Math.abs(r);
  const pts = lift == null ? '' : ` The hit rate is ${lift >= 0 ? '+' : ''}${(lift * 100).toFixed(1)} points against the base rate.`;
  if (eff < 30) return `Too few independent observations (${eff}) to judge. Treat anything below as decorative.`;
  if (a < 0.10) return `No usable relationship: the momentum move explains essentially none of what the price did next.${pts}`;
  if (a < 0.20) return `A faint relationship at best (r ${r.toFixed(3)}), inside what ${eff} independent observations can throw up by chance.${pts}`;
  if (a < 0.35) return `A modest ${r > 0 ? 'positive' : 'negative'} relationship (r ${r.toFixed(3)}). Worth testing on data this was not chosen from.${pts}`;
  return `A strong ${r > 0 ? 'positive' : 'negative'} relationship (r ${r.toFixed(3)}) — strong enough to be worth checking for a mistake before believing.${pts}`;
}

// Everything the page needs from a list of {x, y} pairs.
//   overlap — the forward window in sessions, used for the honest n
//   split — 'zero' for a signal that straddles zero, 'median' for a level
function summarise(pairs, overlap = 10, split = 'zero') {
  const clean = pairs.filter((p) => num(p.x) != null && num(p.y) != null);
  const xs = clean.map((p) => p.x), ys = clean.map((p) => p.y);
  const f = fit(xs, ys);
  const xSplit = split === 'median' ? (median(xs) ?? 0) : 0;
  const q = quadrants(clean, xSplit);
  const eff = effectiveN(clean.length, overlap);
  return {
    n: clean.length,
    effectiveN: eff,
    overlap,
    xMean: mean(xs), yMean: mean(ys),
    xMin: xs.length ? Math.min(...xs) : null, xMax: xs.length ? Math.max(...xs) : null,
    yMin: ys.length ? Math.min(...ys) : null, yMax: ys.length ? Math.max(...ys) : null,
    fit: f,
    r: f ? f.r : null,
    xSplit,
    buckets: buckets(clean),
    quadrants: q,
    verdict: verdict(f ? f.r : null, eff, q.lift),
  };
}

module.exports = { pearson, fit, mean, median, buckets, quadrants, effectiveN, thin, verdict, summarise };
