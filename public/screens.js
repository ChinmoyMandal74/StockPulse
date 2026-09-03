// The seven analysis screens, defined once.
//
// These used to live inline in analysis.html, which was fine while the page was
// the only thing that ran them. The nightly refresh email reports the same
// screens, and a second copy of "what counts as bouncing off the lows" would
// have drifted from the page within a month — the same reason rowcard.js exists.
//
// Only the *selection* lives here: which rows a screen contains and in what
// order. How a screen is drawn — its columns, its prose, its empty message —
// stays with whichever surface is drawing it, because a table and an email want
// different things.
//
// Loaded as a plain <script> by the page and required() by server.js, so it has
// to work in both. No build step to bridge them.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Screens = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const num = (n) => n != null && isFinite(n);

  // Where a stock sits in its own 52-week range, 0 = on the low. Older
  // snapshots predate the field, so fall back to distance from the high.
  const rangePos = (x) => (num(x.range52Pos) ? x.range52Pos : null);
  const lowInRange = (x) => (num(x.range52Pos)
    ? x.range52Pos <= 30
    : (num(x.pctFromHigh) && x.pctFromHigh <= -25));

  // Surprises above this are feed artefacts, not results — two different
  // mega-caps currently report exactly +214%, which is not a coincidence.
  const SURPRISE_CAP = 100;

  // How far the momentum score must move over a fortnight before it counts as
  // movement rather than noise. Measured across the live universe: a fortnight
  // shifts the median name 4.5 points, so 5 leaves about half the list out.
  //
  // The canonical copy lives here because this is the module the server can
  // require; rowcard.js reads it for the wording of its tooltip and index.html
  // for the arrow, so the threshold, the arrow and the sentence describing it
  // can never disagree.
  const MOM_MIN_MOVE = 5;

  // Whole days from midnight today to an ISO date: negative is the past.
  function dayDelta(iso, today) {
    if (!iso) return null;
    const t = new Date(iso);
    if (isNaN(t)) return null;
    return Math.round((t - today) / 86400000);
  }

  // Server-derived now, so the page, the export and the chatbot all read one
  // number. The fallback keeps snapshots written before the field existed working.
  const fcfYield = (x) => (num(x.fcfYield) ? x.fcfYield
    : ((num(x.fcfTtm) && x.marketCap) ? (x.fcfTtm / x.marketCap) * 100 : null));

  // ---- momentum weightings --------------------------------------------------
  // The server always scores on `default`; these are a lens the analysis page
  // can look through. Keyed on the stable factor keys the server ships in
  // momentumBreakdown, not on the captions, which are prose and may be reworded.
  //
  // The axis is continuation versus caution, because that is the one real
  // disagreement between reasonable people about a momentum score. Adjectives
  // like "aggressive" would be a mood; these are positions.
  //
  //   Trend  leans shorter-horizon and removes the reversal brake entirely — it
  //          wants whatever is working now and does not care that a big
  //          one-month move often gives some back.
  //   Steady leans on the year-long factor and on month-to-month consistency,
  //          and keeps the brake, so a name has to have been working for a
  //          while and to have done it repeatedly.
  //
  // Weights need not total 100: the score renormalises over whichever factors
  // have data, exactly as the server's scoreFactors() does.
  const WEIGHT_PRESETS = [
    {
      id: 'default',
      label: 'Default',
      note: 'The weighting every other page uses.',
      weights: { mom121: 20, ret6m: 18, ret3m: 17, fromHigh: 10, trend: 10, consistency: 10, revers1m: 8, rsi: 7 },
    },
    {
      id: 'trend',
      label: 'Trend',
      note: 'Shorter horizons, stronger trend, no reversal brake.',
      weights: { mom121: 18, ret6m: 20, ret3m: 24, fromHigh: 12, trend: 16, consistency: 4, revers1m: 0, rsi: 6 },
    },
    {
      id: 'steady',
      label: 'Steady',
      note: 'The year-long factor and month-to-month consistency lead.',
      weights: { mom121: 24, ret6m: 16, ret3m: 10, fromHigh: 8, trend: 10, consistency: 20, revers1m: 8, rsi: 4 },
    },
  ];

  const presetById = (id) => WEIGHT_PRESETS.find((p) => p.id === id) || WEIGHT_PRESETS[0];

  // Re-score one factor breakdown under a different weighting. Mirrors
  // scoreFactors() in server.js: absent factors are dropped and the rest
  // renormalised, so a missing sub-score dilutes nobody.
  function scoreWithWeights(breakdown, weights) {
    if (!Array.isArray(breakdown) || !weights) return null;
    let w = 0, acc = 0;
    for (const c of breakdown) {
      if (c.sub == null) continue;
      const wt = c.key != null && weights[c.key] != null ? weights[c.key] : c.weight;
      if (!(wt > 0)) continue;
      w += wt;
      acc += wt * c.sub;
    }
    if (w === 0) return null;
    const score01 = acc / w;
    return {
      score: Math.round(score01 * 1000) / 10,
      rating: Math.max(1, Math.min(10, Math.round(score01 * 9 + 1))),
    };
  }

  // A stock re-scored under `weights`, as a shallow copy carrying the same field
  // names the rest of the app uses — so a screen or a cell renderer needs no
  // idea that a lens is in play. Overall moves with it: it is 65% momentum.
  function applyWeights(stock, weights) {
    const now = scoreWithWeights(stock.momentumBreakdown, weights);
    if (!now) return stock;
    const then = scoreWithWeights(stock.momentumBreakdownPrev, weights);
    const out = Object.assign({}, stock, {
      momentumScore: now.score,
      momentumRating: now.rating,
      momentumScorePrev: then ? then.score : null,
      momentumChange: then ? Math.round((now.score - then.score) * 10) / 10 : null,
    });
    if (stock.qualityScore != null) {
      const o = now.score * 0.65 + stock.qualityScore * 0.35;
      out.overallScore = Math.round(o * 10) / 10;
      out.overallRating = Math.max(1, Math.min(10, Math.round((o / 100) * 9 + 1)));
    } else {
      out.overallScore = now.score;
      out.overallRating = now.rating;
    }
    return out;
  }

  const SCREENS = [
    // These two lead: they are the only screens that describe a *change* in
    // standing rather than a standing, which is the thing a ranked table can
    // never show you.
    {
      id: 'climbing',
      title: 'Momentum improving',
      blurb: `momentum score up ${MOM_MIN_MOVE} points or more over the last fortnight`,
      test: (x) => num(x.momentumChange) && x.momentumChange >= MOM_MIN_MOVE,
      sort: (a, b) => b.momentumChange - a.momentumChange,
    },
    {
      id: 'fading',
      title: 'Momentum fading',
      blurb: `momentum score down ${MOM_MIN_MOVE} points or more over the last fortnight`,
      test: (x) => num(x.momentumChange) && x.momentumChange <= -MOM_MIN_MOVE,
      sort: (a, b) => a.momentumChange - b.momentumChange,
    },
    {
      id: 'bounce',
      title: 'Bouncing off the lows',
      blurb: 'low in the 52-week range but rising over both the last month and the last fortnight',
      test: (x) => lowInRange(x)
        && num(x.oneMonthPct) && x.oneMonthPct > 3
        && num(x.twoWeekPct) && x.twoWeekPct > 0,
      sort: (a, b) => (rangePos(a) ?? 999) - (rangePos(b) ?? 999) || a.pctFromHigh - b.pctFromHigh,
    },
    {
      id: 'waking',
      title: 'Just started moving',
      blurb: 'up more than 5% in a fortnight while still negative over three months',
      test: (x) => num(x.twoWeekPct) && x.twoWeekPct > 5
        && num(x.threeMonthPct) && x.threeMonthPct < 0,
      sort: (a, b) => b.twoWeekPct - a.twoWeekPct,
    },
    {
      id: 'drift',
      title: 'Drifting after a beat',
      blurb: 'beat consensus by more than 10% and reported within the last three weeks',
      test: (x, ctx) => num(x.lastSurprise) && x.lastSurprise > 10
        && x.lastSurprise <= SURPRISE_CAP
        && x.lastEarningsDate
        && -ctx.days(x.lastEarningsDate) <= 21 && -ctx.days(x.lastEarningsDate) >= 0,
      sort: (a, b) => b.lastSurprise - a.lastSurprise,
    },
    {
      id: 'earnings',
      title: 'Reporting in the next 14 days',
      blurb: 'a catalyst and a risk in the same event',
      test: (x, ctx) => x.nextEarningsDate
        && ctx.days(x.nextEarningsDate) >= 0 && ctx.days(x.nextEarningsDate) <= 14,
      sort: (a, b) => a.nextEarningsDate.localeCompare(b.nextEarningsDate),
    },
    {
      id: 'value',
      title: 'Cheap, growing and profitable',
      blurb: 'forward P/E under 20 while revenue grows more than 15% and the net margin clears 15%',
      test: (x) => num(x.forwardPe) && x.forwardPe > 0 && x.forwardPe < 20
        && num(x.revenueGrowthYoY) && x.revenueGrowthYoY > 15
        && num(x.profitMargin) && x.profitMargin > 15,
      sort: (a, b) => a.forwardPe - b.forwardPe,
    },
    {
      id: 'disconnect',
      title: "Business improving, price isn't",
      blurb: 'revenue growing more than 25% while the price has fallen more than 10% over three months',
      test: (x) => num(x.revenueGrowthYoY) && x.revenueGrowthYoY > 25
        && num(x.threeMonthPct) && x.threeMonthPct < -10,
      sort: (a, b) => b.revenueGrowthYoY - a.revenueGrowthYoY,
    },
    {
      id: 'hot',
      title: 'Overextended',
      blurb: 'RSI above 75 and more than 12% above the 50-day average',
      test: (x) => num(x.rsi) && x.rsi > 75 && num(x.vs50ma) && x.vs50ma > 12,
      sort: (a, b) => b.rsi - a.rsi,
    },
  ];

  // Runs every screen over one set of rows. `now` is injectable so a caller can
  // reproduce a past night rather than only ever meaning "today".
  function run(rows, now) {
    const today = now ? new Date(now) : new Date();
    today.setHours(0, 0, 0, 0);
    const ctx = { days: (iso) => dayDelta(iso, today), today };

    const out = {};
    for (const s of SCREENS) {
      out[s.id] = rows.filter((x) => s.test(x, ctx)).sort(s.sort);
    }
    return out;
  }

  return {
    SCREENS, run, num, rangePos, lowInRange, fcfYield, SURPRISE_CAP, MOM_MIN_MOVE, dayDelta,
    WEIGHT_PRESETS, presetById, scoreWithWeights, applyWeights,
  };
});
